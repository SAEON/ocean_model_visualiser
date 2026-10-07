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

    if file_path and variable not in meta.get('ranges', {}):
        raise HTTPException(status_code=400, detail=f"Variable '{variable}' is not configured/available for this variable group.")
        
    if variable not in ['temp', 'salt', 'zeta']:
        raise HTTPException(status_code=400, detail="Invalid variable. Choose temp, salt, or zeta.")
        
    if time < 0 or time >= len(meta['times']):
        raise HTTPException(status_code=400, detail=f"Time index must be between 0 and {len(meta['times'])-1}")
        
    if variable != 'zeta':
        if depth < 0 or depth >= len(meta['depths']):
            raise HTTPException(status_code=400, detail=f"Depth index must be between 0 and {len(meta['depths'])-1}")

    return await get_contours_async(file_path, variable, time, depth, tolerance, meta)

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
        
    if variable != 'zeta' and (depth < 0 or depth >= len(meta['depths'])):
        raise HTTPException(status_code=400, detail=f"Depth index must be between 0 and {len(meta['depths'])-1}")

    result = {}

    has_contours = variable in meta.get('ranges', {})
    has_currents = 'u' in meta.get('ranges', {}) and 'v' in meta.get('ranges', {})

    if include_contours and has_contours:
        contours = await get_contours_async(file_path, variable, time, depth, tolerance, meta)
        result["contours"] = contours
    else:
        result["contours"] = None

    if include_currents and has_currents:
        currents = await get_currents_async(file_path, time, depth, 2, meta)
        result["currents"] = currents
    else:
        result["currents"] = None

    return result

@router.get("/stream_frames")
async def stream_frames(
    variable: str = Query("temp", description="Variable: temp, salt, zeta"),
    time_start: int = Query(0, description="Start time index"),
    count: Optional[int] = Query(None, description="Number of frames to stream"),
    depth: int = Query(0, description="Depth index (0-6)"),
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

    total_times = len(meta.get('times', []))
    if total_times == 0:
        raise HTTPException(status_code=400, detail="No time steps in dataset")

    num_frames = count if (count and count > 0) else total_times
    time_indices = [(time_start + i) % total_times for i in range(num_frames)]

    has_contours = variable in meta.get('ranges', {})
    has_currents = 'u' in meta.get('ranges', {}) and 'v' in meta.get('ranges', {})

    async def generate_stream():
        for t_idx in time_indices:
            frame_data = {"time": t_idx}

            if include_contours and has_contours:
                contours = await get_contours_async(file_path, variable, t_idx, depth, tolerance, meta)
                frame_data["contours"] = contours
            else:
                frame_data["contours"] = None

            if include_currents and has_currents:
                currents = await get_currents_async(file_path, t_idx, depth, 2, meta)
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
    
    if len(lon.shape) == 1 and len(lat.shape) == 1:
        lon, lat = np.meshgrid(lon, lat)
        
    if len(lon.shape) != 2 or len(lat.shape) != 2:
        raise HTTPException(status_code=400, detail="Coordinate dimensions must be 2D.")

    m, n = lon.shape
    
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
    variable: str = Query(..., description="Variable: temp, salt, zeta"),
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

    if variable not in ['temp', 'salt', 'zeta']:
        raise HTTPException(status_code=400, detail="Invalid variable. Choose temp, salt, or zeta.")

    if variable not in dataset:
        raise HTTPException(status_code=400, detail=f"Variable '{variable}' not found in dataset.")

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
    
    if len(lon.shape) == 1 and len(lat.shape) == 1:
        lon, lat = np.meshgrid(lon, lat)

    m, n = lon.shape
    if i < 0 or i >= m or j < 0 or j >= n:
        raise HTTPException(status_code=400, detail=f"Grid indices out of bounds. i must be 0-{m-1}, j must be 0-{n-1}")

    dims = dataset[variable].dims
    spatial_y_dim = dims[-2]
    spatial_x_dim = dims[-1]
    
    indexer = {spatial_y_dim: i, spatial_x_dim: j}
    
    if 'depth' in dims and variable != 'zeta':
        if depth < 0 or depth >= len(meta['depths']):
            raise HTTPException(status_code=400, detail=f"Depth index must be between 0 and {len(meta['depths'])-1}")
        indexer['depth'] = depth
        
    try:
        ts_slice = dataset[variable].isel(**indexer)
        raw_vals = ts_slice.values
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query timeseries from dataset. Error: {str(e)}")

    time_sampling = meta.get("time_sampling", 1)
    vals = raw_vals[::time_sampling]
    times = meta.get("times", [])
    
    vals_clean = [float(v) if not np.isnan(v) else None for v in vals]
    
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
