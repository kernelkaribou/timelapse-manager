"""
Jobs API endpoints
"""
from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
from datetime import datetime
import os
import logging

from ..models import JobCreate, JobUpdate, JobResponse, TestUrlResponse, DurationEstimate, DurationCalculation, MaintenanceResult, MaintenanceCleanup, MaintenanceImport
from ..database import get_db, dict_from_row
from ..services.url_tester import test_stream_url
from ..services.duration_calculator import calculate_duration
from ..services.maintenance import scan_job_files, cleanup_missing_captures, import_orphaned_files
from ..services.time_window import should_job_capture_now, ensure_timezone_aware, calculate_next_capture_time
from ..utils import get_now, to_iso, parse_iso

router = APIRouter()
logger = logging.getLogger(__name__)


def enrich_job_with_next_capture(job_dict: dict) -> dict:
    """Add next_capture_at field to job dict"""
    # Get last capture for this job to calculate next capture time
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT captured_at FROM captures
            WHERE job_id = ?
            ORDER BY captured_at DESC
            LIMIT 1
        """, (job_dict['id'],))
        row = cursor.fetchone()
        
        last_capture_time = None
        if row:
            from ..utils import parse_iso
            last_capture_time = parse_iso(row[0])
        
        next_capture = calculate_next_capture_time(job_dict, last_capture_time)
        job_dict['next_capture_at'] = to_iso(next_capture) if next_capture else None
        
        return job_dict



@router.post("/", response_model=JobResponse, status_code=201)
async def create_job(job: JobCreate):
    """Create a new timelapse job"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Get default values from config if not provided
        from .. import config
        if not job.capture_path:
            job.capture_path = config.DEFAULT_CAPTURES_PATH
        
        if not job.naming_pattern:
            job.naming_pattern = config.DEFAULT_CAPTURE_PATTERN
        
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
        
        now = get_now()
        now_str = to_iso(now)
        
        # Insert job first to get the ID
        cursor.execute("""
            INSERT INTO jobs (
                name, url, stream_type, start_datetime, end_datetime,
                interval_seconds, framerate, capture_path, naming_pattern,
                time_window_enabled, time_window_start, time_window_end,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            job.name, job.url, job.stream_type.value,
            to_iso(job.start_datetime),
            to_iso(job.end_datetime) if job.end_datetime else None,
            job.interval_seconds, job.framerate, "",  # Will update capture_path next
            job.naming_pattern,
            1 if job.time_window_enabled else 0,
            job.time_window_start if job.time_window_enabled else None,
            job.time_window_end if job.time_window_enabled else None,
            now_str, now_str
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
        
        job_dict = dict_from_row(cursor.fetchone())
        
        # Calculate correct initial status and next_scheduled_capture_at using centralized calculator
        from ..services.time_window import calculate_next_scheduled_capture, should_job_capture_now
        should_capture, reason = should_job_capture_now(job_dict)
        correct_status = 'active' if should_capture else 'sleeping'
        next_capture_at = calculate_next_scheduled_capture(job_dict, now)
        
        # Update status and next_scheduled_capture_at
        cursor.execute(
            "UPDATE jobs SET status = ?, next_scheduled_capture_at = ? WHERE id = ?",
            (correct_status, to_iso(next_capture_at), job_id)
        )
        cursor.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        job_dict = dict_from_row(cursor.fetchone())
        logger.info(f"Job {job_id} initial status set to {correct_status} (reason: {reason}), next capture: {to_iso(next_capture_at)}")
        
        logger.info(f"Created job '{job.name}' (ID: {job_id}) - Interval: {job.interval_seconds}s, Stream: {job.stream_type.value}")
        return enrich_job_with_next_capture(job_dict)



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
        
        jobs = [dict_from_row(row) for row in cursor.fetchall()]
        return [enrich_job_with_next_capture(job) for job in jobs]


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(job_id: int):
    """Get a specific job by ID"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Job not found")
        
        return enrich_job_with_next_capture(dict_from_row(row))



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
            values.append(to_iso(job_update.start_datetime))
        
        # Validate and handle end_datetime if being updated
        if hasattr(job_update, 'end_datetime') and job_update.model_fields_set and 'end_datetime' in job_update.model_fields_set:
            end_time = job_update.end_datetime
            
            if end_time is not None:
                # Ensure timezone awareness for comparison
                end_time = ensure_timezone_aware(end_time)
                now = get_now()
                
                # Only validate future end time if not explicitly completing the job
                # Allow end_datetime to be now or past when status is being set to completed
                is_completing = job_update.status is not None and job_update.status.value == 'completed'
                
                if not is_completing:
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
            
            # Add to updates (can be None for ongoing jobs)
            # Status will be recalculated later based on end_datetime and time windows
            updates.append("end_datetime = ?")
            values.append(to_iso(end_time) if end_time else None)
        
        if job_update.interval_seconds is not None:
            updates.append("interval_seconds = ?")
            values.append(job_update.interval_seconds)
        
        if job_update.framerate is not None:
            updates.append("framerate = ?")
            values.append(job_update.framerate)
        
        if job_update.status is not None:
            updates.append("status = ?")
            values.append(job_update.status.value)
            
            # If re-enabling a disabled job, recalculate next_scheduled_capture_at
            if current_job['status'] == 'disabled' and job_update.status.value == 'active':
                from ..services.time_window import calculate_next_scheduled_capture
                now = get_now()
                next_capture = calculate_next_scheduled_capture(current_job, now)
                
                updates.append("next_scheduled_capture_at = ?")
                values.append(to_iso(next_capture))
                logger.info(f"Job {job_id}: Re-enabled, recalculated next capture to {to_iso(next_capture)}")
        
        # Track if schedule-affecting fields are being updated
        schedule_changed = False
        status_needs_recalc = False
        
        # Handle time window updates
        if job_update.time_window_enabled is not None:
            updates.append("time_window_enabled = ?")
            values.append(1 if job_update.time_window_enabled else 0)
            schedule_changed = True
        
        if job_update.time_window_start is not None:
            updates.append("time_window_start = ?")
            values.append(job_update.time_window_start)
            schedule_changed = True
        
        if job_update.time_window_end is not None:
            updates.append("time_window_end = ?")
            values.append(job_update.time_window_end)
            schedule_changed = True
        
        # Check if interval or start time changed
        if job_update.interval_seconds is not None:
            schedule_changed = True
        
        if job_update.start_datetime is not None:
            schedule_changed = True
        
        # End date changes affect status (completed -> active/sleeping)
        if job_update.end_datetime is not None:
            status_needs_recalc = True
        
        # Recalculate next_scheduled_capture_at and status if needed
        if (schedule_changed or status_needs_recalc) and current_job['status'] in ('active', 'sleeping', 'completed'):
            from ..services.time_window import calculate_next_scheduled_capture, should_job_capture_now
            now = get_now()
            
            # Build updated job dict with new values
            updated_job = current_job.copy()
            if job_update.start_datetime is not None:
                updated_job['start_datetime'] = to_iso(job_update.start_datetime)
            if 'end_datetime' in job_update.model_fields_set:
                updated_job['end_datetime'] = to_iso(job_update.end_datetime) if job_update.end_datetime else None
            if job_update.interval_seconds is not None:
                updated_job['interval_seconds'] = job_update.interval_seconds
            if job_update.time_window_enabled is not None:
                updated_job['time_window_enabled'] = job_update.time_window_enabled
            if job_update.time_window_start is not None:
                updated_job['time_window_start'] = job_update.time_window_start
            if job_update.time_window_end is not None:
                updated_job['time_window_end'] = job_update.time_window_end
            
            # Use centralized calculator for next capture time
            next_capture = calculate_next_scheduled_capture(updated_job, now)
            should_capture, reason = should_job_capture_now(updated_job, now)
            correct_status = 'active' if should_capture else 'sleeping'
            
            updates.append("next_scheduled_capture_at = ?")
            values.append(to_iso(next_capture))
            updates.append("status = ?")
            values.append(correct_status)
            logger.info(f"Job {job_id}: Schedule/status updated, status={correct_status}, next capture at {to_iso(next_capture)}")
        
        if not updates:
            raise HTTPException(status_code=400, detail="No updates provided")
        
        updates.append("updated_at = ?")
        values.append(to_iso(get_now()))
        values.append(job_id)
        
        query = f"UPDATE jobs SET {', '.join(updates)} WHERE id = ?"
        cursor.execute(query, values)
        
        # Return updated job
        cursor.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        updated_job = dict_from_row(cursor.fetchone())
        
        # Always recalculate status for active/sleeping jobs after any update
        # This ensures the job is in the correct state based on time window
        if updated_job['status'] in ('active', 'sleeping'):
            should_capture, reason = should_job_capture_now(updated_job)
            correct_status = 'active' if should_capture else 'sleeping'
            
            # Update status if it doesn't match what it should be
            if correct_status != updated_job['status']:
                cursor.execute("UPDATE jobs SET status = ? WHERE id = ?", (correct_status, job_id))
                cursor.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
                updated_job = dict_from_row(cursor.fetchone())
                logger.info(f"Job {job_id} status corrected to {correct_status} based on current time window (reason: {reason})")
        
        # Log changes
        changes = [f"{field}" for field in job_update.model_fields_set]
        if changes:
            logger.info(f"Updated job '{current_job['name']}' (ID: {job_id}) - Changed: {', '.join(changes)}")
        
        return enrich_job_with_next_capture(updated_job)


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


@router.post("/{job_id}/maintenance/scan", response_model=MaintenanceResult)
async def scan_job_maintenance(job_id: int):
    """
    Scan a job's captures to identify missing files on disk.
    Returns a list of captures that reference files that no longer exist.
    """
    try:
        result = scan_job_files(job_id)
        logger.info(f"Maintenance scan completed for job {job_id}: "
                   f"{result['missing_count']} missing files found")
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error during maintenance scan for job {job_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Maintenance scan failed: {str(e)}")


@router.post("/{job_id}/maintenance/cleanup")
async def cleanup_job_maintenance(job_id: int, cleanup: MaintenanceCleanup):
    """
    Remove database records for captures that are missing on disk.
    This endpoint should be called after scan to confirm which records to delete.
    """
    try:
        if not cleanup.capture_ids:
            raise HTTPException(status_code=400, detail="No capture IDs provided")
        
        result = cleanup_missing_captures(job_id, cleanup.capture_ids)
        logger.info(f"Maintenance cleanup completed for job {job_id}: "
                   f"{result['deleted_count']} records removed")
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error during maintenance cleanup for job {job_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Maintenance cleanup failed: {str(e)}")


@router.post("/{job_id}/maintenance/import")
async def import_job_maintenance(job_id: int, import_data: MaintenanceImport):
    """
    Import orphaned files found on disk into the database.
    This endpoint should be called after scan to add missing capture records.
    """
    try:
        if not import_data.orphaned_files:
            raise HTTPException(status_code=400, detail="No orphaned files provided")
        
        result = import_orphaned_files(job_id, import_data.orphaned_files)
        logger.info(f"Maintenance import completed for job {job_id}: "
                   f"{result['imported_count']} files imported")
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error during maintenance import for job {job_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Maintenance import failed: {str(e)}")

