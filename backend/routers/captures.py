"""
Captures API endpoints
"""
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from typing import List, Optional
from datetime import datetime
import os

from ..models import CaptureResponse
from ..database import get_db, dict_from_row

router = APIRouter()


@router.get("/", response_model=List[CaptureResponse])
async def list_captures(
    job_id: Optional[int] = Query(None, description="Filter by job ID"),
    limit: int = Query(100, ge=1, le=100000),
    offset: int = Query(0, ge=0)
):
    """List captures with optional filtering"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        if job_id is not None:
            cursor.execute("""
                SELECT * FROM captures
                WHERE job_id = ?
                ORDER BY captured_at DESC
                LIMIT ? OFFSET ?
            """, (job_id, limit, offset))
        else:
            cursor.execute("""
                SELECT * FROM captures
                ORDER BY captured_at DESC
                LIMIT ? OFFSET ?
            """, (limit, offset))
        
        return [dict_from_row(row) for row in cursor.fetchall()]


@router.get("/{capture_id}", response_model=CaptureResponse)
async def get_capture(capture_id: int):
    """Get a specific capture by ID"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM captures WHERE id = ?", (capture_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Capture not found")
        
        return dict_from_row(row)


@router.delete("/{capture_id}", status_code=204)
async def delete_capture(capture_id: int):
    """Delete a specific capture"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Get capture info before deleting
        cursor.execute("SELECT file_path, file_size, job_id FROM captures WHERE id = ?", (capture_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Capture not found")
        
        file_path, file_size, job_id = row
        
        # Delete capture record
        cursor.execute("DELETE FROM captures WHERE id = ?", (capture_id,))
        
        # Update job statistics
        cursor.execute("""
            UPDATE jobs
            SET capture_count = capture_count - 1,
                storage_size = storage_size - ?,
                updated_at = ?
            WHERE id = ?
        """, (file_size, datetime.now().astimezone().isoformat(), job_id))


@router.get("/job/{job_id}/count")
async def get_capture_count(job_id: int):
    """Get the total number of captures for a job"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM captures WHERE job_id = ?", (job_id,))
        count = cursor.fetchone()[0]
        
        return {"job_id": job_id, "count": count}


@router.get("/job/{job_id}/time-range")
async def get_capture_time_range(
    job_id: int,
    start_time: Optional[str] = Query(None, description="Start time for filtering (ISO format)"),
    end_time: Optional[str] = Query(None, description="End time for filtering (ISO format)")
):
    """Get capture count and first/last capture times for a job, optionally filtered by time range"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Build query based on time filters
        if start_time and end_time:
            # Count captures in time range
            cursor.execute("""
                SELECT COUNT(*), MIN(captured_at), MAX(captured_at)
                FROM captures
                WHERE job_id = ? AND captured_at >= ? AND captured_at <= ?
            """, (job_id, start_time, end_time))
        else:
            # Get overall stats
            cursor.execute("""
                SELECT COUNT(*), MIN(captured_at), MAX(captured_at)
                FROM captures
                WHERE job_id = ?
            """, (job_id,))
        
        row = cursor.fetchone()
        count, first_time, last_time = row
        
        return {
            "job_id": job_id,
            "count": count,
            "first_capture_time": first_time,
            "last_capture_time": last_time
        }


@router.get("/{capture_id}/image")
async def get_capture_image(capture_id: int):
    """Serve the actual capture image file"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT file_path FROM captures WHERE id = ?", (capture_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Capture not found")
        
        file_path = row[0]
        
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="Capture file not found on disk")
        
        if not os.access(file_path, os.R_OK):
            raise HTTPException(status_code=403, detail="No read permission for capture file")
        
        return FileResponse(file_path, media_type="image/jpeg")
