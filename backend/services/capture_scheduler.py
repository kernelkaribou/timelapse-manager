"""
Capture scheduler service - manages automatic image captures for all active jobs
"""
import threading
import time
from typing import Dict
import logging

from ..database import get_db, dict_from_row
from ..utils import get_now, to_iso, parse_iso
from .image_capture import capture_image

logger = logging.getLogger(__name__)


class CaptureScheduler:
    """Background service to schedule and execute captures for all active jobs"""
    
    def __init__(self):
        self.running = False
        self.thread = None
        self.last_capture_times: Dict[int, float] = {}  # Store as timestamps for comparison
        self.failure_counts: Dict[int, int] = {}  # Track consecutive failures per job
    
    def start(self):
        """Start the scheduler thread"""
        if self.running:
            logger.warning("Scheduler already running")
            return
        
        self.running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        logger.info("Capture scheduler started")
    
    def stop(self):
        """Stop the scheduler thread"""
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)
        logger.info("Capture scheduler stopped")
    
    def is_running(self):
        """Check if scheduler is running"""
        return self.running
    
    def _run_loop(self):
        """Main scheduler loop"""
        while self.running:
            try:
                self._check_and_capture()
            except Exception as e:
                logger.error(f"Error in scheduler loop: {e}")
            
            # Check every 10 seconds
            time.sleep(10)
    
    def _check_and_capture(self):
        """Check all active jobs and capture if needed"""
        now = get_now()
        now_ts = now.timestamp()
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # First, update any completed jobs (including those with warnings)
            cursor.execute("""
                UPDATE jobs 
                SET status = 'completed', warning_message = NULL, updated_at = ?
                WHERE status = 'active'
                AND end_datetime IS NOT NULL
                AND datetime(end_datetime) < datetime(?)
            """, (to_iso(now), to_iso(now)))
            
            if cursor.rowcount > 0:
                logger.info(f"Updated {cursor.rowcount} job(s) to completed status")
            
            # Now get active jobs for capture
            cursor.execute("""
                SELECT * FROM jobs
                WHERE status = 'active'
                AND datetime(start_datetime) <= datetime(?)
                AND (end_datetime IS NULL OR datetime(end_datetime) >= datetime(?))
            """, (to_iso(now), to_iso(now)))
            
            active_jobs = [dict_from_row(row) for row in cursor.fetchall()]
        
        logger.debug(f"Check at {to_iso(now)}: Found {len(active_jobs)} active jobs")
        
        for job in active_jobs:
            job_id = job['id']
            last_capture_ts = self.last_capture_times.get(job_id)
            
            # Check if it's time to capture
            if last_capture_ts is None:
                # First capture for this job
                should_capture = True
                logger.debug(f"Job {job_id} ({job['name']}): First capture")
            else:
                elapsed = now_ts - last_capture_ts
                should_capture = elapsed >= job['interval_seconds']
                logger.debug(f"Job {job_id} ({job['name']}): Last capture {elapsed:.0f}s ago, interval {job['interval_seconds']}s, should_capture={should_capture}")
            
            if should_capture:
                try:
                    logger.debug(f"Attempting capture for job {job_id}: {job['name']}")
                    success, error_message = capture_image(job)
                    if success:
                        self.last_capture_times[job_id] = now_ts
                        self.failure_counts[job_id] = 0  # Reset failure count on success
                        logger.debug(f"Captured image for job {job_id}: {job['name']}")
                    else:
                        # Increment failure count
                        self.failure_counts[job_id] = self.failure_counts.get(job_id, 0) + 1
                        consecutive_failures = self.failure_counts[job_id]
                        
                        logger.warning(f"Capture failed for job {job_id}: {job['name']} - {error_message} (failure {consecutive_failures}/3)")
                        
                        # Only set warning message after 3 consecutive failures
                        if consecutive_failures >= 3:
                            with get_db() as conn:
                                cursor = conn.cursor()
                                cursor.execute(
                                    "UPDATE jobs SET warning_message = ? WHERE id = ?",
                                    (f"{error_message} (after {consecutive_failures} consecutive failures)", job_id)
                                )
                        else:
                            # Clear warning if it exists but we haven't hit threshold yet
                            with get_db() as conn:
                                cursor = conn.cursor()
                                cursor.execute(
                                    "UPDATE jobs SET warning_message = NULL WHERE id = ?",
                                    (job_id,)
                                )
                except Exception as e:
                    logger.error(f"Failed to capture for job {job_id}: {e}", exc_info=True)
                    
                    # Increment failure count for exceptions too
                    self.failure_counts[job_id] = self.failure_counts.get(job_id, 0) + 1
                    consecutive_failures = self.failure_counts[job_id]
                    
                    # Only set warning message after 3 consecutive failures
                    if consecutive_failures >= 3:
                        with get_db() as conn:
                            cursor = conn.cursor()
                            cursor.execute(
                                "UPDATE jobs SET warning_message = ? WHERE id = ?",
                                (f"Capture error: {str(e)} (after {consecutive_failures} consecutive failures)", job_id)
                            )
