"""
Context-aware job state calculator - single source of truth
Replaces the circular dependencies between time_window.py, state_manager.py, and scheduler
"""
from typing import Optional, Tuple, Literal
from datetime import datetime, timedelta, time
import logging

from ..utils import get_now, to_iso, parse_iso, ensure_timezone_aware

logger = logging.getLogger(__name__)

JobStatus = Literal['active', 'sleeping', 'completed', 'disabled']


def calculate_next_capture_on_grid(job: dict, reference_time: datetime) -> Optional[datetime]:
    """
    Calculate next capture time on the schedule grid (start + N * interval).
    Returns None if past end_datetime or before start.
    
    This is the pure mathematical calculation without time window logic.
    """
    start_dt = parse_iso(job['start_datetime'])
    end_dt = parse_iso(job['end_datetime']) if job.get('end_datetime') else None
    interval = job['interval_seconds']
    
    # Before start
    if reference_time < start_dt:
        return start_dt
    
    # Calculate next slot on grid
    elapsed = (reference_time - start_dt).total_seconds()
    intervals_passed = int(elapsed / interval)
    next_capture = start_dt + timedelta(seconds=(intervals_passed + 1) * interval)
    
    # Keep advancing until we find a future time
    while next_capture <= reference_time:
        intervals_passed += 1
        next_capture = start_dt + timedelta(seconds=(intervals_passed + 1) * interval)
    
    # Check if past end
    if end_dt and next_capture > end_dt:
        return None
    
    return next_capture


def is_time_in_window(check_time: time, start_time: time, end_time: time) -> bool:
    """
    Check if a time (hour:minute) is within a time window.
    Ignores seconds - compares only hour and minute.
    """
    current_hm = time(check_time.hour, check_time.minute)
    start_hm = time(start_time.hour, start_time.minute)
    end_hm = time(end_time.hour, end_time.minute)
    
    if start_hm == end_hm:
        # Same minute window (e.g., 10:02-10:02)
        return current_hm == start_hm
    elif start_hm < end_hm:
        # Normal window (doesn't cross midnight)
        return start_hm <= current_hm <= end_hm
    else:
        # Window crosses midnight
        return current_hm >= start_hm or current_hm <= end_hm


def parse_time_string(time_str: str) -> time:
    """Parse HH:MM time string to time object"""
    parts = time_str.split(':')
    return time(int(parts[0]), int(parts[1]))


def calculate_next_window_start(reference_time: datetime, start_time: time, end_time: time) -> datetime:
    """Calculate when the time window will next open"""
    current_time = reference_time.time()
    
    # Today's window start
    from ..utils import ensure_timezone_aware
    today_start = ensure_timezone_aware(datetime.combine(reference_time.date(), start_time))
    
    if is_time_in_window(current_time, start_time, end_time):
        # In window now, next start is tomorrow
        return today_start + timedelta(days=1)
    
    if start_time < end_time:
        # Normal window
        if current_time < start_time:
            return today_start
        else:
            return today_start + timedelta(days=1)
    else:
        # Crosses midnight
        if current_time >= start_time:
            return today_start
        else:
            return today_start - timedelta(days=1)


def calculate_job_state(
    job: dict,
    reference_time: datetime,
    pending_capture_time: Optional[datetime] = None
) -> Tuple[JobStatus, Optional[datetime], str]:
    """
    Calculate the correct state for a job with full context awareness.
    
    This is the single source of truth for job state transitions.
    
    Args:
        job: Job configuration dict
        reference_time: Current time to evaluate state at
        pending_capture_time: If job has a scheduled capture pending, pass it here
                             This enables correct handling of boundary captures
    
    Returns:
        (status, next_capture_time, reason)
        - status: 'active' | 'sleeping' | 'completed' | 'disabled'
        - next_capture_time: When next capture should occur (None if completed)
        - reason: Human-readable explanation
    """
    # Disabled jobs stay disabled
    if job.get('status') == 'disabled':
        return ('disabled', None, 'Job manually disabled')
    
    start_dt = parse_iso(job['start_datetime'])
    end_dt = parse_iso(job['end_datetime']) if job.get('end_datetime') else None
    
    # Job hasn't started yet
    if reference_time < start_dt:
        return ('sleeping', start_dt, f'Job starts at {to_iso(start_dt)}')
    
    # CRITICAL: If there's a pending capture, keep it stable until it's executed
    # This prevents the scheduler from constantly recalculating on every check
    if pending_capture_time:
        # Allow a small grace period (2x interval) for pending captures that just passed
        # This ensures the scheduler has time to execute before we reschedule
        grace_period = timedelta(seconds=job['interval_seconds'] * 2)
        
        if pending_capture_time > reference_time - grace_period:
            # Pending capture is either in the future OR just recently passed (within grace period)
            # Check time window if applicable
            if job.get('time_window_enabled'):
                start_time = parse_time_string(job['time_window_start'])
                end_time = parse_time_string(job['time_window_end'])
                
                if is_time_in_window(pending_capture_time.time(), start_time, end_time):
                    return ('active', pending_capture_time, f'Pending capture at {to_iso(pending_capture_time)}')
                else:
                    # Pending capture is outside window - recalculate
                    pass  # Fall through to recalculation
            else:
                # No time window - pending capture is good
                return ('active', pending_capture_time, f'Pending capture at {to_iso(pending_capture_time)}')
        
        # If we get here, pending capture is too old - recalculate
    
    # Calculate next capture on grid
    next_capture = calculate_next_capture_on_grid(job, reference_time)
    
    # No more captures possible (past end_datetime or other issue)
    if next_capture is None:
        return ('completed', None, 'No more captures scheduled')
    
    # Apply time window logic if enabled
    if job.get('time_window_enabled'):
        start_time = parse_time_string(job['time_window_start'])
        end_time = parse_time_string(job['time_window_end'])
        
        # Check if next capture is within the time window
        if is_time_in_window(next_capture.time(), start_time, end_time):
            # Next capture is in window - job is active
            return ('active', next_capture, f'Active, next capture at {to_iso(next_capture)}')
        else:
            # Next capture is outside window - calculate when window reopens
            next_window_start = calculate_next_window_start(reference_time, start_time, end_time)
            
            # Find first capture opportunity when window reopens
            # The window start might not align with grid, so find the first grid slot >= window start
            window_capture = calculate_next_capture_on_grid(job, next_window_start)
            
            if window_capture is None:
                # No captures before job ends
                return ('completed', None, 'Job ends before window reopens')
            
            return ('sleeping', window_capture, f'Outside time window, next capture at {to_iso(window_capture)}')
    
    # No time window - job is active if there's a next capture
    return ('active', next_capture, f'Active, next capture at {to_iso(next_capture)}')


def should_execute_capture(job: dict, scheduled_time: datetime, current_time: datetime) -> Tuple[bool, str]:
    """
    Determine if a scheduled capture should execute.
    
    This is called when a capture's scheduled time has arrived.
    It validates that the capture is still valid given the job's current configuration.
    
    Args:
        job: Job configuration
        scheduled_time: When this capture was scheduled for
        current_time: Current time
    
    Returns:
        (should_execute, reason)
    """
    start_dt = parse_iso(job['start_datetime'])
    end_dt = parse_iso(job['end_datetime']) if job.get('end_datetime') else None
    
    # Check if scheduled time is within job's valid range
    if scheduled_time < start_dt:
        return (False, 'Scheduled before job start')
    
    if end_dt and scheduled_time > end_dt:
        return (False, 'Scheduled after job end')
    
    # For time-windowed jobs, verify scheduled time was within window
    if job.get('time_window_enabled'):
        start_time = parse_time_string(job['time_window_start'])
        end_time = parse_time_string(job['time_window_end'])
        
        if not is_time_in_window(scheduled_time.time(), start_time, end_time):
            return (False, 'Scheduled time was outside time window')
    
    return (True, 'Valid capture')
