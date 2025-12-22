"""
Maintenance service for checking and cleaning up job files
"""
import os
import logging
from typing import Dict, List, Any
from ..database import get_db, dict_from_row
from ..utils import get_now, to_iso

logger = logging.getLogger(__name__)


def scan_job_files(job_id: int) -> Dict[str, Any]:
    """
    Scan all captures for a job and identify missing files
    
    Args:
        job_id: The ID of the job to scan
        
    Returns:
        Dictionary containing scan results with missing and existing file counts
    """
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Get job details
        cursor.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        job_row = cursor.fetchone()
        
        if not job_row:
            raise ValueError(f"Job {job_id} not found")
        
        job = dict_from_row(job_row)
        
        # Get all captures for this job
        cursor.execute("""
            SELECT id, file_path, file_size, captured_at 
            FROM captures 
            WHERE job_id = ? 
            ORDER BY captured_at
        """, (job_id,))
        
        captures = cursor.fetchall()
        
        missing_files = []
        existing_count = 0
        total_size_recovered = 0
        
        for capture in captures:
            capture_dict = dict_from_row(capture)
            file_path = capture_dict['file_path']
            
            if not os.path.exists(file_path):
                missing_files.append({
                    'id': capture_dict['id'],
                    'file_path': file_path,
                    'file_size': capture_dict['file_size'],
                    'captured_at': capture_dict['captured_at']
                })
                total_size_recovered += capture_dict['file_size']
            else:
                existing_count += 1
        
        result = {
            'job_id': job_id,
            'job_name': job['name'],
            'total_captures': len(captures),
            'missing_files': missing_files,
            'missing_count': len(missing_files),
            'existing_count': existing_count,
            'total_size_recovered': total_size_recovered
        }
        
        logger.info(f"Maintenance scan for job {job_id} ({job['name']}): "
                   f"{existing_count} existing, {len(missing_files)} missing files")
        
        return result


def cleanup_missing_captures(job_id: int, capture_ids: List[int]) -> Dict[str, Any]:
    """
    Remove database records for missing captures
    
    Args:
        job_id: The ID of the job
        capture_ids: List of capture IDs to remove
        
    Returns:
        Dictionary containing cleanup results
    """
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Verify all capture_ids belong to this job
        placeholders = ','.join('?' * len(capture_ids))
        cursor.execute(f"""
            SELECT COUNT(*) as count 
            FROM captures 
            WHERE id IN ({placeholders}) AND job_id = ?
        """, (*capture_ids, job_id))
        
        count = cursor.fetchone()[0]
        
        if count != len(capture_ids):
            raise ValueError("Some capture IDs do not belong to this job")
        
        # Get the total size before deletion
        cursor.execute(f"""
            SELECT SUM(file_size) as total_size 
            FROM captures 
            WHERE id IN ({placeholders})
        """, capture_ids)
        
        result = cursor.fetchone()
        total_size = result[0] if result[0] else 0
        
        # Delete the captures
        cursor.execute(f"""
            DELETE FROM captures 
            WHERE id IN ({placeholders})
        """, capture_ids)
        
        deleted_count = cursor.rowcount
        
        # Update job statistics
        cursor.execute("""
            SELECT COUNT(*) as count, COALESCE(SUM(file_size), 0) as total_size
            FROM captures
            WHERE job_id = ?
        """, (job_id,))
        
        stats = cursor.fetchone()
        new_count = stats[0]
        new_size = stats[1]
        
        cursor.execute("""
            UPDATE jobs 
            SET capture_count = ?, storage_size = ?, updated_at = ?
            WHERE id = ?
        """, (new_count, new_size, 
              to_iso(get_now()), 
              job_id))
        
        logger.info(f"Cleaned up {deleted_count} missing captures for job {job_id}, "
                   f"recovered {total_size} bytes from database")
        
        return {
            'deleted_count': deleted_count,
            'size_recovered': total_size,
            'new_capture_count': new_count,
            'new_storage_size': new_size
        }
