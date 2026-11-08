
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.certificate_routes import router as certificate_router
from app.api.batch_routes import router as batch_router

app = FastAPI(
    title="Blockchain Certificate Verification API",
    description=(
        "Backend API for secure certificate validation, "
        "SHA-256 hashing, IPFS storage, and blockchain "
        "batch management."
    ),
    version="1.1.0",
)

# Allow the local React development server to access FastAPI.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(
    certificate_router,
    prefix="/api/v1",
)

app.include_router(
    batch_router,
    prefix="/api/v1",
)


@app.get("/")
async def root():
    return {
        "message": "Blockchain Certificate Verification API is running.",
        "status": "online",
    }


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
    }
