from pydantic import BaseModel
from typing import List, Optional

class ProductCreate(BaseModel):
    name: str

class ProductResponse(BaseModel):
    id: str
    name: str
    region: Optional[dict] = None

class VariableGroup(BaseModel):
    name: str = "Variable Group"
    variables: List[str]  # Possible items: "temperature", "salinity", "currents", "ssh"
    file_path: str
    depths: Optional[List[float]] = None
    time_steps: Optional[List[str]] = None

class MemberCreate(BaseModel):
    name: str
    variable_groups: List[VariableGroup]

class MemberResponse(BaseModel):
    id: str
    product_id: str
    name: str
    variable_groups: List[VariableGroup]

class ProductUpdate(BaseModel):
    name: str

class MemberUpdate(BaseModel):
    name: str
    variable_groups: List[VariableGroup]

def serialize_doc(doc) -> dict:
    """Helper to convert MongoDB document _id and other ObjectIds to strings."""
    if not doc:
        return {}
    serialized = dict(doc)
    if "_id" in serialized:
        serialized["id"] = str(serialized["_id"])
        del serialized["_id"]
    if "product_id" in serialized:
        serialized["product_id"] = str(serialized["product_id"])
    return serialized
