import os
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient

MONGODB_URL = os.environ.get("MONGODB_URL", "mongodb://localhost:27017")

DEFAULT_VARIABLE_MAP = {
    "temp": {
        "id": "temp",
        "type": "scalar_contour",
        "nc_var": "temp",
        "display_name": "Temperature",
        "unit": "°C",
        "color_scheme": "thermal",
        "is_surface_only": False
    },
    "salt": {
        "id": "salt",
        "type": "scalar_contour",
        "nc_var": "salt",
        "display_name": "Salinity",
        "unit": "psu",
        "color_scheme": "haline",
        "is_surface_only": False
    },
    "zeta": {
        "id": "zeta",
        "type": "scalar_contour",
        "nc_var": "zeta",
        "display_name": "Sea Surface Height",
        "unit": "m",
        "color_scheme": "spectral",
        "is_surface_only": True
    },
    "currents": {
        "id": "currents",
        "type": "vector_pair",
        "nc_u_var": "u",
        "nc_v_var": "v",
        "display_name": "Currents",
        "unit": "m/s",
        "is_surface_only": False
    }
}

async def migrate_members():
    print("=== Starting MongoDB Members Variable Groups Migration ===")
    client = AsyncIOMotorClient(MONGODB_URL)
    db = client.ocean_visualizer
    
    cursor = db.members.find({})
    updated_count = 0
    total_count = 0
    
    async for member in cursor:
        total_count += 1
        member_id = member["_id"]
        vgroups = member.get("variable_groups", [])
        modified = False
        
        new_vgroups = []
        for vg in vgroups:
            raw_vars = vg.get("variables", [])
            new_vars = []
            for v in raw_vars:
                if isinstance(v, str):
                    modified = True
                    v_lower = v.lower()
                    if v_lower in DEFAULT_VARIABLE_MAP:
                        new_vars.append(dict(DEFAULT_VARIABLE_MAP[v_lower]))
                    else:
                        new_vars.append({
                            "id": v,
                            "type": "vector_pair" if v_lower in ["u", "v"] else "scalar_contour",
                            "nc_var": v,
                            "nc_u_var": "u" if v_lower == "u" else None,
                            "nc_v_var": "v" if v_lower == "v" else None,
                            "display_name": v.replace("_", " ").title(),
                            "unit": "",
                            "color_scheme": "viridis",
                            "is_surface_only": False
                        })
                elif isinstance(v, dict):
                    norm = dict(v)
                    needs_update = False
                    if "id" not in norm and "nc_var" in norm:
                        norm["id"] = norm["nc_var"]
                        needs_update = True
                    if "display_name" not in norm:
                        norm["display_name"] = norm.get("id", "").replace("_", " ").title()
                        needs_update = True
                    if "type" not in norm:
                        norm["type"] = "scalar_contour"
                        needs_update = True
                    if "unit" not in norm:
                        norm["unit"] = ""
                        needs_update = True
                    if "color_scheme" not in norm:
                        norm["color_scheme"] = "viridis"
                        needs_update = True
                    if "is_surface_only" not in norm:
                        norm["is_surface_only"] = norm.get("id") == "zeta"
                        needs_update = True
                    if needs_update:
                        modified = True
                    new_vars.append(norm)
            
            vg_copy = dict(vg)
            vg_copy["variables"] = new_vars
            new_vgroups.append(vg_copy)
            
        if modified:
            await db.members.update_one(
                {"_id": member_id},
                {"$set": {"variable_groups": new_vgroups}}
            )
            updated_count += 1
            print(f"[Migration] Updated member '{member.get('name', member_id)}' ({member_id}) with normalized variable definitions.")
        else:
            print(f"[Migration] Member '{member.get('name', member_id)}' already up-to-date.")

    print(f"=== Migration Completed: Verified {total_count} members, updated {updated_count} document(s). ===")
    client.close()

if __name__ == "__main__":
    asyncio.run(migrate_members())
