import os
import time
from typing import Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import xarray as xr
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from shapely.geometry import Polygon, MultiPolygon, mapping
from shapely.validation import make_valid
from bson import ObjectId

# Database imports
from backend.database import products_collection, members_collection
from backend.schemas import (
    ProductCreate,
    ProductResponse,
    ProductUpdate,
    MemberCreate,
    MemberResponse,
    MemberUpdate,
    serialize_doc
)

# Paths
NETCDF_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "croco_avg_t2.nc")

# Globals for caching (for static single-file visualization fallback)
ds = None
metadata_cache = {}
dataset_cache = {}

async def get_cached_dataset(file_path: str):
    now = time.time()
    if file_path in dataset_cache:
        dataset, meta, loaded_time = dataset_cache[file_path]
        if now - loaded_time <= 6 * 3600:  # 6 hours in seconds
            return dataset, meta
        else:
            try:
                dataset.close()
            except Exception:
                pass
            del dataset_cache[file_path]

    if not os.path.exists(file_path):
        raise HTTPException(status_code=400, detail=f"NetCDF file not found at path: {file_path}")
    try:
        dataset = xr.open_dataset(file_path)
        times = [str(t) for t in dataset['time'].values]
        depths = [float(d) for d in dataset['depth'].values] if 'depth' in dataset else []
        
        # Spatial bounds
        lon_min = float(dataset['lon_rho'].min().values)
        lon_max = float(dataset['lon_rho'].max().values)
        lat_min = float(dataset['lat_rho'].min().values)
        lat_max = float(dataset['lat_rho'].max().values)
        
        # Look up allowed variables for this file path from the database
        allowed_vars = None
        try:
            member = await members_collection.find_one({"variable_groups.file_path": file_path})
            if member:
                for vg in member.get("variable_groups", []):
                    if vg.get("file_path") == file_path:
                        allowed_vars = vg.get("variables", [])
                        break
        except Exception as e:
            print(f"Error querying database for file_path {file_path}: {e}")

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
            "ranges": var_ranges
        }
        dataset_cache[file_path] = (dataset, meta, now)
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

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8001",
        "http://127.0.0.1:8001"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/metadata")
async def get_metadata(file_path: Optional[str] = None):
    if file_path:
        _, meta = await get_cached_dataset(file_path)
        return meta
    if not metadata_cache:
        raise HTTPException(status_code=503, detail="Service initializing")
    return metadata_cache

@app.get("/api/contours")
async def get_contours(
    variable: str = Query(..., description="Variable: temp, salt, zeta"),
    time: int = Query(..., description="Time index (0-239)"),
    depth: int = Query(0, description="Depth index (0-6)"),
    tolerance: float = Query(0.001, description="Shapely simplification tolerance in degrees"),
    file_path: Optional[str] = Query(None, description="Path to specific NetCDF file")
):
    if file_path:
        dataset, meta = await get_cached_dataset(file_path)
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

    # Extract slice
    if variable == 'zeta':
        slice_data = dataset['zeta'].isel(time=time)
    else:
        slice_data = dataset[variable].isel(time=time, depth=depth)
        
    z = slice_data.values
    lon = dataset['lon_rho'].values
    lat = dataset['lat_rho'].values
    
    # Check if all values are NaN (e.g. invalid slice)
    if np.isnan(z).all():
        return {"type": "FeatureCollection", "features": []}
        
    z_min = float(np.nanmin(z))
    z_max = float(np.nanmax(z))
    
    if z_min == z_max:
        return {"type": "FeatureCollection", "features": []}
        
    # Generate 12 levels (giving 11 filled bands)
    levels = np.linspace(z_min, z_max, 20)
    
    fig, ax = plt.subplots()
    cs = ax.contourf(lon, lat, z, levels=levels)
    
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
            
        # Sort by area descending so outer shells come first
        polys = sorted(polys, key=lambda p: p.area, reverse=True)
        
        # Group nested polygons (holes) inside outer shells
        shells = []
        for poly in polys:
            if not poly.is_valid:
                poly = make_valid(poly)
            
            # Check if this poly is inside any already identified shell
            inserted = False
            for shell_info in shells:
                if shell_info['poly'].contains(poly):
                    shell_info['holes'].append(poly)
                    inserted = True
                    break
            if not inserted:
                shells.append({'poly': poly, 'holes': []})
                
        # Construct final geometries by subtracting holes from shells
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
            
        # Simplify to reduce size
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
    
    return {
        "type": "FeatureCollection",
        "features": features
    }

@app.get("/api/currents")
async def get_currents(
    time: int = Query(..., description="Time index (0-239)"),
    depth: int = Query(0, description="Depth index (0-6)"),
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

    if file_path and ('u' not in meta.get('ranges', {}) or 'v' not in meta.get('ranges', {})):
        raise HTTPException(status_code=400, detail="Currents variable is not configured/available for this variable group.")
        
    # Bounds check
    if time < 0 or time >= len(meta['times']):
        raise HTTPException(status_code=400, detail=f"Time index must be between 0 and {len(meta['times'])-1}")
        
    if depth < 0 or depth >= len(meta['depths']):
        raise HTTPException(status_code=400, detail=f"Depth index must be between 0 and {len(meta['depths'])-1}")

    # Extract u and v components
    u_slice = dataset['u'].isel(time=time, depth=depth).values
    v_slice = dataset['v'].isel(time=time, depth=depth).values
    lon = dataset['lon_rho'].values
    lat = dataset['lat_rho'].values
    
    # Downsample using slicing
    lon_ds = lon[::downsample, ::downsample]
    lat_ds = lat[::downsample, ::downsample]
    u_ds = u_slice[::downsample, ::downsample]
    v_ds = v_slice[::downsample, ::downsample]
    
    points = []
    for i in range(lon_ds.shape[0]):
        for j in range(lon_ds.shape[1]):
            lon_val = float(lon_ds[i, j])
            lat_val = float(lat_ds[i, j])
            u_val = float(u_ds[i, j])
            v_val = float(v_ds[i, j])
            
            # Skip points that are NaNs (land points)
            if np.isnan(lon_val) or np.isnan(lat_val) or np.isnan(u_val) or np.isnan(v_val):
                continue
                
            points.append({
                "lng": lon_val,
                "lat": lat_val,
                "u": u_val,
                "v": v_val
            })
            
    return points


# --- PRODUCTS & MEMBERS API ENDPOINTS ---

@app.post("/api/products", response_model=ProductResponse)
async def create_product(product: ProductCreate):
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
async def create_member(product_id: str, member: MemberCreate):
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
        if not os.path.exists(group.file_path):
            raise HTTPException(
                status_code=400,
                detail=f"NetCDF file not found at path: {group.file_path}"
            )
            
        group_depths = []
        group_time_steps = []
        
        # Parse using xarray to extract dimensions
        try:
            with xr.open_dataset(group.file_path) as test_ds:
                # Extract depth dimension if it exists
                if 'depth' in test_ds:
                    group_depths = [float(d) for d in test_ds['depth'].values]
                    
                # Extract time dimension if it exists
                if 'time' in test_ds:
                    group_time_steps = [str(t) for t in test_ds['time'].values]
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
            "time_steps": group_time_steps
        })
            
    try:
        member_data = {
            "name": member.name,
            "product_id": prod_obj_id,
            "variable_groups": processed_groups
        }
        
        result = await members_collection.insert_one(member_data)
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
async def derive_product_region(product_id: str):
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
async def update_product(product_id: str, product_update: ProductUpdate):
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
async def delete_product(product_id: str):
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
async def delete_member(member_id: str):
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
async def update_member(member_id: str, member_update: MemberUpdate):
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
        if not os.path.exists(group.file_path):
            raise HTTPException(
                status_code=400,
                detail=f"NetCDF file not found at path: {group.file_path}"
            )
            
        group_depths = []
        group_time_steps = []
        
        # Parse using xarray to extract dimensions
        try:
            with xr.open_dataset(group.file_path) as test_ds:
                # Extract depth dimension if it exists
                if 'depth' in test_ds:
                    group_depths = [float(d) for d in test_ds['depth'].values]
                    
                # Extract time dimension if it exists
                if 'time' in test_ds:
                    group_time_steps = [str(t) for t in test_ds['time'].values]
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
            "time_steps": group_time_steps
        })
        
    try:
        await members_collection.update_one(
            {"_id": obj_id},
            {"$set": {
                "name": member_update.name.strip(),
                "variable_groups": processed_groups
            }}
        )
        updated = await members_collection.find_one({"_id": obj_id})
        return serialize_doc(updated)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
