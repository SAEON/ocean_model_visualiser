import os
import time
import json
import asyncio
import hashlib
from typing import Optional
from concurrent.futures import ProcessPoolExecutor
import xarray as xr
import numpy as np
import matplotlib
matplotlib.use('Agg')
from matplotlib.figure import Figure
from shapely.geometry import Polygon, MultiPolygon, mapping
from shapely.validation import make_valid
from fastapi import HTTPException

from backend.database import members_collection

NETCDF_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "croco_avg_t2.nc")

ds = None
metadata_cache = {}
dataset_cache = {}
contour_layer_cache = {}
currents_layer_cache = {}

contour_process_executor = ProcessPoolExecutor(max_workers=max(1, (os.cpu_count() or 4) // 2))

def get_canonical_file_path(file_path: Optional[str]) -> str:
    if not file_path:
        return 'default'
    resolved = file_path
    if not os.path.exists(resolved):
        if resolved.startswith("/data/"):
            fallback = os.path.join(os.getcwd(), os.path.basename(resolved))
            if os.path.exists(fallback):
                resolved = fallback
        if not os.path.exists(resolved):
            fallback_cwd = os.path.join(os.getcwd(), os.path.basename(file_path))
            if os.path.exists(fallback_cwd):
                resolved = fallback_cwd
            else:
                fallback_data = os.path.join("/data", os.path.basename(file_path))
                if os.path.exists(fallback_data):
                    resolved = fallback_data
    if os.path.exists(resolved):
        return os.path.realpath(os.path.abspath(resolved))
    return os.path.abspath(resolved)

def get_file_cache_prefix(file_path: str) -> str:
    canonical = get_canonical_file_path(file_path)
    path_hash = hashlib.md5(canonical.encode('utf-8')).hexdigest()[:8]
    base_name = os.path.basename(canonical)
    return f"{base_name}_{path_hash}"

async def get_cached_dataset(file_path: str):
    now = time.time()
    canonical_path = get_canonical_file_path(file_path)

    if not os.path.exists(canonical_path):
        if file_path in dataset_cache:
            dataset, _, _ = dataset_cache.pop(file_path)
            try:
                dataset.close()
            except Exception:
                pass
            keys_to_del = [k for k in contour_layer_cache if k[0] == canonical_path]
            for k in keys_to_del:
                del contour_layer_cache[k]
            keys_to_del_curr = [k for k in currents_layer_cache if k[0] == canonical_path]
            for k in keys_to_del_curr:
                del currents_layer_cache[k]
        raise HTTPException(status_code=400, detail=f"NetCDF file not found at path: {file_path}")

    mtime = os.path.getmtime(canonical_path)

    if file_path in dataset_cache:
        dataset, meta, loaded_time = dataset_cache[file_path]
        if (now - loaded_time <= 6 * 3600) and (mtime <= loaded_time):
            return dataset, meta
        else:
            try:
                dataset.close()
            except Exception:
                pass
            del dataset_cache[file_path]
            keys_to_del = [k for k in contour_layer_cache if k[0] == canonical_path]
            for k in keys_to_del:
                del contour_layer_cache[k]
            keys_to_del_curr = [k for k in currents_layer_cache if k[0] == canonical_path]
            for k in keys_to_del_curr:
                del currents_layer_cache[k]
    try:
        dataset = xr.open_dataset(canonical_path)
        
        allowed_vars = None
        time_sampling = 1
        try:
            member = await members_collection.find_one({"variable_groups.file_path": file_path})
            if not member:
                member = await members_collection.find_one({"variable_groups.file_path": canonical_path})
            if member:
                for vg in member.get("variable_groups", []):
                    if vg.get("file_path") in (file_path, canonical_path):
                        allowed_vars = vg.get("variables", [])
                        time_sampling = vg.get("time_sampling", 1)
                        break
        except Exception as e:
            print(f"Error querying database for file_path {file_path}: {e}")

        raw_times = [str(t) for t in dataset['time'].values]
        times = raw_times[::time_sampling]
        depths = [float(d) for d in dataset['depth'].values] if 'depth' in dataset else []
        
        lon_min = float(dataset['lon_rho'].min().values)
        lon_max = float(dataset['lon_rho'].max().values)
        lat_min = float(dataset['lat_rho'].min().values)
        lat_max = float(dataset['lat_rho'].max().values)

        allowed_netcdf_vars = []
        if allowed_vars is not None:
            if 'temp' in allowed_vars:
                allowed_netcdf_vars.append('temp')
            if 'salt' in allowed_vars:
                allowed_netcdf_vars.append('salt')
            if 'zeta' in allowed_vars:
                allowed_netcdf_vars.append('zeta')
            if 'currents' in allowed_vars:
                allowed_netcdf_vars.extend(['u', 'v'])
        else:
            allowed_netcdf_vars = ['temp', 'salt', 'zeta', 'u', 'v']

        var_ranges = {}
        for var in allowed_netcdf_vars:
            if var not in dataset:
                continue
            if var == 'zeta':
                slice_data = dataset[var].isel(time=0).values
                val_min, val_max = np.nanpercentile(slice_data, [1, 99])
                var_ranges[var] = {"min": float(val_min), "max": float(val_max)}
            else:
                depth_ranges = []
                for d_idx in range(len(depths)):
                    slice_d = dataset[var].isel(time=0, depth=d_idx).values
                    d_min, d_max = np.nanpercentile(slice_d, [1, 99])
                    depth_ranges.append({"min": float(d_min), "max": float(d_max)})
                var_ranges[var] = depth_ranges
                
        meta = {
            "times": times,
            "depths": depths,
            "bounds": {
                "lon_min": lon_min,
                "lon_max": lon_max,
                "lat_min": lat_min,
                "lat_max": lat_max
            },
            "ranges": var_ranges,
            "time_sampling": time_sampling,
            "canonical_path": canonical_path
        }
        dataset_cache[file_path] = (dataset, meta, time.time())
        return dataset, meta
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to open or parse NetCDF at {file_path}. Error: {str(e)}")

def compute_contours_sync(file_path: Optional[str], variable: str, time_idx: int, depth: int, tolerance: float, time_sampling: int = 1):
    canonical_path = get_canonical_file_path(file_path)
    file_prefix = get_file_cache_prefix(canonical_path)
    cache_dir = os.path.join(os.getcwd(), ".cache", "contours")
    os.makedirs(cache_dir, exist_ok=True)
    cache_filename = f"{file_prefix}_{variable}_{depth}_{time_idx}_tol{tolerance}.json"
    disk_cache_path = os.path.join(cache_dir, cache_filename)

    resolved_path = canonical_path if (canonical_path != 'default' and os.path.exists(canonical_path)) else NETCDF_PATH
    if not os.path.exists(resolved_path):
        return {"type": "FeatureCollection", "features": []}

    nc_mtime = os.path.getmtime(resolved_path)

    if os.path.exists(disk_cache_path):
        if os.path.getmtime(disk_cache_path) >= nc_mtime:
            try:
                with open(disk_cache_path, "r") as f:
                    return json.load(f)
            except Exception:
                pass

    try:
        ds_file = xr.open_dataset(resolved_path)
        actual_time = time_idx * time_sampling
        if variable == 'zeta':
            slice_data = ds_file['zeta'].isel(time=actual_time)
        else:
            slice_data = ds_file[variable].isel(time=actual_time, depth=depth)
            
        z = slice_data.values
        lon = ds_file['lon_rho'].values
        lat = ds_file['lat_rho'].values
        ds_file.close()
        
        if np.isnan(z).all():
            res = {"type": "FeatureCollection", "features": []}
            return res
            
        z_min = float(np.nanmin(z))
        z_max = float(np.nanmax(z))
        
        if z_min == z_max:
            res = {"type": "FeatureCollection", "features": [], "value_min": z_min, "value_max": z_max}
            return res
            
        p1 = float(np.nanpercentile(z, 1))
        p99 = float(np.nanpercentile(z, 99))
        if p1 == p99:
            p1 = z_min
            p99 = z_max
            
        z_clipped = np.clip(z, p1, p99)
        levels = np.linspace(p1, p99, 20)
        
        fig = Figure()
        ax = fig.subplots()
        cs = ax.contourf(lon, lat, z_clipped, levels=levels)
        
        features = []
        simp_tol = tolerance if tolerance > 0 else 0.0005

        for i, path in enumerate(cs.get_paths()):
            level_min = cs.levels[i]
            level_max = cs.levels[i+1]
            
            rings = path.to_polygons()
            if not rings:
                continue
                
            polys = []
            for ring in rings:
                if len(ring) < 4:
                    continue
                p = Polygon(ring)
                if not p.is_valid:
                    p = make_valid(p)
                p_simple = p.simplify(simp_tol, preserve_topology=True)
                if not p_simple.is_empty:
                    polys.append(p_simple)
                    
            if not polys:
                continue
                
            polys = sorted(polys, key=lambda p: p.area, reverse=True)
            
            shells = []
            for poly in polys:
                inserted = False
                for shell_info in shells:
                    if shell_info['poly'].contains(poly):
                        shell_info['holes'].append(poly)
                        inserted = True
                        break
                if not inserted:
                    shells.append({'poly': poly, 'holes': []})
                    
            level_polygons = []
            for shell_info in shells:
                geom = shell_info['poly']
                for hole in shell_info['holes']:
                    geom = geom.difference(hole)
                if not geom.is_empty:
                    level_polygons.append(geom)
                    
            polygons_to_combine = []
            for g in level_polygons:
                if g.is_empty:
                    continue
                if g.geom_type == 'Polygon':
                    polygons_to_combine.append(g)
                elif g.geom_type == 'MultiPolygon':
                    polygons_to_combine.extend(g.geoms)
                elif g.geom_type == 'GeometryCollection':
                    for sub_g in g.geoms:
                        if sub_g.geom_type == 'Polygon':
                            polygons_to_combine.append(sub_g)
                        elif sub_g.geom_type == 'MultiPolygon':
                            polygons_to_combine.extend(sub_g.geoms)

            if not polygons_to_combine:
                continue
                
            final_geom = polygons_to_combine[0] if len(polygons_to_combine) == 1 else MultiPolygon(polygons_to_combine)

            features.append({
                "type": "Feature",
                "geometry": mapping(final_geom),
                "properties": {
                    "value_min": float(level_min),
                    "value_max": float(level_max),
                    "value": float((level_min + level_max) / 2.0)
                }
            })
        
        res = {
            "type": "FeatureCollection",
            "features": features,
            "value_min": float(p1),
            "value_max": float(p99)
        }
        
        tmp_path = disk_cache_path + ".tmp"
        with open(tmp_path, "w") as f:
            json.dump(res, f)
        os.replace(tmp_path, disk_cache_path)
        return res
    except Exception as e:
        print(f"Error computing contours sync: {e}")
        return {"type": "FeatureCollection", "features": []}

async def get_contours_async(file_path: Optional[str], variable: str, time_idx: int, depth: int, tolerance: float, meta: dict):
    canonical_path = get_canonical_file_path(file_path)
    cache_key = (canonical_path, variable, depth, time_idx, tolerance)
    if cache_key in contour_layer_cache:
        return contour_layer_cache[cache_key]

    time_sampling = meta.get("time_sampling", 1)
    loop = asyncio.get_running_loop()
    res = await loop.run_in_executor(
        contour_process_executor,
        compute_contours_sync,
        file_path,
        variable,
        time_idx,
        depth,
        tolerance,
        time_sampling
    )
    contour_layer_cache[cache_key] = res
    return res

def compute_currents_sync(file_path: Optional[str], time_idx: int, depth: int, downsample: int = 2, time_sampling: int = 1):
    canonical_path = get_canonical_file_path(file_path)
    file_prefix = get_file_cache_prefix(canonical_path)
    cache_dir = os.path.join(os.getcwd(), ".cache", "currents")
    os.makedirs(cache_dir, exist_ok=True)
    cache_filename = f"{file_prefix}_curr_d{depth}_t{time_idx}_ds{downsample}.json"
    disk_cache_path = os.path.join(cache_dir, cache_filename)

    resolved_path = canonical_path if (canonical_path != 'default' and os.path.exists(canonical_path)) else NETCDF_PATH
    if not os.path.exists(resolved_path):
        return []

    nc_mtime = os.path.getmtime(resolved_path)

    if os.path.exists(disk_cache_path):
        if os.path.getmtime(disk_cache_path) >= nc_mtime:
            try:
                with open(disk_cache_path, "r") as f:
                    return json.load(f)
            except Exception:
                pass

    try:
        ds_file = xr.open_dataset(resolved_path)
        actual_time = time_idx * time_sampling
        u_slice = ds_file['u'].isel(time=actual_time, depth=depth).values
        v_slice = ds_file['v'].isel(time=actual_time, depth=depth).values
        lon = ds_file['lon_rho'].values
        lat = ds_file['lat_rho'].values
        
        mask = None
        for mask_name in ['mask_rho', 'mask']:
            if mask_name in ds_file:
                mask = ds_file[mask_name].values
                break
        ds_file.close()

        lon_ds = lon[::downsample, ::downsample]
        lat_ds = lat[::downsample, ::downsample]
        u_ds = u_slice[::downsample, ::downsample]
        v_ds = v_slice[::downsample, ::downsample]
        mask_ds = mask[::downsample, ::downsample] if mask is not None else None
        
        rows, cols = lon_ds.shape

        valid_static = ~(np.isnan(lon_ds) | np.isnan(lat_ds))
        if mask_ds is not None:
            valid_static = valid_static & (mask_ds != 0)

        u_vals = np.nan_to_num(u_ds[valid_static], nan=0.0)
        v_vals = np.nan_to_num(v_ds[valid_static], nan=0.0)

        data_mat = np.column_stack([
            np.round(u_vals, 4),
            np.round(v_vals, 4)
        ])
        res = data_mat.tolist()

        tmp_path = disk_cache_path + ".tmp"
        with open(tmp_path, "w") as f:
            json.dump(res, f)
        os.replace(tmp_path, disk_cache_path)
        return res
    except Exception as e:
        print(f"Error computing currents sync: {e}")
        return []

async def get_currents_async(file_path: Optional[str], time_idx: int, depth: int, downsample: int, meta: dict):
    canonical_path = get_canonical_file_path(file_path)
    cache_key = (canonical_path, depth, time_idx, downsample)
    if cache_key in currents_layer_cache:
        return currents_layer_cache[cache_key]

    time_sampling = meta.get("time_sampling", 1)
    loop = asyncio.get_running_loop()
    res = await loop.run_in_executor(
        contour_process_executor,
        compute_currents_sync,
        file_path,
        time_idx,
        depth,
        downsample,
        time_sampling
    )
    currents_layer_cache[cache_key] = res
    return res
