"""
Main FastAPI application for Timelapse Manager
"""
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import uvicorn

from .database import init_db
from .routers import jobs, captures, videos, settings
from .services.capture_scheduler import CaptureScheduler

# Global scheduler instance
scheduler = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    global scheduler
    
    # Startup
    init_db()
    scheduler = CaptureScheduler()
    scheduler.start()
    print("Database initialized")
    print("Capture scheduler started")
    
    yield
    
    # Shutdown
    if scheduler:
        scheduler.stop()
        print("Capture scheduler stopped")


app = FastAPI(
    title="Timelapse Manager",
    description="Configuration and management tool for timelapse videos",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(jobs.router, prefix="/api/jobs", tags=["jobs"])
app.include_router(captures.router, prefix="/api/captures", tags=["captures"])
app.include_router(videos.router, prefix="/api/videos", tags=["videos"])
app.include_router(settings.router, prefix="/api/settings", tags=["settings"])

# Serve static files for frontend
app.mount("/static", StaticFiles(directory="frontend/static"), name="static")

# Serve capture images
app.mount("/captures", StaticFiles(directory="/captures"), name="captures")

# Serve video files
app.mount("/videos", StaticFiles(directory="/timelapses"), name="videos")


@app.get("/")
async def read_root():
    """Serve the main frontend page"""
    return FileResponse("frontend/index.html")


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "scheduler": scheduler.is_running() if scheduler else False}


if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8080, reload=True)
