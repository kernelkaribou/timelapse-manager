"""
Configuration management for the application
"""
import os
from pathlib import Path

# Base paths
BASE_DIR = Path(__file__).resolve().parent.parent  # /app
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

# Database
DATABASE_PATH = os.getenv("DATABASE_PATH", str(DATA_DIR / "timelapse-manager.db"))

# Default paths
DEFAULT_CAPTURES_PATH = os.getenv("DEFAULT_CAPTURES_PATH", "/captures")
DEFAULT_VIDEOS_PATH = os.getenv("DEFAULT_VIDEOS_PATH", "/timelapses")

# Default naming patterns
DEFAULT_CAPTURE_PATTERN = os.getenv("DEFAULT_CAPTURE_PATTERN", "{job_name}_{num:06d}_{timestamp}")

# Server settings
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 8080))

# FFMPEG settings
FFMPEG_TIMEOUT = int(os.getenv("FFMPEG_TIMEOUT", 30))
