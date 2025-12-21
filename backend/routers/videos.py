"""
Processed videos API endpoints
"""
from fastapi import APIRouter, HTTPException, BackgroundTasks, Query
from fastapi.responses import FileResponse
from typing import List, Optional
from datetime import datetime
import os

from ..models import VideoCreate, VideoResponse
from ..database import get_db, dict_from_row
from ..services.video_processor import process_video

router = APIRouter()


@router.post("/", response_model=VideoResponse, status_code=201)
async def create_video(video: VideoCreate, background_tasks: BackgroundTasks):
    """Create a new processed video from captures"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Verify job exists
        cursor.execute("SELECT * FROM jobs WHERE id = ?", (video.job_id,))
        job = cursor.fetchone()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        
        job_dict = dict_from_row(job)
        
        # Get video output path from settings
        cursor.execute("SELECT value FROM settings WHERE key = 'default_videos_path'")
        videos_path = cursor.fetchone()[0]
        
        # Create video record
        now = datetime.utcnow().isoformat()
        output_path = os.path.join(
            videos_path,
            f"{video.name}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.mp4"
        )
        
        cursor.execute("""
            INSERT INTO processed_videos (
                job_id, name, file_path, file_size, resolution,
                framerate, quality, start_capture_id, end_capture_id,
                total_frames, duration_seconds, status, created_at
            ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, 0, 0, 'processing', ?)
        """, (
            video.job_id, video.name, output_path, video.resolution,
            video.framerate, video.quality, video.start_capture_id,
            video.end_capture_id, now
        ))
        
        video_id = cursor.lastrowid
        
        # Start video processing in background
        background_tasks.add_task(
            process_video,
            video_id=video_id,
            job_dict=job_dict,
            resolution=video.resolution,
            framerate=video.framerate,
            quality=video.quality,
            start_capture_id=video.start_capture_id,
            end_capture_id=video.end_capture_id,
            output_path=output_path
        )
        
        cursor.execute("SELECT * FROM processed_videos WHERE id = ?", (video_id,))
        return dict_from_row(cursor.fetchone())


@router.get("/", response_model=List[VideoResponse])
async def list_videos(
    job_id: Optional[int] = Query(None, description="Filter by job ID"),
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0)
):
    """List all processed videos with optional filtering"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        query = "SELECT * FROM processed_videos WHERE 1=1"
        params = []
        
        if job_id is not None:
            query += " AND job_id = ?"
            params.append(job_id)
        
        if status is not None:
            query += " AND status = ?"
            params.append(status)
        
        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        
        cursor.execute(query, params)
        return [dict_from_row(row) for row in cursor.fetchall()]


@router.get("/{video_id}", response_model=VideoResponse)
async def get_video(video_id: int):
    """Get a specific video by ID"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM processed_videos WHERE id = ?", (video_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Video not found")
        
        return dict_from_row(row)


@router.get("/{video_id}/download")
async def download_video(video_id: int):
    """Download a processed video file"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT file_path, name, status FROM processed_videos WHERE id = ?", (video_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Video not found")
        
        file_path, name, status = row
        
        if status != "completed":
            raise HTTPException(status_code=400, detail="Video is not ready for download")
        
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="Video file not found on disk")
        
        return FileResponse(
            file_path,
            media_type="video/mp4",
            filename=f"{name}.mp4"
        )


@router.delete("/{video_id}", status_code=204)
async def delete_video(video_id: int):
    """Delete a processed video"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Get video info
        cursor.execute("SELECT file_path FROM processed_videos WHERE id = ?", (video_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Video not found")
        
        file_path = row[0]
        
        # Delete file if it exists
        if os.path.exists(file_path):
            os.remove(file_path)
        
        # Delete record
        cursor.execute("DELETE FROM processed_videos WHERE id = ?", (video_id,))
