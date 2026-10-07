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
MONGODB_URL = os.environ.get("MONGODB_URL", "mongodb://localhost:27017")

from backend.services.dataset_service import (
    get_canonical_file_path,
    get_file_cache_prefix,
    compute_contours_sync,
    compute_currents_sync
)

def compute_single_contour_frame(args):
    file_path, variable, time_idx, depth, tolerance, loaded_time = args
    compute_contours_sync(file_path, variable, time_idx, depth, tolerance)
    return True

def compute_single_current_frame(args):
    file_path, time_idx, depth, loaded_time, downsample = args
    compute_currents_sync(file_path, time_idx, depth, downsample)
    return True

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
    db_file_paths = get_mongodb_file_paths()
    if not db_file_paths:
        print("[Cache Warmer] No NetCDF dataset file_paths found in MongoDB member variable_groups.")
        return

    active_prefixes = {get_file_cache_prefix(f) for f in db_file_paths}
    purge_orphan_caches(active_prefixes)

    print(f"[Cache Warmer] Pre-computing cache strictly for {len(db_file_paths)} MongoDB dataset entries: {[os.path.basename(f) for f in db_file_paths]}")
    for file_path in db_file_paths:
        warm_dataset(file_path)

if __name__ == '__main__':
    print("=== Starting Standalone Cache Warmer ===")
    warm_all_datasets()
