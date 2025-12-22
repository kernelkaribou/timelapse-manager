"""
Time window utilities for checking if current time falls within a daily capture window.

Handles time windows that can span across midnight (e.g., 22:00 to 02:00).
"""
from datetime import datetime, time, timedelta
from typing import Tuple, Optional
import logging

logger = logging.getLogger(__name__)


def ensure_timezone_aware(dt: datetime) -> datetime:
    """Ensure a datetime is timezone-aware by adding local timezone if needed"""
    if dt.tzinfo is None:
        from ..utils import get_local_timezone
        return dt.replace(tzinfo=get_local_timezone())
    return dt


def parse_time_string(time_str: str) -> time:
    """Parse HH:MM time string into a time object"""
    hours, minutes = map(int, time_str.split(':'))
    return time(hour=hours, minute=minutes)


def is_time_in_window(current_time: time, start_time: time, end_time: time) -> bool:
    """
    Check if current_time falls within the window from start_time to end_time.
    
    This handles windows that cross midnight. For example:
    - Window: 08:00 to 20:00 (doesn't cross midnight)
      - 10:00 is IN the window
      - 22:00 is NOT in the window
    
    - Window: 22:00 to 02:00 (crosses midnight)
      - 23:00 is IN the window (same day, after start)
      - 01:00 is IN the window (next day, before end)
      - 10:00 is NOT in the window
    
    Logic:
    - If start < end: Normal window, check if start <= current <= end
    - If start >= end: Window crosses midnight
      - We're IN if: current >= start OR current <= end
    """
    if start_time < end_time:
        # Normal window (doesn't cross midnight)
        return start_time <= current_time < end_time
    else:
        # Window crosses midnight
        # We're in the window if we're after the start OR before the end
        return current_time >= start_time or current_time < end_time


def calculate_next_window_start(now: datetime, start_time: time, end_time: time) -> datetime:
    """
    Calculate the next datetime when the time window will open.
    
    If we're currently in the window, returns the start of the next window period.
    If we're outside the window, returns when it will next open.
    """
    current_time = now.time()
    
    # Create datetime for today's window start (ensure timezone-aware)
    today_start = ensure_timezone_aware(datetime.combine(now.date(), start_time))
    
    if is_time_in_window(current_time, start_time, end_time):
        # We're in the window now, so next start is tomorrow
        return today_start + timedelta(days=1)
    
    if start_time < end_time:
        # Normal window (doesn't cross midnight)
        if current_time < start_time:
            # Haven't reached today's window yet
            return today_start
        else:
            # Past today's window, use tomorrow
            return today_start + timedelta(days=1)
    else:
        # Window crosses midnight
        if current_time < end_time:
            # We're in the "early morning" part but already outside the window somehow
            # (shouldn't happen based on is_time_in_window, but handle it)
            # Next window starts later today
            return today_start
        elif current_time < start_time:
            # Between the end and start on the same day
            return today_start
        else:
            # We're past the start, so next window is tomorrow
            return today_start + timedelta(days=1)


def calculate_next_capture_time(
    job: dict,
    last_capture_time: Optional[datetime] = None,
    now: Optional[datetime] = None
) -> Optional[datetime]:
    """
    Calculate the next scheduled capture time for a job.
    
    Takes into account:
    - The job's interval
    - The job's time window (if enabled)
    - The last capture time (if any)
    - The job's start and end dates
    
    Returns None if the job has ended or won't capture again.
    """
    # Ensure now is timezone-aware
    if now is None:
        from ..utils import get_now
        now = get_now()
    else:
        now = ensure_timezone_aware(now)
    
    # Check if job has ended
    if job.get('end_datetime'):
        from ..utils import parse_iso
        end_dt = parse_iso(job['end_datetime'])
        if now >= end_dt:
            return None
    
    # Check if job hasn't started yet
    if job.get('start_datetime'):
        from ..utils import parse_iso
        start_dt = parse_iso(job['start_datetime'])
        if now < start_dt:
            # Job hasn't started, so next capture is at start time
            # But respect time window if enabled
            if job.get('time_window_enabled'):
                start_time = parse_time_string(job['time_window_start'])
                end_time = parse_time_string(job['time_window_end'])
                
                # Check if start_dt is within the time window
                if is_time_in_window(start_dt.time(), start_time, end_time):
                    return start_dt
                else:
                    # Start date is outside window, find next window opening after start
                    next_window = calculate_next_window_start(start_dt, start_time, end_time)
                    if next_window < start_dt:
                        # Window already passed today, but we haven't started yet
                        # This means the start is after the window today, so use tomorrow's window
                        next_window = calculate_next_window_start(
                            start_dt + timedelta(days=1), start_time, end_time
                        )
                    return max(start_dt, next_window)
            return start_dt
    
    interval_seconds = job['interval_seconds']
    
    # Calculate next capture based on interval
    if last_capture_time:
        next_by_interval = last_capture_time + timedelta(seconds=interval_seconds)
    else:
        # No last capture, use now + interval
        next_by_interval = now + timedelta(seconds=interval_seconds)
    
    # If no time window, return the interval-based time
    if not job.get('time_window_enabled'):
        return next_by_interval
    
    # Time window is enabled
    start_time = parse_time_string(job['time_window_start'])
    end_time = parse_time_string(job['time_window_end'])
    
    # Check if next_by_interval falls within a time window
    if is_time_in_window(next_by_interval.time(), start_time, end_time):
        # Perfect, it's in the window
        return next_by_interval
    
    # Next capture by interval is outside the window
    # Find the next window opening
    next_window_start = calculate_next_window_start(next_by_interval, start_time, end_time)
    
    # The next capture will be at the window start
    # But we need to ensure we respect the interval too
    # If we had a last capture, we need to make sure we don't capture too soon
    if last_capture_time:
        earliest_by_interval = last_capture_time + timedelta(seconds=interval_seconds)
        if next_window_start < earliest_by_interval:
            # Window opens before we've waited long enough
            # We need to wait until earliest_by_interval, but it must be in a window
            candidate = earliest_by_interval
            
            # Keep checking future window openings until we find one that's far enough
            max_iterations = 7  # Check up to a week
            for _ in range(max_iterations):
                if is_time_in_window(candidate.time(), start_time, end_time):
                    return candidate
                
                # Move to next window start
                next_window_start = calculate_next_window_start(candidate, start_time, end_time)
                
                # If this window start satisfies our interval requirement, use it
                if next_window_start >= earliest_by_interval:
                    return next_window_start
                
                candidate = next_window_start
            
            # Fallback if we couldn't find a suitable time
            return next_window_start
    
    return next_window_start


def should_job_capture_now(job: dict, now: Optional[datetime] = None) -> Tuple[bool, str]:
    """
    Determine if a job should capture right now.
    
    Returns:
        Tuple of (should_capture: bool, reason: str)
        
    Reasons for not capturing:
    - 'outside_window': Time window is enabled and current time is outside it
    - 'ended': Job has reached its end date
    - 'not_started': Job hasn't started yet
    """
    # Ensure now is timezone-aware
    if now is None:
        from ..utils import get_now
        now = get_now()
    else:
        now = ensure_timezone_aware(now)
    
    # Check if job has ended
    if job.get('end_datetime'):
        from ..utils import parse_iso
        end_dt = parse_iso(job['end_datetime'])
        if now >= end_dt:
            return False, 'ended'
    
    # Check if job hasn't started
    if job.get('start_datetime'):
        from ..utils import parse_iso
        start_dt = parse_iso(job['start_datetime'])
        if now < start_dt:
            return False, 'not_started'
    
    # Check time window if enabled
    if job.get('time_window_enabled'):
        start_time = parse_time_string(job['time_window_start'])
        end_time = parse_time_string(job['time_window_end'])
        current_time = now.time()
        
        if not is_time_in_window(current_time, start_time, end_time):
            return False, 'outside_window'
    
    return True, 'ok'
