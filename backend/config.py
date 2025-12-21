"""
Configuration management for the application
"""
import os
from pathlib import Path

# Base paths
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

# Database
DATABASE_PATH = os.getenv("DATABASE_PATH", str(DATA_DIR / "timelapser.db"))

# Default paths
DEFAULT_CAPTURES_PATH = os.getenv("DEFAULT_CAPTURES_PATH", "/mnt/captures")
DEFAULT_VIDEOS_PATH = os.getenv("DEFAULT_VIDEOS_PATH", "/mnt/timelapses")

# Default naming patterns
DEFAULT_CAPTURE_PATTERN = os.getenv("DEFAULT_CAPTURE_PATTERN", "{job_name}_capture{num:06d}_{timestamp}")
DEFAULT_VIDEO_PATTERN = os.getenv("DEFAULT_VIDEO_PATTERN", "{job_name}_{created_timestamp}")

# Server settings
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 8080))

# FFMPEG settings
FFMPEG_TIMEOUT = int(os.getenv("FFMPEG_TIMEOUT", 30))
