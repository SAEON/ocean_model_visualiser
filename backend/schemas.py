from pydantic import BaseModel, field_validator
from typing import List, Optional, Union, Dict, Any, Literal

LEGACY_VARIABLE_DEFAULTS = {
    "temp": {
        "id": "temp",
        "type": "scalar_contour",
        "nc_var": "temp",
        "display_name": "Temperature",
        "unit": "°C",
        "color_scheme": "thermal",
        "is_surface_only": False,
    },
    "salt": {
        "id": "salt",
        "type": "scalar_contour",
        "nc_var": "salt",
        "display_name": "Salinity",
        "unit": "psu",
        "color_scheme": "haline",
        "is_surface_only": False,
    },
    "zeta": {
        "id": "zeta",
        "type": "scalar_contour",
        "nc_var": "zeta",
        "display_name": "Sea Surface Height",
        "unit": "m",
        "color_scheme": "spectral",
        "is_surface_only": True,
    },
    "currents": {
        "id": "currents",
        "type": "vector_pair",
        "nc_u_var": "u",
        "nc_v_var": "v",
        "display_name": "Currents",
        "unit": "m/s",
        "is_surface_only": False,
    },
}

class VariableConfig(BaseModel):
    id: str
    type: Literal["scalar_contour", "vector_pair"] = "scalar_contour"
    nc_var: Optional[str] = None
    nc_u_var: Optional[str] = None
    nc_v_var: Optional[str] = None
    display_name: str
    unit: Optional[str] = ""
    color_scheme: Optional[str] = "viridis"
    is_surface_only: Optional[bool] = False

class ProductCreate(BaseModel):
    name: str

class ProductResponse(BaseModel):
    id: str
    name: str
    region: Optional[dict] = None

class VariableGroup(BaseModel):
    name: str = "Variable Group"
    variables: List[VariableConfig]
    file_path: str
    depths: Optional[List[float]] = None
    time_steps: Optional[List[str]] = None
    time_sampling: Optional[int] = 1

    @field_validator("variables", mode="before")
    @classmethod
    def coerce_legacy_variables(cls, v: Any) -> Any:
        if not isinstance(v, list):
            return v
        coerced = []
        for item in v:
            if isinstance(item, str):
                item_lower = item.lower()
                if item_lower in LEGACY_VARIABLE_DEFAULTS:
                    coerced.append(dict(LEGACY_VARIABLE_DEFAULTS[item_lower]))
                else:
                    coerced.append({
                        "id": item,
                        "type": "vector_pair" if item_lower in ["u", "v"] else "scalar_contour",
                        "nc_var": item,
                        "nc_u_var": "u" if item_lower == "u" else None,
                        "nc_v_var": "v" if item_lower == "v" else None,
                        "display_name": item.replace("_", " ").title(),
                        "unit": "",
                        "color_scheme": "viridis",
                        "is_surface_only": False,
                    })
            elif isinstance(item, dict):
                norm = dict(item)
                if "id" not in norm and "nc_var" in norm:
                    norm["id"] = norm["nc_var"]
                if "display_name" not in norm:
                    norm["display_name"] = norm.get("id", "").replace("_", " ").title()
                if "type" not in norm:
                    norm["type"] = "scalar_contour"
                coerced.append(norm)
            else:
                coerced.append(item)
        return coerced

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

class UserLogin(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str

class UserResponse(BaseModel):
    id: str
    username: str
    role: str = "admin"

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
