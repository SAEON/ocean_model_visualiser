import os
import sys
import time
import json
import glob
import xarray as xr
import numpy as np
from concurrent.futures import ProcessPoolExecutor
import matplotlib
matplotlib.use('Agg')
from matplotlib.figure import Figure
from shapely.geometry import Polygon, MultiPolygon, mapping
from shapely.validation import make_valid

# Set process low priority if on POSIX
try:
    os.nice(10)
except Exception:
    pass

MANIFEST_PATH = os.path.join(os.getcwd(), ".cache", "cache_manifest.json")

def get_cache_manifest():
    if os.path.exists(MANIFEST_PATH):
        try:
            with open(MANIFEST_PATH, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def update_cache_manifest(file_path: str, mtime: float):
    manifest = get_cache_manifest()
    manifest[file_path] = mtime
    os.makedirs(os.path.dirname(MANIFEST_PATH), exist_ok=True)
    tmp_path = MANIFEST_PATH + ".tmp"
    with open(tmp_path, "w") as f:
        json.dump(manifest, f, indent=2)
    os.replace(tmp_path, MANIFEST_PATH)

def purge_stale_cache(file_path: str):
    file_basename = os.path.basename(file_path or 'default')
    cache_dirs = [
        os.path.join(os.getcwd(), ".cache", "contours"),
        os.path.join(os.getcwd(), ".cache", "currents")
    ]
    purged_count = 0
    for cdir in cache_dirs:
        if os.path.exists(cdir):
            pattern = os.path.join(cdir, f"{file_basename}_*")
            for fpath in glob.glob(pattern):
                try:
                    os.remove(fpath)
                    purged_count += 1
                except Exception:
                    pass
    if purged_count > 0:
        print(f"[Cache Warmer] Purged {purged_count} stale cache files for {file_basename}")

def compute_single_contour_frame(args):
    file_path, variable, time_idx, depth, tolerance, loaded_time = args
    cache_dir = os.path.join(os.getcwd(), ".cache", "contours")
    os.makedirs(cache_dir, exist_ok=True)
    file_basename = os.path.basename(file_path or 'default')
    cache_filename = f"{file_basename}_{variable}_{depth}_{time_idx}_tol{tolerance}.json"
    disk_cache_path = os.path.join(cache_dir, cache_filename)

    if os.path.exists(disk_cache_path):
        return True

    try:
        ds = xr.open_dataset(file_path)
        slice_data = ds[variable].isel(time=time_idx) if variable == 'zeta' else ds[variable].isel(time=time_idx, depth=depth)
        z = slice_data.values
        lon = ds['lon_rho'].values
        lat = ds['lat_rho'].values
        ds.close()

        if np.isnan(z).all():
            res = {"type": "FeatureCollection", "features": []}
        else:
            p1 = float(np.nanpercentile(z, 1))
            p99 = float(np.nanpercentile(z, 99))
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
        return True
    except Exception as e:
        print(f"[Cache Warmer] Error computing contour frame {time_idx}: {e}")
        return False

def compute_single_current_frame(args):
    file_path, time_idx, depth, loaded_time, downsample = args
    cache_dir = os.path.join(os.getcwd(), ".cache", "currents")
    os.makedirs(cache_dir, exist_ok=True)
    file_basename = os.path.basename(file_path or 'default')
    cache_filename = f"{file_basename}_curr_d{depth}_t{time_idx}_ds{downsample}.json"
    disk_cache_path = os.path.join(cache_dir, cache_filename)

    if os.path.exists(disk_cache_path):
        return True

    try:
        ds = xr.open_dataset(file_path)
        u_slice = ds['u'].isel(time=time_idx, depth=depth).values
        v_slice = ds['v'].isel(time=time_idx, depth=depth).values
        lon = ds['lon_rho'].values
        lat = ds['lat_rho'].values
        
        mask = None
        for mask_name in ['mask_rho', 'mask']:
            if mask_name in ds:
                mask = ds[mask_name].values
                break
        ds.close()

        lon_ds = lon[::downsample, ::downsample]
        lat_ds = lat[::downsample, ::downsample]
        u_ds = u_slice[::downsample, ::downsample]
        v_ds = v_slice[::downsample, ::downsample]
        mask_ds = mask[::downsample, ::downsample] if mask is not None else None

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
        return True
    except Exception as e:
        print(f"[Cache Warmer] Error computing current frame {time_idx}: {e}")
        return False

def warm_dataset(file_path: str, max_workers: int = None):
    if not os.path.exists(file_path):
        print(f"[Cache Warmer] NetCDF file not found: {file_path}")
        return

    current_mtime = os.path.getmtime(file_path)
    manifest = get_cache_manifest()
    cached_mtime = manifest.get(file_path, 0)

    if current_mtime > cached_mtime:
        print(f"[Cache Warmer] File {file_path} timestamp updated ({current_mtime} > {cached_mtime}). Purging old cache...")
        purge_stale_cache(file_path)

    ds = xr.open_dataset(file_path)
    times_len = len(ds['time']) if 'time' in ds else 0
    depths_len = len(ds['depth']) if 'depth' in ds else 1
    has_temp = 'temp' in ds
    has_salt = 'salt' in ds
    has_zeta = 'zeta' in ds
    has_uv = 'u' in ds and 'v' in ds
    ds.close()

    cpus = max_workers or max(1, (os.cpu_count() or 4) - 2)
    print(f"[Cache Warmer] Pre-computing cache for {os.path.basename(file_path)} using {cpus} workers...")

    t0 = time.time()
    contour_tasks = []
    current_tasks = []

    for d in range(depths_len):
        for t in range(times_len):
            if has_temp:
                contour_tasks.append((file_path, 'temp', t, d, 0.001, 0))
            if has_salt:
                contour_tasks.append((file_path, 'salt', t, d, 0.001, 0))
            if has_uv:
                current_tasks.append((file_path, t, d, 0, 2))
                
    if has_zeta:
        for t in range(times_len):
            contour_tasks.append((file_path, 'zeta', t, 0, 0.001, 0))

    with ProcessPoolExecutor(max_workers=cpus) as executor:
        if contour_tasks:
            list(executor.map(compute_single_contour_frame, contour_tasks))
        if current_tasks:
            list(executor.map(compute_single_current_frame, current_tasks))

    update_cache_manifest(file_path, current_mtime)
    t1 = time.time()
    print(f"[Cache Warmer] Completed pre-computation for {os.path.basename(file_path)} in {(t1-t0):.1f} seconds.")

from pymongo import MongoClient

MONGODB_URL = os.environ.get("MONGODB_URL", "mongodb://localhost:27017")

def get_mongodb_file_paths():
    file_paths = set()
    try:
        client = MongoClient(MONGODB_URL, serverSelectionTimeoutMS=2000)
        db = client.ocean_visualizer
        members = list(db.members.find({}, {"variable_groups": 1}))
        for m in members:
            for vg in m.get("variable_groups", []):
                fp = vg.get("file_path")
                if fp:
                    resolved = fp
                    if not os.path.exists(resolved):
                        if os.path.exists(os.path.join(os.getcwd(), os.path.basename(fp))):
                            resolved = os.path.join(os.getcwd(), os.path.basename(fp))
                        elif os.path.exists(os.path.join("/data", os.path.basename(fp))):
                            resolved = os.path.join("/data", os.path.basename(fp))
                    if os.path.exists(resolved):
                        file_paths.add(resolved)
        client.close()
    except Exception as e:
        print(f"[Cache Warmer] MongoDB discovery note: {e}")
    return sorted(list(file_paths))

def purge_orphan_caches(active_basenames: set):
    cache_dirs = [
        os.path.join(os.getcwd(), ".cache", "contours"),
        os.path.join(os.getcwd(), ".cache", "currents")
    ]
    purged_count = 0
    for cdir in cache_dirs:
        if os.path.exists(cdir):
            for fname in os.listdir(cdir):
                fpath = os.path.join(cdir, fname)
                if not os.path.isfile(fpath):
                    continue
                matched = False
                for active_base in active_basenames:
                    if fname.startswith(f"{active_base}_"):
                        matched = True
                        break
                if not matched:
                    try:
                        os.remove(fpath)
                        purged_count += 1
                    except Exception:
                        pass
    if purged_count > 0:
        print(f"[Cache Warmer] Purged {purged_count} orphan cache files not listed in MongoDB.")

def warm_all_datasets():
    # 1. Discover dataset files STRICTLY from MongoDB product member variable groups
    db_file_paths = get_mongodb_file_paths()
    if not db_file_paths:
        print("[Cache Warmer] No NetCDF dataset file_paths found in MongoDB member variable_groups.")
        return

    active_basenames = {os.path.basename(f) for f in db_file_paths}

    # 2. Purge orphan cache files for datasets NOT listed in MongoDB
    purge_orphan_caches(active_basenames)

    print(f"[Cache Warmer] Pre-computing cache strictly for {len(db_file_paths)} MongoDB dataset entries: {[os.path.basename(f) for f in db_file_paths]}")
    for file_path in db_file_paths:
        warm_dataset(file_path)

if __name__ == '__main__':
    print("=== Starting Standalone Cache Warmer ===")
    warm_all_datasets()
