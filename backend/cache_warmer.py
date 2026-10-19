import os
import sys
import time
import json
import glob
import hashlib
import xarray as xr
import numpy as np
from concurrent.futures import ProcessPoolExecutor
import matplotlib
matplotlib.use('Agg')
from matplotlib.figure import Figure
from shapely.geometry import Polygon, MultiPolygon, mapping
from shapely.validation import make_valid
from pymongo import MongoClient

# Set process low priority if on POSIX
try:
    os.nice(10)
except Exception:
    pass

MANIFEST_PATH = os.path.join(os.getcwd(), ".cache", "cache_manifest.json")
WARMING_STATUS_PATH = os.path.join(os.getcwd(), ".cache", "warming_status.json")
MONGODB_URL = os.environ.get("MONGODB_URL", "mongodb://localhost:27017")

def set_warming_status(status_dict: dict):
    try:
        os.makedirs(os.path.dirname(WARMING_STATUS_PATH), exist_ok=True)
        status_dict["timestamp"] = time.time()
        tmp = WARMING_STATUS_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(status_dict, f)
        os.replace(tmp, WARMING_STATUS_PATH)
    except Exception as e:
        print(f"[Cache Warmer] Status write note: {e}")

def get_warming_status() -> dict:
    if os.path.exists(WARMING_STATUS_PATH):
        try:
            with open(WARMING_STATUS_PATH, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {"status": "idle", "last_run": None}

from backend.services.dataset_service import (
    get_canonical_file_path,
    get_file_cache_prefix,
    compute_contours_sync,
    compute_currents_sync,
    resolve_depth_dimension,
    resolve_time_dimension
)

def compute_single_contour_frame(args):
    file_path, variable, time_idx, depth, tolerance, loaded_time, time_sampling = args
    compute_contours_sync(file_path, variable, time_idx, depth, tolerance, time_sampling)
    return True

def compute_single_current_frame(args):
    file_path, time_idx, depth, loaded_time, downsample, u_var, v_var, time_sampling = args
    compute_currents_sync(file_path, time_idx, depth, downsample, time_sampling, u_var, v_var)
    return True

def get_mongodb_file_configs():
    file_configs = {}
    try:
        client = MongoClient(MONGODB_URL, serverSelectionTimeoutMS=2000)
        db = client.ocean_visualizer
        members = list(db.members.find({}, {"variable_groups": 1}))
        for m in members:
            for vg in m.get("variable_groups", []):
                fp = vg.get("file_path")
                if fp:
                    canonical = get_canonical_file_path(fp)
                    if os.path.exists(canonical):
                        file_configs[canonical] = {
                            "variables": vg.get("variables", []),
                            "time_sampling": vg.get("time_sampling", 1)
                        }
        client.close()
    except Exception as e:
        print(f"[Cache Warmer] MongoDB discovery note: {e}")
    return file_configs

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
    file_prefix = get_file_cache_prefix(file_path)
    cache_dirs = [
        os.path.join(os.getcwd(), ".cache", "contours"),
        os.path.join(os.getcwd(), ".cache", "currents")
    ]
    purged_count = 0
    for cdir in cache_dirs:
        if os.path.exists(cdir):
            pattern = os.path.join(cdir, f"{file_prefix}_*")
            for fpath in glob.glob(pattern):
                try:
                    os.remove(fpath)
                    purged_count += 1
                except Exception:
                    pass
    if purged_count > 0:
        print(f"[Cache Warmer] Purged {purged_count} stale cache files for {os.path.basename(file_path)}")

def warm_dataset(file_path: str, max_workers: int = None):
    if not os.path.exists(file_path):
        print(f"[Cache Warmer] NetCDF file not found: {file_path}")
        return

    canonical = get_canonical_file_path(file_path)
    current_mtime = os.path.getmtime(canonical)
    manifest = get_cache_manifest()
    cached_mtime = manifest.get(canonical, 0)

    if cached_mtime and current_mtime <= cached_mtime:
        print(f"[Cache Warmer] Cache for {os.path.basename(file_path)} is up to date ({current_mtime}). Skipping.")
        return

    if current_mtime > cached_mtime:
        print(f"[Cache Warmer] File {file_path} timestamp updated ({current_mtime} > {cached_mtime}). Purging old cache...")
        purge_stale_cache(canonical)

    file_configs = get_mongodb_file_configs()
    cfg = file_configs.get(canonical, {})
    var_defs = cfg.get("variables", []) if isinstance(cfg, dict) else (cfg or [])
    time_sampling = cfg.get("time_sampling", 1) if isinstance(cfg, dict) else 1

    ds = xr.open_dataset(canonical)
    time_dim = resolve_time_dimension(ds)
    depth_dim = resolve_depth_dimension(ds)
    raw_times_len = len(ds[time_dim]) if time_dim and time_dim in ds else 0
    times_len = len(range(0, raw_times_len, time_sampling))
    depths_len = len(ds[depth_dim]) if depth_dim and depth_dim in ds else 1
    ds.close()

    cpus = max_workers or max(1, (os.cpu_count() or 4) - 2)
    print(f"[Cache Warmer] Pre-computing cache for {os.path.basename(file_path)} using {cpus} workers...")

    t0 = time.time()
    contour_tasks = []
    current_tasks = []

    if not var_defs:
        # Fallback default
        var_defs = ['temp', 'salt', 'zeta', 'currents']

    for var_def in var_defs:
        if isinstance(var_def, str):
            if var_def in ['temp', 'salt']:
                for d in range(depths_len):
                    for t in range(times_len):
                        contour_tasks.append((file_path, var_def, t, d, 0.001, 0, time_sampling))
            elif var_def == 'zeta':
                for t in range(times_len):
                    contour_tasks.append((file_path, 'zeta', t, 0, 0.001, 0, time_sampling))
            elif var_def == 'currents':
                for d in range(depths_len):
                    for t in range(times_len):
                        current_tasks.append((file_path, t, d, 0, 2, 'u', 'v', time_sampling))
        elif isinstance(var_def, dict):
            v_type = var_def.get("type")
            if v_type == "scalar_contour":
                nc_var = var_def.get("nc_var")
                is_surface = var_def.get("is_surface_only", False)
                if is_surface:
                    for t in range(times_len):
                        contour_tasks.append((file_path, nc_var, t, 0, 0.001, 0, time_sampling))
                else:
                    for d in range(depths_len):
                        for t in range(times_len):
                            contour_tasks.append((file_path, nc_var, t, d, 0.001, 0, time_sampling))
            elif v_type == "vector_pair":
                u_var = var_def.get("nc_u_var", "u")
                v_var = var_def.get("nc_v_var", "v")
                is_surface = var_def.get("is_surface_only", False)
                if is_surface:
                    for t in range(times_len):
                        current_tasks.append((file_path, t, 0, 0, 2, u_var, v_var, time_sampling))
                else:
                    for d in range(depths_len):
                        for t in range(times_len):
                            current_tasks.append((file_path, t, d, 0, 2, u_var, v_var, time_sampling))

    total_tasks = len(contour_tasks) + len(current_tasks)
    set_warming_status({
        "status": "running",
        "current_file": os.path.basename(file_path),
        "tasks_count": total_tasks,
        "message": f"Processing {total_tasks} frames"
    })

    with ProcessPoolExecutor(max_workers=cpus) as executor:
        if contour_tasks:
            list(executor.map(compute_single_contour_frame, contour_tasks))
        if current_tasks:
            list(executor.map(compute_single_current_frame, current_tasks))

    update_cache_manifest(file_path, current_mtime)
    t1 = time.time()
    elapsed = round(t1 - t0, 1)
    print(f"[Cache Warmer] Completed pre-computation for {os.path.basename(file_path)} in {elapsed} seconds.")
    set_warming_status({
        "status": "idle",
        "last_run": time.time(),
        "last_file": os.path.basename(file_path),
        "elapsed_seconds": elapsed,
        "message": f"Pre-computation completed in {elapsed}s"
    })

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
                    canonical = get_canonical_file_path(fp)
                    if os.path.exists(canonical):
                        file_paths.add(canonical)
        client.close()
    except Exception as e:
        print(f"[Cache Warmer] MongoDB discovery note: {e}")
    return sorted(list(file_paths))

def purge_orphan_caches(active_prefixes: set):
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
                for active_prefix in active_prefixes:
                    if fname.startswith(f"{active_prefix}_"):
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
    set_warming_status({"status": "running", "message": "Discovering MongoDB dataset entries"})
    db_file_paths = get_mongodb_file_paths()
    if not db_file_paths:
        print("[Cache Warmer] No NetCDF dataset file_paths found in MongoDB member variable_groups.")
        set_warming_status({"status": "idle", "message": "No NetCDF dataset files configured"})
        return

    active_prefixes = {get_file_cache_prefix(f) for f in db_file_paths}
    purge_orphan_caches(active_prefixes)

    total = len(db_file_paths)
    print(f"[Cache Warmer] Pre-computing cache strictly for {total} MongoDB dataset entries: {[os.path.basename(f) for f in db_file_paths]}")
    for idx, file_path in enumerate(db_file_paths):
        set_warming_status({
            "status": "running",
            "current_file": os.path.basename(file_path),
            "file_index": idx + 1,
            "total_files": total
        })
        warm_dataset(file_path)

    set_warming_status({
        "status": "idle",
        "last_run": time.time(),
        "total_files_warmed": total,
        "message": "Cache pre-computation complete"
    })

if __name__ == '__main__':
    print("=== Starting Standalone Cache Warmer ===")
    warm_all_datasets()
