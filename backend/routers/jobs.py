"""
Jobs API endpoints
"""
from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
from datetime import datetime
import os
import logging

from ..models import JobCreate, JobUpdate, JobResponse, TestUrlResponse, DurationEstimate, DurationCalculation
from ..database import get_db, dict_from_row
from ..services.url_tester import test_stream_url
from ..services.duration_calculator import calculate_duration

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/", response_model=JobResponse, status_code=201)
async def create_job(job: JobCreate):
    """Create a new timelapse job"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Get default settings if not provided
        if not job.capture_path:
            cursor.execute("SELECT value FROM settings WHERE key = 'default_captures_path'")
            job.capture_path = cursor.fetchone()[0]
        
        if not job.naming_pattern:
            cursor.execute("SELECT value FROM settings WHERE key = 'default_capture_pattern'")
            job.naming_pattern = cursor.fetchone()[0]
        
        # Validate capture_path exists and is writable
        if not os.path.exists(job.capture_path):
            raise HTTPException(
                status_code=400,
                detail=f"Capture path does not exist: {job.capture_path}"
            )
        
        if not os.path.isdir(job.capture_path):
            raise HTTPException(
                status_code=400,
                detail=f"Capture path is not a directory: {job.capture_path}"
            )
        
        if not os.access(job.capture_path, os.W_OK):
            raise HTTPException(
                status_code=400,
                detail=f"No write permission for capture path: {job.capture_path}"
            )
        
        now = datetime.now().astimezone().isoformat()
        
        # Insert job first to get the ID
        cursor.execute("""
            INSERT INTO jobs (
                name, url, stream_type, start_datetime, end_datetime,
                interval_seconds, framerate, capture_path, naming_pattern,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            job.name, job.url, job.stream_type.value,
            job.start_datetime.isoformat(),
            job.end_datetime.isoformat() if job.end_datetime else None,
            job.interval_seconds, job.framerate, "",  # Will update capture_path next
            job.naming_pattern,
            now, now
        ))
        
        job_id = cursor.lastrowid
        
        # Create job directory with ID prefix
        job_dir = os.path.join(job.capture_path, f"{job_id}_{job.name}")
        try:
            os.makedirs(job_dir, exist_ok=True)
        except PermissionError:
            # Rollback the job creation
            cursor.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
            raise HTTPException(
                status_code=400,
                detail=f"Permission denied creating job directory: {job_dir}"
            )
        except Exception as e:
            # Rollback the job creation
            cursor.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
            raise HTTPException(
                status_code=400,
                detail=f"Failed to create job directory: {str(e)}"
            )
        
        # Update the capture_path with the actual directory
        cursor.execute("UPDATE jobs SET capture_path = ? WHERE id = ?", (job_dir, job_id))
        cursor.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        
        logger.info(f"Created job '{job.name}' (ID: {job_id}) - Interval: {job.interval_seconds}s, Stream: {job.stream_type.value}")
        return dict_from_row(cursor.fetchone())


@router.get("/", response_model=List[JobResponse])
async def list_jobs(
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0)
):
    """List all jobs with optional filtering"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        if status:
            cursor.execute(
                "SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (status, limit, offset)
            )
        else:
            cursor.execute(
                "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (limit, offset)
            )
        
        return [dict_from_row(row) for row in cursor.fetchall()]


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(job_id: int):
    """Get a specific job by ID"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Job not found")
        
        return dict_from_row(row)


@router.patch("/{job_id}", response_model=JobResponse)
async def update_job(job_id: int, job_update: JobUpdate):
    """Update a job's configuration"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Check if job exists and get current job data
        cursor.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Job not found")
        
        current_job = dict_from_row(row)
        
        # Build update query dynamically
        updates = []
        values = []
        
        if job_update.name is not None:
            updates.append("name = ?")
            values.append(job_update.name)
        
        if job_update.url is not None:
            updates.append("url = ?")
            values.append(job_update.url)
        
        if job_update.stream_type is not None:
            updates.append("stream_type = ?")
            values.append(job_update.stream_type.value)
        
        if job_update.start_datetime is not None:
            updates.append("start_datetime = ?")
            values.append(job_update.start_datetime.isoformat())
        
        # Validate and handle end_datetime if being updated
        if hasattr(job_update, 'end_datetime') and job_update.model_fields_set and 'end_datetime' in job_update.model_fields_set:
            end_time = job_update.end_datetime
            
            if end_time is not None:
                now = datetime.now()
                
                # Check if end time is in the past
                if end_time <= now:
                    raise HTTPException(status_code=400, detail="End time must be in the future")
                
                # Check if end time is at least one interval in the future
                min_end_time = now.timestamp() + current_job['interval_seconds']
                if end_time.timestamp() < min_end_time:
                    raise HTTPException(
                        status_code=400, 
                        detail=f"End time must be at least {current_job['interval_seconds']} seconds in the future"
                    )
                
                # If job is completed and end time is being extended, reactivate the job
                if current_job['status'] == 'completed':
                    updates.append("status = ?")
                    values.append('active')
            
            # Add to updates (can be None for ongoing jobs)
            updates.append("end_datetime = ?")
            values.append(end_time.isoformat() if end_time else None)
        
        if job_update.interval_seconds is not None:
            updates.append("interval_seconds = ?")
            values.append(job_update.interval_seconds)
        
        if job_update.framerate is not None:
            updates.append("framerate = ?")
            values.append(job_update.framerate)
        
        if job_update.status is not None:
            updates.append("status = ?")
            values.append(job_update.status.value)
        
        if not updates:
            raise HTTPException(status_code=400, detail="No updates provided")
        
        updates.append("updated_at = ?")
        values.append(datetime.now().astimezone().isoformat())
        values.append(job_id)
        
        query = f"UPDATE jobs SET {', '.join(updates)} WHERE id = ?"
        cursor.execute(query, values)
        
        # Return updated job
        cursor.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        updated_job = dict_from_row(cursor.fetchone())
        
        # Log changes
        changes = [f"{field}" for field in job_update.model_fields_set]
        if changes:
            logger.info(f"Updated job '{current_job['name']}' (ID: {job_id}) - Changed: {', '.join(changes)}")
        
        return updated_job


@router.delete("/{job_id}", status_code=204)
async def delete_job(job_id: int, delete_captures: bool = False):
    """Delete a job and optionally its capture files"""
    import os
    import shutil
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Check if job exists and get capture path
        cursor.execute("SELECT name, capture_path FROM jobs WHERE id = ?", (job_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Job not found")
        
        job_name, job_folder = row
        
        # Delete the entire job folder if requested
        if delete_captures and job_folder:
            try:
                if os.path.exists(job_folder) and os.path.isdir(job_folder):
                    shutil.rmtree(job_folder)
                    logger.info(f"Deleted job folder: {job_folder}")
            except Exception as e:
                logger.warning(f"Failed to delete job folder {job_folder}: {e}")
        
        # Delete job (cascades to captures and videos records in DB)
        cursor.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        
        logger.info(f"Deleted job '{job_name}' (ID: {job_id}) - Captures deleted from disk: {delete_captures}")


@router.post("/test-url", response_model=TestUrlResponse)
async def test_url(url: str, stream_type: str = None):
    """Test a URL and capture a sample image"""
    result = await test_stream_url(url, stream_type)
    return result


@router.get("/{job_id}/duration-estimate", response_model=DurationEstimate)
async def estimate_duration(
    job_id: int,
    hours: Optional[float] = Query(None, description="Hours to estimate (for ongoing jobs)"),
    days: Optional[float] = Query(None, description="Days to estimate (for ongoing jobs)")
):
    """Calculate estimated video duration based on capture settings"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        job = cursor.fetchone()
        
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        
        job_dict = dict_from_row(job)
        return calculate_duration(job_dict, hours, days)


@router.get("/{job_id}/latest-image")
async def get_latest_image(job_id: int):
    """Get the path to the latest captured image for a job"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT file_path FROM captures
            WHERE job_id = ?
            ORDER BY captured_at DESC
            LIMIT 1
        """, (job_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="No captures found for this job")
        
        return {"file_path": row[0]}
