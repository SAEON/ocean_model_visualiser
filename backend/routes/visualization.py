import os
import json
import asyncio
import hashlib
from typing import Optional
import numpy as np
from fastapi import APIRouter, Query, HTTPException, Response, Request
from fastapi.responses import StreamingResponse

import backend.services.dataset_service as ds_service
from backend.services.dataset_service import (
    get_cached_dataset,
    get_contours_async,
    get_currents_async,
    get_variable_definition,
    resolve_coordinates,
    resolve_depth_dimension,
    resolve_mask,
    contour_layer_cache,
    currents_layer_cache,
    dataset_cache
)

def compute_etag(canonical_path: str, *params) -> str:
    mtime = os.path.getmtime(canonical_path) if (canonical_path and os.path.exists(canonical_path)) else 0
    param_str = "_".join(str(p) for p in params)
    raw = f"{canonical_path}_{mtime}_{param_str}"
    return f'"{hashlib.md5(raw.encode("utf-8")).hexdigest()[:16]}"'

router = APIRouter(prefix="/api", tags=["visualization"])

@router.post("/clear_cache")
@router.get("/clear_cache")
async def clear_cache():
    contour_layer_cache.clear()
    currents_layer_cache.clear()
    dataset_cache.clear()
    return {"status": "success", "message": "Backend dataset and contour/currents caches cleared"}

@router.post("/warm_cache")
@router.get("/warm_cache")
async def warm_cache(file_path: Optional[str] = Query(None)):
    from backend.cache_warmer import warm_dataset, warm_all_datasets
    if file_path:
        if not os.path.exists(file_path):
            raise HTTPException(status_code=400, detail=f"NetCDF file not found: {file_path}")
        asyncio.create_task(asyncio.to_thread(warm_dataset, file_path))
        return {"status": "started", "message": f"Cache warming started in background for {os.path.basename(file_path)}"}
    else:
        asyncio.create_task(asyncio.to_thread(warm_all_datasets))
        return {"status": "started", "message": "Cache warming started in background for all datasets"}

@router.get("/warm_cache/status")
async def get_cache_warmer_status():
    from backend.cache_warmer import get_warming_status
    return get_warming_status()

@router.get("/metadata")
async def get_metadata(file_path: Optional[str] = None):
    if file_path:
        _, meta = await get_cached_dataset(file_path)
        return meta
    if not ds_service.metadata_cache:
        raise HTTPException(status_code=503, detail="Service initializing")
    return ds_service.metadata_cache

@router.get("/contours")
async def get_contours(
    request: Request,
    response: Response,
    variable: str = Query(..., description="Variable: temp, salt, zeta"),
    time: int = Query(..., description="Time index (0-239)"),
    depth: int = Query(0, description="Depth index (0-6)"),
    tolerance: float = Query(0.001, description="Shapely simplification tolerance in degrees"),
    file_path: Optional[str] = Query(None, description="Path to specific NetCDF file")
):
    response.headers["Cache-Control"] = "public, max-age=86400"
    if file_path:
        _, meta = await get_cached_dataset(file_path)
    else:
        meta = ds_service.metadata_cache
        
    if meta is None:
        raise HTTPException(status_code=503, detail="Dataset not loaded")

    canonical_path = meta.get("canonical_path") or ds_service.get_canonical_file_path(file_path)
    etag = compute_etag(canonical_path, variable, time, depth, tolerance)
    response.headers["ETag"] = etag
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "public, max-age=86400"})

    v_def = get_variable_definition(meta, variable)
    target_var = v_def.get("nc_var") if v_def else variable
    is_surface = bool(v_def.get("is_surface_only", False)) if v_def else False
    if not is_surface and (variable == 'zeta' or target_var == 'zeta'):
        is_surface = True

    depth_to_use = 0 if is_surface else depth

    ranges = meta.get('ranges', {})
    if ranges and (target_var not in ranges and variable not in ranges):
        raise HTTPException(status_code=400, detail=f"Variable '{variable}' is not configured/available for this dataset.")
        
    if time < 0 or time >= len(meta['times']):
        raise HTTPException(status_code=400, detail=f"Time index must be between 0 and {len(meta['times'])-1}")

    if not is_surface:
        if depth < 0 or depth >= len(meta.get('depths', [])):
            raise HTTPException(status_code=400, detail=f"Depth index must be between 0 and {len(meta.get('depths', []))-1}")

    return await get_contours_async(file_path, target_var, time, depth_to_use, tolerance, meta)

@router.get("/currents")
async def get_currents(
    request: Request,
    response: Response,
    time: int = Query(..., description="Time index (0-239)"),
    depth: int = Query(0, description="Depth index (0-6)"),
    downsample: int = Query(2, description="Skip interval for downsampling grid"),
    file_path: Optional[str] = Query(None, description="Path to specific NetCDF file")
):
    response.headers["Cache-Control"] = "public, max-age=86400"
    if file_path:
        _, meta = await get_cached_dataset(file_path)
    else:
        meta = ds_service.metadata_cache
        
    if meta is None:
        raise HTTPException(status_code=503, detail="Dataset not loaded")

    canonical_path = meta.get("canonical_path") or ds_service.get_canonical_file_path(file_path)
    etag = compute_etag(canonical_path, "curr", time, depth, downsample)
    response.headers["ETag"] = etag
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "public, max-age=86400"})

    if file_path and ('u' not in meta.get('ranges', {}) or 'v' not in meta.get('ranges', {})):
        raise HTTPException(status_code=400, detail="Currents variable is not configured/available for this variable group.")
        
    if time < 0 or time >= len(meta['times']):
        raise HTTPException(status_code=400, detail=f"Time index must be between 0 and {len(meta['times'])-1}")
        
    if depth < 0 or depth >= len(meta['depths']):
        raise HTTPException(status_code=400, detail=f"Depth index must be between 0 and {len(meta['depths'])-1}")

    return await get_currents_async(file_path, time, depth, downsample, meta)

@router.get("/frame")
async def get_frame(
    request: Request,
    response: Response,
    variable: str = Query("temp", description="Variable: temp, salt, zeta"),
    time: int = Query(..., description="Time index (0-239)"),
    depth: int = Query(0, description="Depth index (0-6)"),
    tolerance: float = Query(0.001, description="Shapely simplification tolerance in degrees"),
    file_path: Optional[str] = Query(None, description="Path to specific NetCDF file"),
    include_contours: bool = Query(True),
    include_currents: bool = Query(True)
):
    response.headers["Cache-Control"] = "public, max-age=86400"
    if file_path:
        _, meta = await get_cached_dataset(file_path)
    else:
        meta = ds_service.metadata_cache
        
    if meta is None:
        raise HTTPException(status_code=503, detail="Dataset not loaded")

    canonical_path = meta.get("canonical_path") or ds_service.get_canonical_file_path(file_path)
    etag = compute_etag(canonical_path, "frame", variable, time, depth, tolerance, include_contours, include_currents)
    response.headers["ETag"] = etag
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "public, max-age=86400"})

    if time < 0 or time >= len(meta['times']):
        raise HTTPException(status_code=400, detail=f"Time index must be between 0 and {len(meta['times'])-1}")
        
    v_def = get_variable_definition(meta, variable)
    target_var = v_def.get("nc_var") if v_def else variable
    is_surface = bool(v_def.get("is_surface_only", False)) if v_def else False
    if not is_surface and (variable == 'zeta' or target_var == 'zeta'):
        is_surface = True

    depth_to_use = 0 if is_surface else depth

    if not is_surface and (depth < 0 or depth >= len(meta.get('depths', []))):
        raise HTTPException(status_code=400, detail=f"Depth index must be between 0 and {len(meta.get('depths', []))-1}")

    result = {}

    has_contours = target_var in meta.get('ranges', {}) or variable in meta.get('ranges', {})
    
    # Resolve dynamic vector pair variables if configured
    vector_var_def = None
    for vd in meta.get("variables", []):
        if isinstance(vd, dict) and vd.get("type") == "vector_pair":
            vector_var_def = vd
            break

    u_var = vector_var_def.get("nc_u_var", "u") if vector_var_def else "u"
    v_var = vector_var_def.get("nc_v_var", "v") if vector_var_def else "v"
    has_currents = (u_var in meta.get('ranges', {}) or 'u' in meta.get('ranges', {})) and (v_var in meta.get('ranges', {}) or 'v' in meta.get('ranges', {}))

    if include_contours and has_contours:
        contours = await get_contours_async(file_path, target_var, time, depth_to_use, tolerance, meta)
        result["contours"] = contours
    else:
        result["contours"] = None

    if include_currents and has_currents:
        currents = await get_currents_async(file_path, time, depth_to_use, 2, meta, u_var=u_var, v_var=v_var)
        result["currents"] = currents
    else:
        result["currents"] = None

    return result

@router.get("/stream_frames")
async def stream_frames(
    variable: str = Query("temp", description="Variable name"),
    time_start: Optional[int] = Query(None, description="Start time index"),
    start_time: Optional[int] = Query(None, description="Start time index alias"),
    count: Optional[int] = Query(None, description="Number of frames to stream"),
    depth: int = Query(0, description="Depth index"),
    tolerance: float = Query(0.001, description="Shapely simplification tolerance in degrees"),
    file_path: Optional[str] = Query(None, description="Path to specific NetCDF file"),
    include_contours: bool = Query(True),
    include_currents: bool = Query(True)
):
    headers = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    if file_path:
        _, meta = await get_cached_dataset(file_path)
    else:
        meta = ds_service.metadata_cache
        
    if meta is None:
        raise HTTPException(status_code=503, detail="Dataset not loaded")

    v_def = get_variable_definition(meta, variable)
    target_var = v_def.get("nc_var") if v_def else variable
    is_surface = bool(v_def.get("is_surface_only", False)) if v_def else False
    if not is_surface and (variable == 'zeta' or target_var == 'zeta'):
        is_surface = True

    depth_to_use = 0 if is_surface else depth

    total_times = len(meta.get('times', []))
    if total_times == 0:
        raise HTTPException(status_code=400, detail="No time steps in dataset")

    actual_start = start_time if start_time is not None else (time_start if time_start is not None else 0)
    num_frames = count if (count and count > 0) else total_times
    time_indices = [(actual_start + i) % total_times for i in range(num_frames)]

    has_contours = target_var in meta.get('ranges', {}) or variable in meta.get('ranges', {})
    
    vector_var_def = None
    for vd in meta.get("variables", []):
        if isinstance(vd, dict) and vd.get("type") == "vector_pair":
            vector_var_def = vd
            break

    u_var = vector_var_def.get("nc_u_var", "u") if vector_var_def else "u"
    v_var = vector_var_def.get("nc_v_var", "v") if vector_var_def else "v"
    has_currents = (u_var in meta.get('ranges', {}) or 'u' in meta.get('ranges', {})) and (v_var in meta.get('ranges', {}) or 'v' in meta.get('ranges', {}))

    async def generate_stream():
        for t_idx in time_indices:
            frame_data = {"time": t_idx}

            if include_contours and has_contours:
                contours = await get_contours_async(file_path, target_var, t_idx, depth_to_use, tolerance, meta)
                frame_data["contours"] = contours
            else:
                frame_data["contours"] = None

            if include_currents and has_currents:
                currents = await get_currents_async(file_path, t_idx, depth_to_use, 2, meta, u_var=u_var, v_var=v_var)
                frame_data["currents"] = currents
            else:
                frame_data["currents"] = None

            yield json.dumps(frame_data) + "\n"
            await asyncio.sleep(0.001)

    return StreamingResponse(generate_stream(), headers=headers, media_type="application/x-ndjson")

@router.get("/points")
async def get_points(
    downsample: int = Query(3, description="Skip interval for downsampling grid"),
    file_path: Optional[str] = Query(None, description="Path to specific NetCDF file")
):
    if file_path:
        dataset, meta = await get_cached_dataset(file_path)
    else:
        dataset = ds_service.ds
        meta = ds_service.metadata_cache
        
    if dataset is None:
        raise HTTPException(status_code=503, detail="Dataset not loaded")

    lon_var, lat_var = resolve_coordinates(dataset)
    if not lon_var or not lat_var:
        raise HTTPException(status_code=400, detail="Could not find coordinate variables in NetCDF file.")
        
    lon = dataset[lon_var].values
    lat = dataset[lat_var].values
    
    if len(lon.shape) == 1 and len(lat.shape) == 1:
        lon, lat = np.meshgrid(lon, lat)
        
    if len(lon.shape) != 2 or len(lat.shape) != 2:
        raise HTTPException(status_code=400, detail="Coordinate dimensions must be 2D.")

    m, n = lon.shape
    
    mask = None
    mask_name = resolve_mask(dataset)
    if mask_name and mask_name in dataset:
        mask = dataset[mask_name].values

    points = []
    for r in range(0, m, downsample):
        for c in range(0, n, downsample):
            lon_val = float(lon[r, c])
            lat_val = float(lat[r, c])
            
            if np.isnan(lon_val) or np.isnan(lat_val):
                continue
                
            if mask is not None and float(mask[r, c]) == 0.0:
                continue
                
            points.append({
                "lng": lon_val,
                "lat": lat_val,
                "i": r,
                "j": c
            })
            
    return points

@router.get("/timeseries")
async def get_timeseries(
    variable: str = Query(..., description="Variable name or id"),
    depth: int = Query(0, description="Depth index (0-6)"),
    i: int = Query(..., description="Grid row index (r)"),
    j: int = Query(..., description="Grid column index (c)"),
    file_path: Optional[str] = Query(None, description="Path to specific NetCDF file")
):
    if file_path:
        dataset, meta = await get_cached_dataset(file_path)
    else:
        dataset = ds_service.ds
        meta = ds_service.metadata_cache
        
    if dataset is None:
        raise HTTPException(status_code=503, detail="Dataset not loaded")

    v_def = get_variable_definition(meta, variable)
    target_var = v_def.get("nc_var") if v_def else variable
    unit = v_def.get("unit", "") if v_def else ""
    is_surface = bool(v_def.get("is_surface_only", False)) if v_def else False
    if not is_surface and (variable == 'zeta' or target_var == 'zeta'):
        is_surface = True

    if target_var not in dataset:
        for dv in dataset.data_vars:
            if str(dv).lower() == target_var.lower():
                target_var = str(dv)
                break

    if target_var not in dataset:
        raise HTTPException(status_code=400, detail=f"Variable '{variable}' not found in dataset.")

    lon_var, lat_var = resolve_coordinates(dataset)
    if not lon_var or not lat_var:
        raise HTTPException(status_code=400, detail="Could not find coordinate variables in NetCDF file.")
        
    lon = dataset[lon_var].values
    lat = dataset[lat_var].values
    
    if len(lon.shape) == 1 and len(lat.shape) == 1:
        lon, lat = np.meshgrid(lon, lat)

    m, n = lon.shape
    if i < 0 or i >= m or j < 0 or j >= n:
        raise HTTPException(status_code=400, detail=f"Grid indices out of bounds. i must be 0-{m-1}, j must be 0-{n-1}")

    dims = [str(d) for d in dataset[target_var].dims]
    spatial_y_dim = dims[-2]
    spatial_x_dim = dims[-1]
    
    indexer = {spatial_y_dim: i, spatial_x_dim: j}
    
    depth_dim = resolve_depth_dimension(dataset)
    if depth_dim and depth_dim in dims and not is_surface:
        max_d = dataset.sizes.get(depth_dim, 0)
        if depth < 0 or (max_d > 0 and depth >= max_d):
            raise HTTPException(status_code=400, detail=f"Depth index must be between 0 and {max_d-1}")
        indexer[depth_dim] = depth
        
    try:
        ts_slice = dataset[target_var].isel(**indexer)
        raw_vals = ts_slice.values
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query timeseries from dataset. Error: {str(e)}")

    time_sampling = meta.get("time_sampling", 1) if meta else 1
    vals = raw_vals[::time_sampling]
    times = meta.get("times", []) if meta else []
    
    vals_clean = [float(v) if not np.isnan(v) else None for v in vals]
    
    if not unit:
        unit = str(dataset[target_var].attrs.get('units', ''))
        if not unit:
            if variable == 'temp':
                unit = '°C'
            elif variable == 'salt':
                unit = 'psu'
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
