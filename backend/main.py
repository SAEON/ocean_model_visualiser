import os
import time
import asyncio
from typing import Optional
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from fastapi import FastAPI, Query, HTTPException, Depends, status, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
import bcrypt
import xarray as xr
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from shapely.geometry import Polygon, MultiPolygon, mapping
from shapely.validation import make_valid
from bson import ObjectId

# Database imports
from backend.database import products_collection, members_collection, users_collection
from backend.schemas import (
    ProductCreate,
    ProductResponse,
    ProductUpdate,
    MemberCreate,
    MemberResponse,
    MemberUpdate,
    UserLogin,
    TokenResponse,
    UserResponse,
    serialize_doc
)

# JWT & Authentication Configurations
SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "somisana-ocean-model-visualiser-secret-key-2026")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours

security = HTTPBearer()

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        pwd_bytes = plain_password.encode('utf-8')
        hash_bytes = hashed_password.encode('utf-8')
        return bcrypt.checkpw(pwd_bytes, hash_bytes)
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    pwd_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_admin(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token",
                headers={"WWW-Authenticate": "Bearer"},
            )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired or invalid",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = await users_collection.find_one({"username": username})
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


# Paths
NETCDF_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "croco_avg_t2.nc")

# Globals for caching (for static single-file visualization fallback)
ds = None
metadata_cache = {}
dataset_cache = {}
contour_layer_cache = {}

async def get_cached_dataset(file_path: str):
    now = time.time()

    resolved_path = file_path
    if not os.path.exists(resolved_path):
        if resolved_path.startswith("/data/"):
            fallback = os.path.join(os.getcwd(), os.path.basename(resolved_path))
            if os.path.exists(fallback):
                resolved_path = fallback

    if not os.path.exists(resolved_path):
        if file_path in dataset_cache:
            dataset, _, _ = dataset_cache.pop(file_path)
            try:
                dataset.close()
            except Exception:
                pass
            # Clear matching contour layer caches
            keys_to_del = [k for k in contour_layer_cache if k[0] == (file_path or '')]
            for k in keys_to_del:
                del contour_layer_cache[k]
        raise HTTPException(status_code=400, detail=f"NetCDF file not found at path: {file_path}")

    mtime = os.path.getmtime(resolved_path)

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
            # Clear matching contour layer caches
            keys_to_del = [k for k in contour_layer_cache if k[0] == (file_path or '')]
            for k in keys_to_del:
                del contour_layer_cache[k]
    try:
        dataset = xr.open_dataset(resolved_path)
        
        # Look up allowed variables and time sampling for this file path from the database
        allowed_vars = None
        time_sampling = 1
        try:
            member = await members_collection.find_one({"variable_groups.file_path": file_path})
            if member:
                for vg in member.get("variable_groups", []):
                    if vg.get("file_path") == file_path:
                        allowed_vars = vg.get("variables", [])
                        time_sampling = vg.get("time_sampling", 1)
                        break
        except Exception as e:
            print(f"Error querying database for file_path {file_path}: {e}")

        raw_times = [str(t) for t in dataset['time'].values]
        times = raw_times[::time_sampling]
        depths = [float(d) for d in dataset['depth'].values] if 'depth' in dataset else []
        
        # Spatial bounds
        lon_min = float(dataset['lon_rho'].min().values)
        lon_max = float(dataset['lon_rho'].max().values)
        lat_min = float(dataset['lat_rho'].min().values)
        lat_max = float(dataset['lat_rho'].max().values)

        # Map frontend variable selections to NetCDF variables
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
                vals = dataset[var][::4, ::4, ::4].values
                val_min, val_max = np.nanpercentile(vals, [5, 95])
                var_ranges[var] = {"min": float(val_min), "max": float(val_max)}
            else:
                depth_ranges = []
                for d_idx in range(len(depths)):
                    slice_d = dataset[var].isel(depth=d_idx)
                    vals = slice_d[::4, ::4, ::4].values
                    d_min, d_max = np.nanpercentile(vals, [5, 95])
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
            "time_sampling": time_sampling
        }
        dataset_cache[file_path] = (dataset, meta, time.time())
        return dataset, meta
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to open or parse NetCDF at {file_path}. Error: {str(e)}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    global ds, metadata_cache
    if os.path.exists(NETCDF_PATH):
        try:
            # Open dataset lazily using dask chunks if possible, or just standard lazy loading
            ds = xr.open_dataset(NETCDF_PATH)
            
            # Extract times and depths
            times = [str(t) for t in ds['time'].values]
            depths = [float(d) for d in ds['depth'].values]
            
            # Get spatial bounds
            lon_min = float(ds['lon_rho'].min().values)
            lon_max = float(ds['lon_rho'].max().values)
            lat_min = float(ds['lat_rho'].min().values)
            lat_max = float(ds['lat_rho'].max().values)
            
            # Precompute ranges for variables
            var_ranges = {}
            for var in ['temp', 'salt', 'zeta', 'u', 'v']:
                if var == 'zeta':
                    vals = ds[var][::4, ::4, ::4].values
                    val_min, val_max = np.nanpercentile(vals, [5, 95])
                    var_ranges[var] = {"min": float(val_min), "max": float(val_max)}
                else:
                    depth_ranges = []
                    for d_idx in range(len(depths)):
                        slice_d = ds[var].isel(depth=d_idx)
                        vals = slice_d[::4, ::4, ::4].values
                        d_min, d_max = np.nanpercentile(vals, [5, 95])
                        depth_ranges.append({"min": float(d_min), "max": float(d_max)})
                    var_ranges[var] = depth_ranges
                
            metadata_cache = {
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
        
    # Seed default admin user if not present
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
    # Cleanup
    if ds is not None:
        ds.close()
    for cached_ds, _, _ in dataset_cache.values():
        try:
            cached_ds.close()
        except Exception:
            pass
    print("Datasets closed.")

app = FastAPI(title="Ocean Model Visualizer API", lifespan=lifespan)

# Enable CORS & GZip Compression
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Authentication Endpoints
@app.post("/api/auth/login", response_model=TokenResponse)
async def login(credentials: UserLogin):
    user = await users_collection.find_one({"username": credentials.username.strip()})
    if not user or not verify_password(credentials.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token = create_access_token(data={"sub": user["username"], "role": user.get("role", "admin")})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "username": user["username"]
    }

@app.get("/api/auth/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_admin)):
    return {
        "id": str(current_user["_id"]),
        "username": current_user["username"],
        "role": current_user.get("role", "admin")
    }


@app.get("/api/metadata")
async def get_metadata(file_path: Optional[str] = None):
    if file_path:
        _, meta = await get_cached_dataset(file_path)
        return meta
    if not metadata_cache:
        raise HTTPException(status_code=503, detail="Service initializing")
    return metadata_cache

def compute_contours_sync(file_path: Optional[str], variable: str, time_idx: int, depth: int, tolerance: float, loaded_time: float, dataset, meta):
    cache_key = (file_path or '', variable, depth, time_idx, tolerance, loaded_time)
    if cache_key in contour_layer_cache:
        return contour_layer_cache[cache_key]

    time_sampling = meta.get("time_sampling", 1)
    actual_time = time_idx * time_sampling

    if variable == 'zeta':
        slice_data = dataset['zeta'].isel(time=actual_time)
    else:
        slice_data = dataset[variable].isel(time=actual_time, depth=depth)
        
    z = slice_data.values
    lon = dataset['lon_rho'].values
    lat = dataset['lat_rho'].values
    
    if np.isnan(z).all():
        res = {"type": "FeatureCollection", "features": []}
        contour_layer_cache[cache_key] = res
        return res
        
    z_min = float(np.nanmin(z))
    z_max = float(np.nanmax(z))
    
    if z_min == z_max:
        res = {"type": "FeatureCollection", "features": [], "value_min": z_min, "value_max": z_max}
        contour_layer_cache[cache_key] = res
        return res
        
    p1 = float(np.nanpercentile(z, 1))
    p99 = float(np.nanpercentile(z, 99))
    if p1 == p99:
        p1 = z_min
        p99 = z_max
        
    z_clipped = np.clip(z, p1, p99)
    levels = np.linspace(p1, p99, 20)
    
    fig, ax = plt.subplots()
    cs = ax.contourf(lon, lat, z_clipped, levels=levels)
    
    features = []
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
            polys.append(Polygon(ring))
            
        if not polys:
            continue
            
        polys = sorted(polys, key=lambda p: p.area, reverse=True)
        
        shells = []
        for poly in polys:
            if not poly.is_valid:
                poly = make_valid(poly)
            
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
                
        if not level_polygons:
            continue
            
        if len(level_polygons) == 1:
            final_geom = level_polygons[0]
        else:
            final_geom = MultiPolygon(level_polygons)
            
        if tolerance > 0:
            simplified = final_geom.simplify(tolerance, preserve_topology=True)
        else:
            simplified = final_geom
            
        if simplified.is_empty:
            continue
            
        features.append({
            "type": "Feature",
            "geometry": mapping(simplified),
            "properties": {
                "value_min": float(level_min),
                "value_max": float(level_max),
                "value": float((level_min + level_max) / 2.0)
            }
        })
        
    plt.close(fig)
    
    res = {
        "type": "FeatureCollection",
        "features": features,
        "value_min": float(p1),
        "value_max": float(p99)
    }
    contour_layer_cache[cache_key] = res
    return res


@app.get("/api/contours")
async def get_contours(
    response: Response,
    variable: str = Query(..., description="Variable: temp, salt, zeta"),
    time: int = Query(..., description="Time index (0-239)"),
    depth: int = Query(0, description="Depth index (0-6)"),
    tolerance: float = Query(0.001, description="Shapely simplification tolerance in degrees"),
    file_path: Optional[str] = Query(None, description="Path to specific NetCDF file")
):
    response.headers["Cache-Control"] = "public, max-age=86400"
    loaded_time = 0.0
    if file_path:
        dataset, meta = await get_cached_dataset(file_path)
        if file_path in dataset_cache:
            loaded_time = dataset_cache[file_path][2]
    else:
        dataset = ds
        meta = metadata_cache
        
    if dataset is None:
        raise HTTPException(status_code=503, detail="Dataset not loaded")

    if file_path and variable not in meta.get('ranges', {}):
        raise HTTPException(status_code=400, detail=f"Variable '{variable}' is not configured/available for this variable group.")
        
    if variable not in ['temp', 'salt', 'zeta']:
        raise HTTPException(status_code=400, detail="Invalid variable. Choose temp, salt, or zeta.")
        
    # Bounds check
    if time < 0 or time >= len(meta['times']):
        raise HTTPException(status_code=400, detail=f"Time index must be between 0 and {len(meta['times'])-1}")
        
    if variable != 'zeta':
        if depth < 0 or depth >= len(meta['depths']):
            raise HTTPException(status_code=400, detail=f"Depth index must be between 0 and {len(meta['depths'])-1}")

    return await asyncio.to_thread(
        compute_contours_sync, file_path, variable, time, depth, tolerance, loaded_time, dataset, meta
    )

@app.get("/api/currents")
async def get_currents(
    response: Response,
    time: int = Query(..., description="Time index (0-239)"),
    depth: int = Query(0, description="Depth index (0-6)"),
    downsample: int = Query(3, description="Skip interval for downsampling grid"),
    file_path: Optional[str] = Query(None, description="Path to specific NetCDF file")
):
    response.headers["Cache-Control"] = "public, max-age=86400"
    if file_path:
        dataset, meta = await get_cached_dataset(file_path)
    else:
        dataset = ds
        meta = metadata_cache
        
    if dataset is None:
        raise HTTPException(status_code=503, detail="Dataset not loaded")

    if file_path and ('u' not in meta.get('ranges', {}) or 'v' not in meta.get('ranges', {})):
        raise HTTPException(status_code=400, detail="Currents variable is not configured/available for this variable group.")
        
    # Bounds check
    if time < 0 or time >= len(meta['times']):
        raise HTTPException(status_code=400, detail=f"Time index must be between 0 and {len(meta['times'])-1}")
        
    if depth < 0 or depth >= len(meta['depths']):
        raise HTTPException(status_code=400, detail=f"Depth index must be between 0 and {len(meta['depths'])-1}")

    # Map frontend time index to raw time index using cached time_sampling
    time_sampling = meta.get("time_sampling", 1)
    actual_time = time * time_sampling

    # Extract u and v components
    u_slice = dataset['u'].isel(time=actual_time, depth=depth).values
    v_slice = dataset['v'].isel(time=actual_time, depth=depth).values
    lon = dataset['lon_rho'].values
    lat = dataset['lat_rho'].values
    
    # Downsample using slicing
    lon_ds = lon[::downsample, ::downsample]
    lat_ds = lat[::downsample, ::downsample]
    u_ds = u_slice[::downsample, ::downsample]
    v_ds = v_slice[::downsample, ::downsample]
    
    # Create grid coordinate indices i, j
    rows, cols = lon_ds.shape
    i_grid, j_grid = np.ogrid[:rows, :cols]
    i_mat = np.broadcast_to(i_grid, (rows, cols))
    j_mat = np.broadcast_to(j_grid, (rows, cols))

    # Vectorized valid mask (filter out NaNs/land points)
    valid = ~(np.isnan(lon_ds) | np.isnan(lat_ds) | np.isnan(u_ds) | np.isnan(v_ds))

    # Extract 1D arrays of valid points
    lons = lon_ds[valid]
    lats = lat_ds[valid]
    us = u_ds[valid]
    vs = v_ds[valid]
    is_arr = i_mat[valid]
    js_arr = j_mat[valid]

    # Combine into list of compact numeric tuples: [lng, lat, u, v, i, j]
    return [
        [float(lon_val), float(lat_val), float(u_val), float(v_val), int(i_val), int(j_val)]
        for lon_val, lat_val, u_val, v_val, i_val, j_val in zip(lons, lats, us, vs, is_arr, js_arr)
    ]


@app.get("/api/points")
async def get_points(
    downsample: int = Query(3, description="Skip interval for downsampling grid"),
    file_path: Optional[str] = Query(None, description="Path to specific NetCDF file")
):
    if file_path:
        dataset, meta = await get_cached_dataset(file_path)
    else:
        dataset = ds
        meta = metadata_cache
        
    if dataset is None:
        raise HTTPException(status_code=503, detail="Dataset not loaded")

    # Locate coordinates variables
    lon_var = None
    lat_var = None
    for name in ['lon_rho', 'nav_lon', 'lon']:
        if name in dataset:
            lon_var = name
            break
    for name in ['lat_rho', 'nav_lat', 'lat']:
        if name in dataset:
            lat_var = name
            break
            
    if not lon_var or not lat_var:
        raise HTTPException(status_code=400, detail="Could not find coordinate variables in NetCDF file.")
        
    lon = dataset[lon_var].values
    lat = dataset[lat_var].values
    
    # If coordinates are 1D, meshgrid them
    if len(lon.shape) == 1 and len(lat.shape) == 1:
        lon, lat = np.meshgrid(lon, lat)
        
    if len(lon.shape) != 2 or len(lat.shape) != 2:
        raise HTTPException(status_code=400, detail="Coordinate dimensions must be 2D.")

    m, n = lon.shape
    
    # Look up land mask if present
    mask = None
    for mask_name in ['mask', 'mask_rho']:
        if mask_name in dataset:
            mask = dataset[mask_name].values
            break

    points = []
    for r in range(0, m, downsample):
        for c in range(0, n, downsample):
            lon_val = float(lon[r, c])
            lat_val = float(lat[r, c])
            
            # Skip NaNs
            if np.isnan(lon_val) or np.isnan(lat_val):
                continue
                
            # Skip land
            if mask is not None and float(mask[r, c]) == 0.0:
                continue
                
            points.append({
                "lng": lon_val,
                "lat": lat_val,
                "i": r,
                "j": c
            })
            
    return points


@app.get("/api/timeseries")
async def get_timeseries(
    variable: str = Query(..., description="Variable: temp, salt, zeta"),
    depth: int = Query(0, description="Depth index (0-6)"),
    i: int = Query(..., description="Grid row index (r)"),
    j: int = Query(..., description="Grid column index (c)"),
    file_path: Optional[str] = Query(None, description="Path to specific NetCDF file")
):
    if file_path:
        dataset, meta = await get_cached_dataset(file_path)
    else:
        dataset = ds
        meta = metadata_cache
        
    if dataset is None:
        raise HTTPException(status_code=503, detail="Dataset not loaded")

    if variable not in ['temp', 'salt', 'zeta']:
        raise HTTPException(status_code=400, detail="Invalid variable. Choose temp, salt, or zeta.")

    # Locate variable in dataset
    if variable not in dataset:
        raise HTTPException(status_code=400, detail=f"Variable '{variable}' not found in dataset.")

    # Locate coordinates variables
    lon_var = None
    lat_var = None
    for name in ['lon_rho', 'nav_lon', 'lon']:
        if name in dataset:
            lon_var = name
            break
    for name in ['lat_rho', 'nav_lat', 'lat']:
        if name in dataset:
            lat_var = name
            break
            
    if not lon_var or not lat_var:
        raise HTTPException(status_code=400, detail="Could not find coordinate variables in NetCDF file.")
        
    lon = dataset[lon_var].values
    lat = dataset[lat_var].values
    
    # If coordinates are 1D, meshgrid them
    if len(lon.shape) == 1 and len(lat.shape) == 1:
        lon, lat = np.meshgrid(lon, lat)

    # Range checks for index i and j
    m, n = lon.shape
    if i < 0 or i >= m or j < 0 or j >= n:
        raise HTTPException(status_code=400, detail=f"Grid indices out of bounds. i must be 0-{m-1}, j must be 0-{n-1}")

    # Build the dictionary of index selections for xarray
    dims = dataset[variable].dims
    
    # Last two dimensions are spatial (usually eta_rho, xi_rho or Y, X)
    spatial_y_dim = dims[-2]
    spatial_x_dim = dims[-1]
    
    indexer = {spatial_y_dim: i, spatial_x_dim: j}
    
    # If 'depth' is a dimension, and variable is not zeta, include depth
    if 'depth' in dims and variable != 'zeta':
        if depth < 0 or depth >= len(meta['depths']):
            raise HTTPException(status_code=400, detail=f"Depth index must be between 0 and {len(meta['depths'])-1}")
        indexer['depth'] = depth
        
    try:
        ts_slice = dataset[variable].isel(**indexer)
        raw_vals = ts_slice.values
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query timeseries from dataset. Error: {str(e)}")

    # Time sampling slice
    time_sampling = meta.get("time_sampling", 1)
    vals = raw_vals[::time_sampling]
    times = meta.get("times", [])
    
    # Sanitize NaNs
    vals_clean = [float(v) if not np.isnan(v) else None for v in vals]
    
    # Unit mapping
    unit = '°C'
    if variable == 'salt':
        unit = 'g/kg'
    elif variable == 'zeta':
        unit = 'm'
        
    return {
        "times": times,
        "values": vals_clean,
        "variable": variable,
        "unit": unit,
        "lat": float(lat[i, j]),
        "lng": float(lon[i, j])
    }


# --- PRODUCTS & MEMBERS API ENDPOINTS ---

@app.post("/api/products", response_model=ProductResponse)
async def create_product(product: ProductCreate, current_user: dict = Depends(get_current_admin)):
    try:
        product_data = product.dict()
        product_data["region"] = None  # Placeholder, to be derived later
        result = await products_collection.insert_one(product_data)
        created = await products_collection.find_one({"_id": result.inserted_id})
        return serialize_doc(created)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.get("/api/products", response_model=list[ProductResponse])
async def list_products():
    try:
        cursor = products_collection.find()
        products = []
        async for doc in cursor:
            products.append(serialize_doc(doc))
        return products
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.get("/api/products/{product_id}", response_model=ProductResponse)
async def get_product(product_id: str):
    try:
        obj_id = ObjectId(product_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid product ID format")
    
    product = await products_collection.find_one({"_id": obj_id})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return serialize_doc(product)

@app.post("/api/products/{product_id}/members", response_model=MemberResponse)
async def create_member(product_id: str, member: MemberCreate, current_user: dict = Depends(get_current_admin)):
    try:
        prod_obj_id = ObjectId(product_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid product ID format")
        
    # Check if parent product exists
    product = await products_collection.find_one({"_id": prod_obj_id})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
        
    processed_groups = []
    
    for group in member.variable_groups:
        # Check if file exists
        resolved_path = group.file_path
        if not os.path.exists(resolved_path):
            if resolved_path.startswith("/data/"):
                fallback = os.path.join(os.getcwd(), os.path.basename(resolved_path))
                if os.path.exists(fallback):
                    resolved_path = fallback

        if not os.path.exists(resolved_path):
            raise HTTPException(
                status_code=400,
                detail=f"NetCDF file not found at path: {group.file_path}"
            )
            
        group_depths = []
        group_time_steps = []
        
        # Parse using xarray to extract dimensions
        try:
            with xr.open_dataset(resolved_path) as test_ds:
                # Extract depth dimension if it exists
                if 'depth' in test_ds:
                    group_depths = [float(d) for d in test_ds['depth'].values]
                    
                # Extract time dimension if it exists
                if 'time' in test_ds:
                    raw_times = [str(t) for t in test_ds['time'].values]
                    step = group.time_sampling if group.time_sampling and group.time_sampling > 0 else 1
                    group_time_steps = raw_times[::step]
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to open/parse NetCDF file at {group.file_path}. Error: {str(e)}"
            )
            
        # Sort depths in descending order (surface first)
        group_depths.sort(reverse=True)
        
        processed_groups.append({
            "name": group.name.strip(),
            "variables": group.variables,
            "file_path": group.file_path,
            "depths": group_depths,
            "time_steps": group_time_steps,
            "time_sampling": group.time_sampling or 1
        })
            
    try:
        member_data = {
            "name": member.name,
            "product_id": prod_obj_id,
            "variable_groups": processed_groups
        }
        
        result = await members_collection.insert_one(member_data)
        # Clear files from cache just in case
        for group in processed_groups:
            fp = group["file_path"]
            if fp in dataset_cache:
                try:
                    dataset_cache[fp][0].close()
                except Exception:
                    pass
                del dataset_cache[fp]

        created = await members_collection.find_one({"_id": result.inserted_id})
        return serialize_doc(created)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.get("/api/products/{product_id}/members", response_model=list[MemberResponse])
async def list_members(product_id: str):
    try:
        prod_obj_id = ObjectId(product_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid product ID format")
        
    product = await products_collection.find_one({"_id": prod_obj_id})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
        
    try:
        cursor = members_collection.find({"product_id": prod_obj_id})
        members = []
        async for doc in cursor:
            members.append(serialize_doc(doc))
        return members
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.get("/api/members/{member_id}", response_model=MemberResponse)
async def get_member(member_id: str):
    try:
        obj_id = ObjectId(member_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid member ID format")
        
    member = await members_collection.find_one({"_id": obj_id})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    return serialize_doc(member)


@app.post("/api/products/{product_id}/derive_region", response_model=ProductResponse)
async def derive_product_region(product_id: str, current_user: dict = Depends(get_current_admin)):
    try:
        prod_obj_id = ObjectId(product_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid product ID format")
        
    product = await products_collection.find_one({"_id": prod_obj_id})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
        
    # Get members
    cursor = members_collection.find({"product_id": prod_obj_id})
    members = []
    async for doc in cursor:
        members.append(doc)
        
    if not members:
        raise HTTPException(status_code=400, detail="Product has no members. Add at least one member first.")
        
    # Take the first member
    first_member = members[0]
    if not first_member.get("variable_groups"):
        raise HTTPException(status_code=400, detail="First member has no variable groups / file paths defined.")
        
    # Get the file path of the first variable group
    file_path = first_member["variable_groups"][0]["file_path"]
    if not os.path.exists(file_path):
        raise HTTPException(status_code=400, detail=f"Member NetCDF file not found at path: {file_path}")
        
    try:
        with xr.open_dataset(file_path) as test_ds:
            # Resolve coordinate variable names
            lon_var = None
            lat_var = None
            for name in ['lon_rho', 'nav_lon', 'lon']:
                if name in test_ds:
                    lon_var = name
                    break
            for name in ['lat_rho', 'nav_lat', 'lat']:
                if name in test_ds:
                    lat_var = name
                    break
                    
            if not lon_var or not lat_var:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Could not find coordinate variables (e.g. lon_rho/lat_rho) in NetCDF file: {file_path}"
                )
                
            lon = test_ds[lon_var].values
            lat = test_ds[lat_var].values
            
            # If coordinates are 1D, construct 2D meshgrid
            if len(lon.shape) == 1 and len(lat.shape) == 1:
                lon, lat = np.meshgrid(lon, lat)
                
            if len(lon.shape) != 2 or len(lat.shape) != 2:
                raise HTTPException(
                    status_code=400,
                    detail=f"Coordinate matrices must be 2D. Found shapes: lon={lon.shape}, lat={lat.shape}"
                )
                
            m, n = lon.shape
            boundary_coords = []
            
            # Trace perimeter coordinates:
            # 1. Bottom edge: left to right
            for j in range(n):
                boundary_coords.append((float(lon[0, j]), float(lat[0, j])))
            # 2. Right edge: bottom to top
            for i in range(1, m):
                boundary_coords.append((float(lon[i, n-1]), float(lat[i, n-1])))
            # 3. Top edge: right to left
            for j in range(n-2, -1, -1):
                boundary_coords.append((float(lon[m-1, j]), float(lat[m-1, j])))
            # 4. Left edge: top to bottom
            for i in range(m-2, 0, -1):
                boundary_coords.append((float(lon[i, 0]), float(lat[i, 0])))
            # Close the polygon loop
            boundary_coords.append(boundary_coords[0])
            
            # Remove any NaNs if present
            boundary_coords = [(x, y) for x, y in boundary_coords if not (np.isnan(x) or np.isnan(y))]
            if len(boundary_coords) < 4:
                raise HTTPException(status_code=400, detail="Grid perimeter coordinates contain too many NaNs to form a polygon.")
                
            poly = Polygon(boundary_coords)
            if not poly.is_valid:
                poly = make_valid(poly)
                
            # Simplify polygon to make it compact
            simplified = poly.simplify(0.005, preserve_topology=True)
            geojson_mapping = mapping(simplified)
            
            # Update product in MongoDB
            await products_collection.update_one(
                {"_id": prod_obj_id}, 
                {"$set": {"region": geojson_mapping}}
            )
            
            updated_product = await products_collection.find_one({"_id": prod_obj_id})
            return serialize_doc(updated_product)
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to derive bounding shape from NetCDF file. Error: {str(e)}"
        )


@app.put("/api/products/{product_id}", response_model=ProductResponse)
async def update_product(product_id: str, product_update: ProductUpdate, current_user: dict = Depends(get_current_admin)):
    try:
        prod_obj_id = ObjectId(product_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid product ID format")
        
    product = await products_collection.find_one({"_id": prod_obj_id})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
        
    try:
        await products_collection.update_one(
            {"_id": prod_obj_id},
            {"$set": {"name": product_update.name.strip()}}
        )
        updated = await products_collection.find_one({"_id": prod_obj_id})
        return serialize_doc(updated)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@app.delete("/api/products/{product_id}")
async def delete_product(product_id: str, current_user: dict = Depends(get_current_admin)):
    try:
        prod_obj_id = ObjectId(product_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid product ID format")
        
    product = await products_collection.find_one({"_id": prod_obj_id})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
        
    try:
        # Cascade delete members
        await members_collection.delete_many({"product_id": prod_obj_id})
        # Delete product
        await products_collection.delete_one({"_id": prod_obj_id})
        return {"message": "Product and associated members deleted successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@app.delete("/api/members/{member_id}")
async def delete_member(member_id: str, current_user: dict = Depends(get_current_admin)):
    try:
        obj_id = ObjectId(member_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid member ID format")
        
    member = await members_collection.find_one({"_id": obj_id})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
        
    try:
        await members_collection.delete_one({"_id": obj_id})
        return {"message": "Member deleted successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@app.put("/api/members/{member_id}", response_model=MemberResponse)
async def update_member(member_id: str, member_update: MemberUpdate, current_user: dict = Depends(get_current_admin)):
    try:
        obj_id = ObjectId(member_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid member ID format")
        
    existing_member = await members_collection.find_one({"_id": obj_id})
    if not existing_member:
        raise HTTPException(status_code=404, detail="Member not found")
        
    processed_groups = []
    for group in member_update.variable_groups:
        # Check if file exists
        resolved_path = group.file_path
        if not os.path.exists(resolved_path):
            if resolved_path.startswith("/data/"):
                fallback = os.path.join(os.getcwd(), os.path.basename(resolved_path))
                if os.path.exists(fallback):
                    resolved_path = fallback

        if not os.path.exists(resolved_path):
            raise HTTPException(
                status_code=400,
                detail=f"NetCDF file not found at path: {group.file_path}"
            )
            
        group_depths = []
        group_time_steps = []
        
        # Parse using xarray to extract dimensions
        try:
            with xr.open_dataset(resolved_path) as test_ds:
                # Extract depth dimension if it exists
                if 'depth' in test_ds:
                    group_depths = [float(d) for d in test_ds['depth'].values]
                    
                # Extract time dimension if it exists
                if 'time' in test_ds:
                    raw_times = [str(t) for t in test_ds['time'].values]
                    step = group.time_sampling if group.time_sampling and group.time_sampling > 0 else 1
                    group_time_steps = raw_times[::step]
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to open/parse NetCDF file at {group.file_path}. Error: {str(e)}"
            )
            
        # Sort depths in descending order (surface first)
        group_depths.sort(reverse=True)
        
        processed_groups.append({
            "name": group.name.strip(),
            "variables": group.variables,
            "file_path": group.file_path,
            "depths": group_depths,
            "time_steps": group_time_steps,
            "time_sampling": group.time_sampling or 1
        })
        
    try:
        await members_collection.update_one(
            {"_id": obj_id},
            {"$set": {
                "name": member_update.name.strip(),
                "variable_groups": processed_groups
            }}
        )
        # Clear files from cache so metadata changes take effect immediately
        for group in processed_groups:
            fp = group["file_path"]
            if fp in dataset_cache:
                try:
                    dataset_cache[fp][0].close()
                except Exception:
                    pass
                del dataset_cache[fp]

        updated = await members_collection.find_one({"_id": obj_id})
        return serialize_doc(updated)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
