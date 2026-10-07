import os
import xarray as xr
from bson import ObjectId
from fastapi import APIRouter, HTTPException, Depends

from backend.database import products_collection, members_collection
from backend.auth import get_current_admin
from backend.schemas import MemberCreate, MemberResponse, MemberUpdate, serialize_doc
from backend.services.dataset_service import dataset_cache

router = APIRouter(prefix="/api", tags=["members"])

@router.post("/products/{product_id}/members", response_model=MemberResponse)
async def create_member(product_id: str, member: MemberCreate, current_user: dict = Depends(get_current_admin)):
    try:
        prod_obj_id = ObjectId(product_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid product ID format")
        
    product = await products_collection.find_one({"_id": prod_obj_id})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
        
    processed_groups = []
    
    for group in member.variable_groups:
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
        
        try:
            with xr.open_dataset(resolved_path) as test_ds:
                if 'depth' in test_ds:
                    group_depths = [float(d) for d in test_ds['depth'].values]
                    
                if 'time' in test_ds:
                    raw_times = [str(t) for t in test_ds['time'].values]
                    step = group.time_sampling if group.time_sampling and group.time_sampling > 0 else 1
                    group_time_steps = raw_times[::step]
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to open/parse NetCDF file at {group.file_path}. Error: {str(e)}"
            )
            
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

@router.get("/members/{member_id}", response_model=MemberResponse)
async def get_member(member_id: str):
    try:
        obj_id = ObjectId(member_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid member ID format")
        
    member = await members_collection.find_one({"_id": obj_id})
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    return serialize_doc(member)

@router.delete("/members/{member_id}")
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

@router.put("/members/{member_id}", response_model=MemberResponse)
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
        
        try:
            with xr.open_dataset(resolved_path) as test_ds:
                if 'depth' in test_ds:
                    group_depths = [float(d) for d in test_ds['depth'].values]
                    
                if 'time' in test_ds:
                    raw_times = [str(t) for t in test_ds['time'].values]
                    step = group.time_sampling if group.time_sampling and group.time_sampling > 0 else 1
                    group_time_steps = raw_times[::step]
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to open/parse NetCDF file at {group.file_path}. Error: {str(e)}"
            )
            
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
