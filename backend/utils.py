"""
Utility functions for timezone-aware datetime handling
"""
from datetime import datetime
from zoneinfo import ZoneInfo
import os


def get_local_timezone() -> ZoneInfo:
    """
    Get the configured local timezone from TZ environment variable.
    Falls back to UTC if TZ is not set.
    
    Returns:
        ZoneInfo: The configured timezone
    """
    tz_str = os.getenv('TZ', 'UTC')
    try:
        return ZoneInfo(tz_str)
    except Exception:
        # Fallback to UTC if invalid timezone
        return ZoneInfo('UTC')


def get_now() -> datetime:
    """
    Get current datetime in the configured timezone.
    This should be used instead of datetime.now() to ensure timezone awareness.
    
    Returns:
        datetime: Current datetime with timezone info
    """
    return datetime.now(get_local_timezone())


def to_iso(dt: datetime) -> str:
    """
    Convert datetime to ISO format string with timezone info.
    Ensures the datetime is timezone-aware.
    
    Args:
        dt: datetime object (timezone-aware or naive)
        
    Returns:
        str: ISO format string
    """
    if dt.tzinfo is None:
        # If naive, assume it's in the local timezone
        dt = dt.replace(tzinfo=get_local_timezone())
    return dt.isoformat()


def parse_iso(iso_string: str) -> datetime:
    """
    Parse ISO format string to timezone-aware datetime.
    If the string doesn't have timezone info, assumes local timezone.
    
    Args:
        iso_string: ISO format datetime string
        
    Returns:
        datetime: Timezone-aware datetime object
    """
    dt = datetime.fromisoformat(iso_string)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=get_local_timezone())
    return dt
