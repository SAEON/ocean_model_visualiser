import os
from contextlib import asynccontextmanager
from datetime import datetime
import xarray as xr
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from backend.database import users_collection
from backend.auth import get_password_hash
import backend.services.dataset_service as ds_service
from backend.services.dataset_service import NETCDF_PATH, dataset_cache, contour_process_executor

from backend.routes.auth import router as auth_router
from backend.routes.products import router as products_router
from backend.routes.members import router as members_router
from backend.routes.visualization import router as visualization_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.path.exists(NETCDF_PATH):
        try:
            ds_service.ds = xr.open_dataset(NETCDF_PATH)
            times = [str(t) for t in ds_service.ds['time'].values]
            depths = [float(d) for d in ds_service.ds['depth'].values]
            lon_min = float(ds_service.ds['lon_rho'].min().values)
            lon_max = float(ds_service.ds['lon_rho'].max().values)
            lat_min = float(ds_service.ds['lat_rho'].min().values)
            lat_max = float(ds_service.ds['lat_rho'].max().values)
            
            var_ranges = {}
            for var in ['temp', 'salt', 'zeta', 'u', 'v']:
                if var in ds_service.ds:
                    if var == 'zeta':
                        slice_data = ds_service.ds[var].isel(time=0).values
                        val_min, val_max = np.nanpercentile(slice_data, [1, 99])
                        var_ranges[var] = {"min": float(val_min), "max": float(val_max)}
                    else:
                        depth_ranges = []
                        for d_idx in range(len(depths)):
                            slice_d = ds_service.ds[var].isel(time=0, depth=d_idx).values
                            d_min, d_max = np.nanpercentile(slice_d, [1, 99])
                            depth_ranges.append({"min": float(d_min), "max": float(d_max)})
                        var_ranges[var] = depth_ranges
                
            ds_service.metadata_cache = {
                "times": times,
                "depths": depths,
                "bounds": {
                    "lon_min": lon_min,
                    "lon_max": lon_max,
                    "lat_min": lat_min,
                    "lat_max": lat_max
                },
                "ranges": var_ranges
            }
            print("Backend initialized. Static metadata cache ready.")
        except Exception as e:
            print(f"Warning: Could not initialize static NetCDF file cache. Error: {e}")
    else:
        print(f"Warning: Static NetCDF file not found at {NETCDF_PATH}. Skipping cache initialization.")
        
    try:
        default_user = os.environ.get("ADMIN_USERNAME", "admin")
        default_pass = os.environ.get("ADMIN_PASSWORD", "admin123")
        existing_admin = await users_collection.find_one({"username": default_user})
        if existing_admin is None:
            hashed = get_password_hash(default_pass)
            await users_collection.insert_one({
                "username": default_user,
                "hashed_password": hashed,
                "role": "admin",
                "created_at": datetime.utcnow()
            })
            print(f"Seeded default admin user: '{default_user}'")
    except Exception as e:
        print(f"Error seeding default admin user: {e}")

    yield

    if ds_service.ds is not None:
        ds_service.ds.close()
    for cached_ds, _, _ in dataset_cache.values():
        try:
            cached_ds.close()
        except Exception:
            pass
    contour_process_executor.shutdown(wait=False)
    print("Datasets and process pool closed.")

app = FastAPI(title="Ocean Model Visualizer API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.include_router(auth_router)
app.include_router(products_router)
app.include_router(members_router)
app.include_router(visualization_router)
