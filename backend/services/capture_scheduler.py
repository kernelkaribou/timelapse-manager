"""
Capture scheduler service - manages automatic image captures for all active jobs
"""
import threading
import time
from typing import Dict, Optional
from datetime import datetime, timedelta
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

from ..database import get_db, dict_from_row
from ..utils import get_now, to_iso, parse_iso
from .image_capture import capture_image
from .time_window import should_job_capture_now, calculate_next_capture_time

logger = logging.getLogger(__name__)


class CaptureScheduler:
    """Background service to schedule and execute captures for all active jobs"""
    
    def __init__(self):
        self.running = False
        self.thread = None
        self.scheduled_captures: Dict[int, datetime] = {}  # job_id -> next scheduled capture time (in-memory queue)
        self.failure_counts: Dict[int, int] = {}  # Track consecutive failures per job
        self.captures_in_progress: set = set()  # Track job_ids currently being captured to prevent duplicates
        self.executor = ThreadPoolExecutor(max_workers=5, thread_name_prefix="capture-worker")  # Parallel capture execution
        self._lock = threading.Lock()  # Lock for thread-safe operations on shared data
    
    def start(self):
        """Start the scheduler thread"""
        if self.running:
            logger.warning("Scheduler already running")
            return
        
        # Hydrate in-memory queue from database on startup
        self._hydrate_from_database()
        
        self.running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        logger.info(f"Capture scheduler started with {len(self.scheduled_captures)} jobs in queue")
    
    def stop(self):
        """Stop the scheduler thread"""
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)
        self.executor.shutdown(wait=True, cancel_futures=False)
        logger.info("Capture scheduler stopped")
    
    def is_running(self):
        """Check if scheduler is running"""
        return self.running
    
    def _run_loop(self):
        """Main scheduler loop - runs every 10 seconds"""
        while self.running:
            try:
                self._check_and_capture()
            except Exception as e:
                logger.error(f"Error in scheduler loop: {e}")
            
            # Sleep for 10 seconds
            time.sleep(10)
    
    def _hydrate_from_database(self):
        """Load scheduled capture times from database into memory on startup"""
        now = get_now()
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM jobs
                WHERE status IN ('active', 'sleeping')
                AND datetime(start_datetime) <= datetime(?)
                AND (end_datetime IS NULL OR datetime(end_datetime) >= datetime(?))
            """, (to_iso(now), to_iso(now)))
            
            jobs = [dict_from_row(row) for row in cursor.fetchall()]
        
        for job in jobs:
            job_id = job['id']
            
            # Check if job has a scheduled capture time in the database
            if job.get('next_scheduled_capture_at'):
                try:
                    scheduled_time = parse_iso(job['next_scheduled_capture_at'])
                    self.scheduled_captures[job_id] = scheduled_time
                    logger.debug(f"Loaded scheduled capture for job {job_id}: {to_iso(scheduled_time)}")
                except Exception as e:
                    logger.warning(f"Failed to parse next_scheduled_capture_at for job {job_id}: {e}")
                    # Calculate initial schedule
                    self._calculate_and_set_next_capture(job, now)
            else:
                # No scheduled time in DB, calculate it
                self._calculate_and_set_next_capture(job, now)
        
        logger.info(f"Hydrated {len(self.scheduled_captures)} scheduled captures from database")
    
    def _calculate_and_set_next_capture(self, job: dict, reference_time: datetime):
        """Calculate next scheduled capture based on schedule + interval, not completion time"""
        job_id = job['id']
        start_dt = parse_iso(job['start_datetime'])
        interval = job['interval_seconds']
        
        # Calculate how many intervals have passed since start
        elapsed = (reference_time - start_dt).total_seconds()
        
        if elapsed < 0:
            # Job hasn't started yet, schedule at start time
            next_capture = start_dt
        else:
            # Calculate next capture on the schedule grid: start + N * interval
            intervals_passed = int(elapsed / interval)
            next_capture = start_dt + timedelta(seconds=(intervals_passed + 1) * interval)
            
            # Skip missed intervals - schedule for next future slot to prevent catch-up bursts
            # If capture took too long and next_capture is in the past, skip to next available slot
            skipped_count = 0
            while next_capture <= reference_time:
                intervals_passed += 1
                next_capture = start_dt + timedelta(seconds=(intervals_passed + 1) * interval)
                skipped_count += 1
            
            if skipped_count > 0:
                logger.info(f"Job {job_id} ({job['name']}): Skipped {skipped_count} missed interval(s), next scheduled: {to_iso(next_capture)}")
        
        # Store in memory and database
        self.scheduled_captures[job_id] = next_capture
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE jobs SET next_scheduled_capture_at = ?, updated_at = ? WHERE id = ?",
                (to_iso(next_capture), to_iso(reference_time), job_id)
            )
        
        logger.debug(f"Calculated next capture for job {job_id} ({job['name']}): {to_iso(next_capture)}")
    
    def _check_and_capture(self):
        """Check scheduled jobs and capture if it's time, using parallel execution"""
        now = get_now()
        
        # First, update any completed jobs
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE jobs 
                SET status = 'completed', warning_message = NULL, updated_at = ?
                WHERE status IN ('active', 'sleeping')
                AND end_datetime IS NOT NULL
                AND datetime(end_datetime) < datetime(?)
            """, (to_iso(now), to_iso(now)))
            
            if cursor.rowcount > 0:
                logger.info(f"Updated {cursor.rowcount} job(s) to completed status")
                # Remove completed jobs from scheduled captures
                cursor.execute("""
                    SELECT id FROM jobs
                    WHERE status = 'completed'
                """)
                completed_ids = [row[0] for row in cursor.fetchall()]
                for job_id in completed_ids:
                    self.scheduled_captures.pop(job_id, None)
            
            # Get active and sleeping jobs
            cursor.execute("""
                SELECT * FROM jobs
                WHERE status IN ('active', 'sleeping')
                AND datetime(start_datetime) <= datetime(?)
                AND (end_datetime IS NULL OR datetime(end_datetime) >= datetime(?))
            """, (to_iso(now), to_iso(now)))
            
            active_jobs = [dict_from_row(row) for row in cursor.fetchall()]
        
        logger.debug(f"Check at {to_iso(now)}: Found {len(active_jobs)} active/sleeping jobs")
        
        # Update job statuses based on time windows
        for job in active_jobs:
            job_id = job['id']
            should_capture_window, reason = should_job_capture_now(job, now)
            
            if not should_capture_window and reason == 'outside_window':
                if job['status'] != 'sleeping':
                    with get_db() as conn:
                        cursor = conn.cursor()
                        cursor.execute(
                            "UPDATE jobs SET status = 'sleeping', warning_message = NULL, updated_at = ? WHERE id = ?",
                            (to_iso(now), job_id)
                        )
                    logger.info(f"Job {job_id} ({job['name']}) is now sleeping (outside time window)")
            elif should_capture_window and job['status'] == 'sleeping':
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute(
                        "UPDATE jobs SET status = 'active', updated_at = ? WHERE id = ?",
                        (to_iso(now), job_id)
                    )
                logger.info(f"Job {job_id} ({job['name']}) is now active (entered time window)")
        
        # Collect jobs that need capturing right now
        jobs_to_capture = []
        for job in active_jobs:
            job_id = job['id']
            
            # Check if job should capture based on time window
            should_capture_window, reason = should_job_capture_now(job, now)
            if not should_capture_window:
                continue
            
            # Check if job is not in our schedule yet (new job)
            if job_id not in self.scheduled_captures:
                self._calculate_and_set_next_capture(job, now)
            
            scheduled_time = self.scheduled_captures.get(job_id)
            
            # Only capture if scheduled time has arrived AND not already in progress
            with self._lock:
                if scheduled_time and now >= scheduled_time and job_id not in self.captures_in_progress:
                    jobs_to_capture.append(job)
                    self.captures_in_progress.add(job_id)  # Mark as in progress immediately
                    logger.debug(f"Job {job_id} ({job['name']}) ready for capture (scheduled: {to_iso(scheduled_time)})")
                elif job_id in self.captures_in_progress:
                    logger.info(f"Job {job_id} ({job['name']}): Skipped capture (already in progress since {to_iso(scheduled_time)})")
        
        # Execute captures in parallel if there are any
        if jobs_to_capture:
            self._execute_captures_parallel(jobs_to_capture, now)
    
    def _execute_captures_parallel(self, jobs: list, capture_time: datetime):
        """Execute multiple captures in parallel using ThreadPoolExecutor"""
        logger.debug(f"Executing {len(jobs)} capture(s) in parallel")
        
        # Submit all capture tasks
        future_to_job = {}
        for job in jobs:
            future = self.executor.submit(self._capture_and_update, job, capture_time)
            future_to_job[future] = job
        
        # Wait for all captures to complete
        for future in as_completed(future_to_job):
            job = future_to_job[future]
            try:
                future.result()  # This will raise any exceptions that occurred
            except Exception as e:
                logger.error(f"Unexpected error in parallel capture for job {job['id']}: {e}", exc_info=True)
    
    def _capture_and_update(self, job: dict, capture_time: datetime):
        """Perform capture and update schedule - used by parallel executor"""
        job_id = job['id']
        
        try:
            logger.debug(f"Attempting capture for job {job_id}: {job['name']}")
            success, error_message = capture_image(job)
            
            if success:
                self.failure_counts[job_id] = 0  # Reset failure count on success
                logger.debug(f"Successfully captured image for job {job_id}: {job['name']}")
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
        finally:
            # Always calculate next capture based on schedule + interval, regardless of success/failure
            self._calculate_and_set_next_capture(job, capture_time)
            
            # Remove from in-progress set
            with self._lock:
                self.captures_in_progress.discard(job_id)
