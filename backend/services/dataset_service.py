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

from collections import OrderedDict
import threading

class BoundedLRUCache:
    def __init__(self, maxsize=600, on_evict=None):
        self.maxsize = maxsize
        self.on_evict = on_evict
        self.cache = OrderedDict()
        self.lock = threading.Lock()

    def __getitem__(self, key):
        with self.lock:
            val = self.cache[key]
            self.cache.move_to_end(key)
            return val

    def __setitem__(self, key, value):
        with self.lock:
            if key in self.cache:
                self.cache.move_to_end(key)
            self.cache[key] = value
            if len(self.cache) > self.maxsize:
                oldest_key, oldest_val = self.cache.popitem(last=False)
                if self.on_evict:
                    try:
                        self.on_evict(oldest_key, oldest_val)
                    except Exception as e:
                        print(f"Error in LRU eviction callback: {e}")

    def __contains__(self, key):
        with self.lock:
            return key in self.cache

    def __delitem__(self, key):
        with self.lock:
            del self.cache[key]

    def get(self, key, default=None):
        with self.lock:
            if key not in self.cache:
                return default
            self.cache.move_to_end(key)
            return self.cache[key]

    def pop(self, key, default=None):
        with self.lock:
            if key in self.cache:
                val = self.cache.pop(key)
                if self.on_evict:
                    try:
                        self.on_evict(key, val)
                    except Exception:
                        pass
                return val
            return default

    def clear(self):
        with self.lock:
            if self.on_evict:
                for k, v in list(self.cache.items()):
                    try:
                        self.on_evict(k, v)
                    except Exception:
                        pass
            self.cache.clear()

    def __len__(self):
        with self.lock:
            return len(self.cache)

    def __iter__(self):
        with self.lock:
            return iter(list(self.cache.keys()))

    def keys(self):
        with self.lock:
            return list(self.cache.keys())

    def values(self):
        with self.lock:
            return list(self.cache.values())

    def items(self):
        with self.lock:
            return list(self.cache.items())

def _evict_dataset(key, val):
    if isinstance(val, tuple) and len(val) >= 1:
        ds_handle = val[0]
        try:
            ds_handle.close()
        except Exception:
            pass

ds = None
metadata_cache = {}
dataset_cache = BoundedLRUCache(maxsize=12, on_evict=_evict_dataset)
contour_layer_cache = BoundedLRUCache(maxsize=800)
currents_layer_cache = BoundedLRUCache(maxsize=800)

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

def resolve_coordinates(ds: xr.Dataset):
    """Find longitude and latitude coordinate variable names."""
    lon_var = None
    lat_var = None
    for cand in ['lon_rho', 'nav_lon', 'lon', 'longitude']:
        if cand in ds or cand in ds.coords:
            lon_var = cand
            break
    for cand in ['lat_rho', 'nav_lat', 'lat', 'latitude']:
        if cand in ds or cand in ds.coords:
            lat_var = cand
            break
    return lon_var, lat_var

def resolve_depth_dimension(ds: xr.Dataset):
    """Find vertical depth dimension/coordinate name."""
    for cand in ['depth', 's_rho', 'z_rho', 'z', 'level', 'lev']:
        if cand in ds.dims or cand in ds.coords:
            return cand
    return None

def resolve_time_dimension(ds: xr.Dataset):
    """Find time dimension/coordinate name."""
    for cand in ['time', 'ocean_time', 'time_counter']:
        if cand in ds.dims or cand in ds.coords:
            return cand
    return None

def resolve_mask(ds: xr.Dataset):
    """Find land/water mask variable name."""
    for cand in ['mask_rho', 'mask', 'land_mask']:
        if cand in ds:
            return cand
    return None

def get_variable_definition(meta: Optional[dict], variable_name: str) -> Optional[dict]:
    """Look up variable definition in metadata by id or nc_var."""
    if not meta:
        return None
    for v_def in meta.get("variables", []):
        if isinstance(v_def, dict):
            if v_def.get("id") == variable_name or v_def.get("nc_var") == variable_name:
                return v_def
    return None

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

        time_dim = resolve_time_dimension(dataset)
        raw_times = [str(t) for t in dataset[time_dim].values] if time_dim and time_dim in dataset else []
        times = raw_times[::time_sampling]

        depth_dim = resolve_depth_dimension(dataset)
        depths = [float(d) for d in dataset[depth_dim].values] if depth_dim and depth_dim in dataset else []

        lon_var, lat_var = resolve_coordinates(dataset)
        if not lon_var or not lat_var:
            raise HTTPException(status_code=400, detail="Coordinates (lon/lat) not found in NetCDF file")

        lon_min = float(np.nanmin(dataset[lon_var].values))
        lon_max = float(np.nanmax(dataset[lon_var].values))
        lat_min = float(np.nanmin(dataset[lat_var].values))
        lat_max = float(np.nanmax(dataset[lat_var].values))

        parsed_variables = []
        if allowed_vars:
            for v in allowed_vars:
                if isinstance(v, str):
                    if v == 'temp':
                        parsed_variables.append({
                            "id": "temp", "type": "scalar_contour", "nc_var": "temp",
                            "display_name": "Temperature", "unit": "°C", "color_scheme": "thermal",
                            "is_surface_only": False
                        })
                    elif v == 'salt':
                        parsed_variables.append({
                            "id": "salt", "type": "scalar_contour", "nc_var": "salt",
                            "display_name": "Salinity", "unit": "psu", "color_scheme": "haline",
                            "is_surface_only": False
                        })
                    elif v == 'zeta':
                        parsed_variables.append({
                            "id": "zeta", "type": "scalar_contour", "nc_var": "zeta",
                            "display_name": "Sea Surface Height", "unit": "m", "color_scheme": "spectral",
                            "is_surface_only": True
                        })
                    elif v == 'currents':
                        parsed_variables.append({
                            "id": "currents", "type": "vector_pair", "nc_u_var": "u", "nc_v_var": "v",
                            "display_name": "Currents", "unit": "m/s", "is_surface_only": False
                        })
                elif isinstance(v, dict):
                    parsed_variables.append(v)
        else:
            for nc_var in dataset.data_vars:
                var_dims = [str(d) for d in dataset[nc_var].dims]
                has_depth = any(d in var_dims for d in ['depth', 's_rho', 'z_rho', 'z', 'level', 'lev'])
                parsed_variables.append({
                    "id": str(nc_var),
                    "type": "vector_pair" if str(nc_var).lower() in ['u', 'v'] else "scalar_contour",
                    "nc_var": str(nc_var),
                    "nc_u_var": "u" if str(nc_var).lower() == 'u' else None,
                    "nc_v_var": "v" if str(nc_var).lower() == 'v' else None,
                    "display_name": str(nc_var).title(),
                    "unit": str(dataset[nc_var].attrs.get('units', '')),
                    "color_scheme": "thermal" if 'temp' in str(nc_var).lower() else "viridis",
                    "is_surface_only": not has_depth
                })

        var_ranges = {}
        for var_def in parsed_variables:
            v_type = var_def.get("type")
            if v_type == "scalar_contour":
                nc_var = var_def.get("nc_var")
                if not nc_var or nc_var not in dataset:
                    continue
                var_dims = [str(d) for d in dataset[nc_var].dims]
                has_depth = any(d in var_dims for d in ['depth', 's_rho', 'z_rho', 'z', 'level', 'lev'])
                is_surface = not has_depth
                isel_time = {time_dim: 0} if time_dim and time_dim in var_dims else {}
                if is_surface:
                    slice_data = dataset[nc_var].isel(**isel_time).values
                    val_min, val_max = np.nanpercentile(slice_data, [1, 99])
                    range_entry = {"min": float(val_min), "max": float(val_max)}
                    var_ranges[nc_var] = range_entry
                    if var_def.get("id") and var_def.get("id") != nc_var:
                        var_ranges[var_def["id"]] = range_entry
                else:
                    depth_ranges = []
                    d_dim_name = depth_dim if depth_dim and depth_dim in var_dims else None
                    for d_idx in range(len(depths)):
                        isel_kwargs = dict(isel_time)
                        if d_dim_name:
                            isel_kwargs[d_dim_name] = d_idx
                        slice_d = dataset[nc_var].isel(**isel_kwargs).values
                        d_min, d_max = np.nanpercentile(slice_d, [1, 99])
                        depth_ranges.append({"min": float(d_min), "max": float(d_max)})
                    var_ranges[nc_var] = depth_ranges
                    if var_def.get("id") and var_def.get("id") != nc_var:
                        var_ranges[var_def["id"]] = depth_ranges

            elif v_type == "vector_pair":
                u_var = var_def.get("nc_u_var", "u")
                v_var = var_def.get("nc_v_var", "v")
                for uv_name in [u_var, v_var]:
                    if uv_name and uv_name in dataset and uv_name not in var_ranges:
                        var_dims = [str(d) for d in dataset[uv_name].dims]
                        has_depth = any(d in var_dims for d in ['depth', 's_rho', 'z_rho', 'z', 'level', 'lev'])
                        is_surface = not has_depth
                        isel_time = {time_dim: 0} if time_dim and time_dim in var_dims else {}
                        if is_surface:
                            slice_data = dataset[uv_name].isel(**isel_time).values
                            val_min, val_max = np.nanpercentile(slice_data, [1, 99])
                            var_ranges[uv_name] = {"min": float(val_min), "max": float(val_max)}
                        else:
                            depth_ranges = []
                            d_dim_name = depth_dim if depth_dim and depth_dim in var_dims else None
                            for d_idx in range(len(depths)):
                                isel_kwargs = dict(isel_time)
                                if d_dim_name:
                                    isel_kwargs[d_dim_name] = d_idx
                                slice_d = dataset[uv_name].isel(**isel_kwargs).values
                                d_min, d_max = np.nanpercentile(slice_d, [1, 99])
                                depth_ranges.append({"min": float(d_min), "max": float(d_max)})
                            var_ranges[uv_name] = depth_ranges

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
            "variables": parsed_variables,
            "time_sampling": time_sampling,
            "canonical_path": canonical_path,
            "coordinates": {
                "longitude": lon_var,
                "latitude": lat_var,
                "depth": depth_dim,
                "time": time_dim
            }
        }
        dataset_cache[file_path] = (dataset, meta, time.time())
        return dataset, meta
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to open or parse NetCDF at {file_path}. Error: {str(e)}")

def inspect_netcdf_file(file_path: str) -> dict:
    canonical_path = get_canonical_file_path(file_path)
    if not os.path.exists(canonical_path):
        raise HTTPException(status_code=400, detail=f"NetCDF file not found at path: {file_path}")

    try:
        ds = xr.open_dataset(canonical_path, decode_times=False)
        discovered_vars = []

        lon_var, lat_var = resolve_coordinates(ds)
        depth_var = resolve_depth_dimension(ds)

        for var_name, data_array in ds.data_vars.items():
            dims = [str(d) for d in data_array.dims]
            attrs = data_array.attrs
            
            has_depth = any(d in dims for d in ['depth', 's_rho', 'z_rho', 'z', 'level', 'lev'])
            is_surface_only = not has_depth

            long_name = attrs.get('long_name') or attrs.get('standard_name') or var_name
            units = attrs.get('units') or ''

            if str(var_name).lower() in ['u', 'v', 'water_u', 'water_v', 'u10', 'v10']:
                suggested_type = 'vector_pair'
            else:
                suggested_type = 'scalar_contour'

            v_lower = str(var_name).lower()
            if 'temp' in v_lower or 'sst' in v_lower:
                color_scheme = 'thermal'
            elif 'salt' in v_lower or 'sal' in v_lower:
                color_scheme = 'haline'
            elif 'zeta' in v_lower or 'height' in v_lower or 'ssh' in v_lower:
                color_scheme = 'spectral'
            else:
                color_scheme = 'viridis'

            discovered_vars.append({
                "nc_var": str(var_name),
                "display_name": str(long_name).title(),
                "unit": str(units),
                "dims": dims,
                "is_surface_only": is_surface_only,
                "suggested_type": suggested_type,
                "suggested_color_scheme": color_scheme
            })

        ds.close()

        return {
            "file_path": file_path,
            "canonical_path": canonical_path,
            "variables": discovered_vars,
            "coordinates": {
                "longitude": lon_var,
                "latitude": lat_var,
                "depth": depth_var
            }
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to inspect NetCDF at {file_path}. Error: {str(e)}")

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

        time_dim = resolve_time_dimension(ds_file) or 'time'
        depth_dim = resolve_depth_dimension(ds_file) or 'depth'
        lon_var, lat_var = resolve_coordinates(ds_file)
        if not lon_var or not lat_var:
            ds_file.close()
            return {"type": "FeatureCollection", "features": []}

        target_var = variable
        if target_var not in ds_file:
            for dv in ds_file.data_vars:
                if str(dv).lower() == variable.lower():
                    target_var = str(dv)
                    break

        if target_var not in ds_file:
            ds_file.close()
            return {"type": "FeatureCollection", "features": []}

        var_dims = [str(d) for d in ds_file[target_var].dims]
        isel_kwargs = {}
        if time_dim in var_dims:
            max_t = ds_file.sizes.get(time_dim, 0)
            if max_t > 0:
                isel_kwargs[time_dim] = min(actual_time, max_t - 1)
        if depth_dim in var_dims:
            max_d = ds_file.sizes.get(depth_dim, 0)
            if max_d > 0:
                isel_kwargs[depth_dim] = max(0, min(depth, max_d - 1))

        slice_data = ds_file[target_var].isel(**isel_kwargs)
        z = slice_data.values
        lon = ds_file[lon_var].values
        lat = ds_file[lat_var].values
        ds_file.close()

        if len(lon.shape) == 1 and len(lat.shape) == 1:
            lon, lat = np.meshgrid(lon, lat)
        
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

def compute_currents_sync(file_path: Optional[str], time_idx: int, depth: int, downsample: int = 2, time_sampling: int = 1, u_var: str = 'u', v_var: str = 'v'):
    canonical_path = get_canonical_file_path(file_path)
    file_prefix = get_file_cache_prefix(canonical_path)
    cache_dir = os.path.join(os.getcwd(), ".cache", "currents")
    os.makedirs(cache_dir, exist_ok=True)
    cache_filename = f"{file_prefix}_curr_{u_var}_{v_var}_d{depth}_t{time_idx}_ds{downsample}.json"
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

        time_dim = resolve_time_dimension(ds_file) or 'time'
        depth_dim = resolve_depth_dimension(ds_file) or 'depth'
        lon_var, lat_var = resolve_coordinates(ds_file)
        if not lon_var or not lat_var:
            ds_file.close()
            return []

        target_u = u_var if u_var in ds_file else 'u'
        target_v = v_var if v_var in ds_file else 'v'

        if target_u not in ds_file or target_v not in ds_file:
            ds_file.close()
            return []

        u_dims = [str(d) for d in ds_file[target_u].dims]
        v_dims = [str(d) for d in ds_file[target_v].dims]

        isel_u = {}
        isel_v = {}
        if time_dim in u_dims:
            max_t = ds_file.sizes.get(time_dim, 0)
            if max_t > 0:
                isel_u[time_dim] = min(actual_time, max_t - 1)
        if time_dim in v_dims:
            max_t = ds_file.sizes.get(time_dim, 0)
            if max_t > 0:
                isel_v[time_dim] = min(actual_time, max_t - 1)

        if depth_dim in u_dims:
            max_d = ds_file.sizes.get(depth_dim, 0)
            if max_d > 0:
                isel_u[depth_dim] = max(0, min(depth, max_d - 1))
        if depth_dim in v_dims:
            max_d = ds_file.sizes.get(depth_dim, 0)
            if max_d > 0:
                isel_v[depth_dim] = max(0, min(depth, max_d - 1))

        u_slice = ds_file[target_u].isel(**isel_u).values
        v_slice = ds_file[target_v].isel(**isel_v).values
        lon = ds_file[lon_var].values
        lat = ds_file[lat_var].values

        if len(lon.shape) == 1 and len(lat.shape) == 1:
            lon, lat = np.meshgrid(lon, lat)

        mask = None
        mask_name = resolve_mask(ds_file)
        if mask_name and mask_name in ds_file:
            mask = ds_file[mask_name].values
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

async def get_currents_async(file_path: Optional[str], time_idx: int, depth: int, downsample: int, meta: dict, u_var: str = 'u', v_var: str = 'v'):
    canonical_path = get_canonical_file_path(file_path)
    cache_key = (canonical_path, u_var, v_var, depth, time_idx, downsample)
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
        time_sampling,
        u_var,
        v_var
    )
    currents_layer_cache[cache_key] = res
    return res
