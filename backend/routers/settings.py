"""
Settings API endpoints
"""
from fastapi import APIRouter, HTTPException
from datetime import datetime

from ..models import SettingsUpdate, SettingsResponse
from ..database import get_db

router = APIRouter()


@router.get("/", response_model=SettingsResponse)
async def get_settings():
    """Get all global settings"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM settings")
        settings = {row[0]: row[1] for row in cursor.fetchall()}
        
        return SettingsResponse(
            default_captures_path=settings.get("default_captures_path", "/mnt/captures"),
            default_videos_path=settings.get("default_videos_path", "/mnt/timelapses"),
            default_capture_pattern=settings.get("default_capture_pattern", "{job_name}_capture{num:06d}_{timestamp}"),
            default_video_pattern=settings.get("default_video_pattern", "{job_name}_{created_timestamp}")
        )


@router.patch("/", response_model=SettingsResponse)
async def update_settings(settings_update: SettingsUpdate):
    """Update global settings"""
    with get_db() as conn:
        cursor = conn.cursor()
        now = datetime.utcnow().isoformat()
        
        if settings_update.default_captures_path is not None:
            cursor.execute("""
                INSERT OR REPLACE INTO settings (key, value, updated_at)
                VALUES ('default_captures_path', ?, ?)
            """, (settings_update.default_captures_path, now))
        
        if settings_update.default_videos_path is not None:
            cursor.execute("""
                INSERT OR REPLACE INTO settings (key, value, updated_at)
                VALUES ('default_videos_path', ?, ?)
            """, (settings_update.default_videos_path, now))
        
        if settings_update.default_capture_pattern is not None:
            cursor.execute("""
                INSERT OR REPLACE INTO settings (key, value, updated_at)
                VALUES ('default_capture_pattern', ?, ?)
            """, (settings_update.default_capture_pattern, now))
        
        if settings_update.default_video_pattern is not None:
            cursor.execute("""
                INSERT OR REPLACE INTO settings (key, value, updated_at)
                VALUES ('default_video_pattern', ?, ?)
            """, (settings_update.default_video_pattern, now))
        
        # Return updated settings
        return await get_settings()
