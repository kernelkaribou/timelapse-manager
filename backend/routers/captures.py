"""
Captures API endpoints
"""
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from typing import List, Optional
from datetime import datetime
import os
import logging

from ..models import CaptureResponse, CaptureListResponse, CaptureDeleteRequest
from ..database import get_db, dict_from_row
from ..utils import get_now, to_iso, parse_iso
from ..services.thumbnail_generator import get_thumbnail_path, has_thumbnail, delete_thumbnail

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/", response_model=CaptureListResponse)
async def list_captures(
    job_id: Optional[int] = Query(None, description="Filter by job ID"),
    start_time: Optional[str] = Query(None, description="Start time (ISO format)"),
    end_time: Optional[str] = Query(None, description="End time (ISO format)"),
    sort_order: str = Query("asc", regex="^(asc|desc)$", description="Sort order: asc or desc"),
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page")
):
    """List captures with pagination and filtering"""
    offset = (page - 1) * page_size
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Build query with filters
        conditions = []
        params = []
        
        if job_id is not None:
            conditions.append("c.job_id = ?")
            params.append(job_id)
        
        if start_time:
            try:
                parse_iso(start_time)  # Validate format
                conditions.append("c.captured_at >= ?")
                params.append(start_time)
            except:
                raise HTTPException(status_code=400, detail="Invalid start_time format")
        
        if end_time:
            try:
                parse_iso(end_time)  # Validate format
                conditions.append("c.captured_at <= ?")
                params.append(end_time)
            except:
                raise HTTPException(status_code=400, detail="Invalid end_time format")
        
        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        
        # Determine sort order
        order_direction = "ASC" if sort_order == "asc" else "DESC"
        
        # Get total count
        count_query = f"""
            SELECT COUNT(*) FROM captures c
            {where_clause}
        """
        cursor.execute(count_query, params)
        total = cursor.fetchone()[0]
        
        # Get captures with job name
        query = f"""
            SELECT c.*, j.name as job_name
            FROM captures c
            LEFT JOIN jobs j ON c.job_id = j.id
            {where_clause}
            ORDER BY c.captured_at {order_direction}
            LIMIT ? OFFSET ?
        """
        cursor.execute(query, params + [page_size, offset])
        
        captures = []
        for row in cursor.fetchall():
            capture_dict = dict_from_row(row)
            capture_dict['has_thumbnail'] = has_thumbnail(capture_dict['file_path'])
            capture_dict['thumbnail_path'] = get_thumbnail_path(capture_dict['file_path']) if capture_dict['has_thumbnail'] else None
            captures.append(capture_dict)
        
        total_pages = (total + page_size - 1) // page_size
        
        return {
            "captures": captures,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages
        }


@router.get("/{capture_id}", response_model=CaptureResponse)
async def get_capture(capture_id: int):
    """Get a specific capture by ID with job name and thumbnail info"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT c.*, j.name as job_name
            FROM captures c
            LEFT JOIN jobs j ON c.job_id = j.id
            WHERE c.id = ?
        """, (capture_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Capture not found")
        
        capture_dict = dict_from_row(row)
        capture_dict['has_thumbnail'] = has_thumbnail(capture_dict['file_path'])
        capture_dict['thumbnail_path'] = get_thumbnail_path(capture_dict['file_path']) if capture_dict['has_thumbnail'] else None
        return capture_dict


@router.delete("/{capture_id}", status_code=204)
async def delete_capture(capture_id: int):
    """Delete a specific capture and its files"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Get capture info before deleting
        cursor.execute("SELECT file_path, file_size, job_id FROM captures WHERE id = ?", (capture_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Capture not found")
        
        file_path, file_size, job_id = row
        
        # Delete the image file
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                logger.info(f"Deleted capture file: {file_path}")
        except Exception as e:
            logger.error(f"Failed to delete capture file {file_path}: {e}")
        
        # Delete thumbnail
        delete_thumbnail(file_path)
        
        # Delete capture record
        cursor.execute("DELETE FROM captures WHERE id = ?", (capture_id,))
        
        # Update job statistics
        cursor.execute("""
            UPDATE jobs
            SET capture_count = CASE 
                    WHEN capture_count > 0 THEN capture_count - 1 
                    ELSE 0 
                END,
                storage_size = CASE 
                    WHEN storage_size >= ? THEN storage_size - ? 
                    ELSE 0 
                END,
                updated_at = ?
            WHERE id = ?
        """, (file_size, file_size, to_iso(get_now()), job_id))


@router.post("/delete-multiple", status_code=200)
async def delete_multiple_captures(request: CaptureDeleteRequest):
    """Delete multiple captures at once"""
    if not request.capture_ids:
        raise HTTPException(status_code=400, detail="No capture IDs provided")
    
    deleted_count = 0
    errors = []
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        for capture_id in request.capture_ids:
            try:
                # Get capture info
                cursor.execute("SELECT file_path, file_size, job_id FROM captures WHERE id = ?", (capture_id,))
                row = cursor.fetchone()
                
                if not row:
                    errors.append(f"Capture {capture_id} not found")
                    continue
                
                file_path, file_size, job_id = row
                
                # Delete files
                try:
                    if os.path.exists(file_path):
                        os.remove(file_path)
                    delete_thumbnail(file_path)
                except Exception as e:
                    logger.error(f"Failed to delete files for capture {capture_id}: {e}")
                
                # Delete record
                cursor.execute("DELETE FROM captures WHERE id = ?", (capture_id,))
                
                # Update job statistics
                cursor.execute("""
                    UPDATE jobs
                    SET capture_count = CASE 
                            WHEN capture_count > 0 THEN capture_count - 1 
                            ELSE 0 
                        END,
                        storage_size = CASE 
                            WHEN storage_size >= ? THEN storage_size - ? 
                            ELSE 0 
                        END,
                        updated_at = ?
                    WHERE id = ?
                """, (file_size, file_size, to_iso(get_now()), job_id))
                
                deleted_count += 1
                
            except Exception as e:
                logger.error(f"Error deleting capture {capture_id}: {e}")
                errors.append(f"Capture {capture_id}: {str(e)}")
    
    return {
        "deleted": deleted_count,
        "requested": len(request.capture_ids),
        "errors": errors
    }


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


@router.get("/{capture_id}/thumbnail")
async def get_capture_thumbnail(capture_id: int):
    """Serve the thumbnail image file"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT file_path FROM captures WHERE id = ?", (capture_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Capture not found")
        
        file_path = row[0]
        thumbnail_path = get_thumbnail_path(file_path)
        
        if not os.path.exists(thumbnail_path):
            # Try to generate thumbnail on-the-fly
            from ..services.thumbnail_generator import generate_thumbnail
            success, error = generate_thumbnail(file_path)
            if not success:
                raise HTTPException(status_code=404, detail="Thumbnail not available")
        
        if not os.access(thumbnail_path, os.R_OK):
            raise HTTPException(status_code=403, detail="No read permission for thumbnail file")
        
        return FileResponse(thumbnail_path, media_type="image/webp")
