"""
Duration calculation service - estimates video duration based on captures
"""
from typing import Dict, Any, Optional
from datetime import datetime, timedelta

from ..models import DurationEstimate, DurationCalculation


def calculate_duration(
    job: Dict[str, Any],
    hours: Optional[float] = None,
    days: Optional[float] = None
) -> DurationEstimate:
    """
    Calculate estimated video duration for a timelapse job
    
    Args:
        job: Job dictionary with capture settings
        hours: Hours to estimate (for ongoing jobs)
        days: Days to estimate (for ongoing jobs)
        
    Returns:
        DurationEstimate with calculation for job's specified framerate
    """
    interval_seconds = job['interval_seconds']
    fps = job.get('framerate', 30)  # Use job's framerate, default to 30
    
    # Determine number of captures
    if job['end_datetime']:
        # Job has defined end time
        start = datetime.fromisoformat(job['start_datetime'])
        end = datetime.fromisoformat(job['end_datetime'])
        duration_seconds = (end - start).total_seconds()
        total_captures = int(duration_seconds / interval_seconds)
    else:
        # Ongoing job - use provided time estimate
        if days:
            estimate_seconds = days * 24 * 3600
        elif hours:
            estimate_seconds = hours * 3600
        else:
            # Default estimates: 1 hour, 1 day, 1 week, 1 month
            estimate_seconds = 3600  # 1 hour default
        
        total_captures = int(estimate_seconds / interval_seconds)
    
    # Calculate duration for job's specified framerate
    video_duration = total_captures / fps
    
    # Format duration
    hours = int(video_duration // 3600)
    minutes = int((video_duration % 3600) // 60)
    seconds = int(video_duration % 60)
    
    if hours > 0:
        formatted = f"{hours}h {minutes}m {seconds}s"
    elif minutes > 0:
        formatted = f"{minutes}m {seconds}s"
    else:
        formatted = f"{seconds}s"
    
    calculation = DurationCalculation(
        fps=fps,
        duration_seconds=video_duration,
        duration_formatted=formatted
    )
    
    return DurationEstimate(
        captures=total_captures,
        calculations=[calculation]
    )
