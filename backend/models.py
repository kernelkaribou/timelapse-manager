"""
Pydantic models for request/response validation
"""
from pydantic import BaseModel, Field, HttpUrl
from typing import Optional, List
from datetime import datetime
from enum import Enum


class StreamType(str, Enum):
    HTTP = "http"
    RTSP = "rtsp"


class JobStatus(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"
    ARCHIVED = "archived"


class VideoStatus(str, Enum):
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class JobCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    url: str = Field(..., description="HTTP or RTSP stream URL")
    stream_type: StreamType
    start_datetime: datetime
    end_datetime: Optional[datetime] = None
    interval_seconds: int = Field(..., ge=10, description="Capture interval in seconds")
    framerate: int = Field(default=30, gt=0, le=120)
    capture_path: Optional[str] = None
    naming_pattern: Optional[str] = None


class JobUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    stream_type: Optional[StreamType] = None
    start_datetime: Optional[datetime] = None
    end_datetime: Optional[datetime] = None
    interval_seconds: Optional[int] = Field(None, ge=10)
    framerate: Optional[int] = Field(None, gt=0, le=120)
    status: Optional[JobStatus] = None


class JobResponse(BaseModel):
    id: int
    name: str
    url: str
    stream_type: str
    start_datetime: str
    end_datetime: Optional[str]
    interval_seconds: int
    framerate: int
    status: str
    capture_path: str
    naming_pattern: str
    capture_count: int
    warning_message: Optional[str] = None
    storage_size: int
    created_at: str
    updated_at: str


class CaptureResponse(BaseModel):
    id: int
    job_id: int
    file_path: str
    file_size: int
    captured_at: str


class VideoCreate(BaseModel):
    job_id: int
    name: str
    resolution: str = Field(default="1920x1080", pattern=r"^\d+x\d+$")
    framerate: int = Field(default=30, gt=0, le=120)
    quality: str = Field(default="high", pattern=r"^(low|medium|high|lossless)$")
    start_capture_id: Optional[int] = None
    end_capture_id: Optional[int] = None
    start_time: Optional[str] = None  # ISO datetime string
    end_time: Optional[str] = None  # ISO datetime string


class VideoResponse(BaseModel):
    id: int
    job_id: int
    name: str
    file_path: str
    file_size: int
    resolution: str
    framerate: int
    quality: str
    start_capture_id: Optional[int]
    end_capture_id: Optional[int]
    start_time: Optional[str]
    end_time: Optional[str]
    total_frames: int
    duration_seconds: float
    status: str
    progress: float
    created_at: str
    completed_at: Optional[str]


class SettingsUpdate(BaseModel):
    default_captures_path: Optional[str] = None
    default_videos_path: Optional[str] = None
    default_capture_pattern: Optional[str] = None
    default_video_pattern: Optional[str] = None


class SettingsResponse(BaseModel):
    default_captures_path: str
    default_videos_path: str
    default_capture_pattern: str
    default_video_pattern: str


class TestUrlResponse(BaseModel):
    success: bool
    message: str
    image_data: Optional[str] = None  # Base64 encoded image
    image_size: Optional[int] = None


class DurationCalculation(BaseModel):
    fps: int
    duration_seconds: float
    duration_formatted: str


class DurationEstimate(BaseModel):
    captures: int
    calculations: List[DurationCalculation]
