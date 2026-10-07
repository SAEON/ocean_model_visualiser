from fastapi import APIRouter, HTTPException, Depends, status
from backend.database import users_collection
from backend.schemas import UserLogin, TokenResponse, UserResponse
from backend.auth import verify_password, create_access_token, get_current_admin

router = APIRouter(prefix="/api/auth", tags=["auth"])

@router.post("/login", response_model=TokenResponse)
async def login(credentials: UserLogin):
    user = await users_collection.find_one({"username": credentials.username})
    if user is None or not verify_password(credentials.password, user["hashed_password"]):
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

@router.get("/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_admin)):
    return {
        "id": str(current_user["_id"]),
        "username": current_user["username"],
        "role": current_user.get("role", "admin")
    }
