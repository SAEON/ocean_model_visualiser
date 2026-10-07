import os
import xarray as xr
import numpy as np
from bson import ObjectId
from shapely.geometry import Polygon, mapping
from shapely.validation import make_valid
from fastapi import APIRouter, HTTPException, Depends

from backend.database import products_collection, members_collection
from backend.auth import get_current_admin
from backend.schemas import ProductCreate, ProductResponse, ProductUpdate, MemberResponse, serialize_doc

router = APIRouter(prefix="/api/products", tags=["products"])

@router.post("", response_model=ProductResponse)
async def create_product(product: ProductCreate, current_user: dict = Depends(get_current_admin)):
    try:
        product_data = product.dict()
        product_data["region"] = None
        result = await products_collection.insert_one(product_data)
        created = await products_collection.find_one({"_id": result.inserted_id})
        return serialize_doc(created)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@router.get("", response_model=list[ProductResponse])
async def list_products():
    try:
        cursor = products_collection.find()
        products = []
        async for doc in cursor:
            products.append(serialize_doc(doc))
        return products
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@router.get("/{product_id}", response_model=ProductResponse)
async def get_product(product_id: str):
    try:
        obj_id = ObjectId(product_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid product ID format")
    
    product = await products_collection.find_one({"_id": obj_id})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return serialize_doc(product)

@router.get("/{product_id}/members", response_model=list[MemberResponse])
async def list_product_members(product_id: str):
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

@router.post("/{product_id}/derive_region", response_model=ProductResponse)
async def derive_product_region(product_id: str, current_user: dict = Depends(get_current_admin)):
    try:
        prod_obj_id = ObjectId(product_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid product ID format")
        
    product = await products_collection.find_one({"_id": prod_obj_id})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
        
    cursor = members_collection.find({"product_id": prod_obj_id})
    members = []
    async for doc in cursor:
        members.append(doc)
        
    if not members:
        raise HTTPException(status_code=400, detail="Product has no members. Add at least one member first.")
        
    first_member = members[0]
    if not first_member.get("variable_groups"):
        raise HTTPException(status_code=400, detail="First member has no variable groups / file paths defined.")
        
    file_path = first_member["variable_groups"][0]["file_path"]
    if not os.path.exists(file_path):
        raise HTTPException(status_code=400, detail=f"Member NetCDF file not found at path: {file_path}")
        
    try:
        with xr.open_dataset(file_path) as test_ds:
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
            
            if len(lon.shape) == 1 and len(lat.shape) == 1:
                lon, lat = np.meshgrid(lon, lat)
                
            if len(lon.shape) != 2 or len(lat.shape) != 2:
                raise HTTPException(
                    status_code=400,
                    detail=f"Coordinate matrices must be 2D. Found shapes: lon={lon.shape}, lat={lat.shape}"
                )
                
            m, n = lon.shape
            boundary_coords = []
            
            for j in range(n):
                boundary_coords.append((float(lon[0, j]), float(lat[0, j])))
            for i in range(1, m):
                boundary_coords.append((float(lon[i, n-1]), float(lat[i, n-1])))
            for j in range(n-2, -1, -1):
                boundary_coords.append((float(lon[m-1, j]), float(lat[m-1, j])))
            for i in range(m-2, 0, -1):
                boundary_coords.append((float(lon[i, 0]), float(lat[i, 0])))
            boundary_coords.append(boundary_coords[0])
            
            boundary_coords = [(x, y) for x, y in boundary_coords if not (np.isnan(x) or np.isnan(y))]
            if len(boundary_coords) < 4:
                raise HTTPException(status_code=400, detail="Grid perimeter coordinates contain too many NaNs to form a polygon.")
                
            poly = Polygon(boundary_coords)
            if not poly.is_valid:
                poly = make_valid(poly)
                
            simplified = poly.simplify(0.005, preserve_topology=True)
            geojson_mapping = mapping(simplified)
            
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

@router.put("/{product_id}", response_model=ProductResponse)
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

@router.delete("/{product_id}")
async def delete_product(product_id: str, current_user: dict = Depends(get_current_admin)):
    try:
        prod_obj_id = ObjectId(product_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid product ID format")
        
    product = await products_collection.find_one({"_id": prod_obj_id})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
        
    try:
        await members_collection.delete_many({"product_id": prod_obj_id})
        await products_collection.delete_one({"_id": prod_obj_id})
        return {"message": "Product and associated members deleted successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
