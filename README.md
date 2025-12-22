# TimeLapse-Manager

A web-based timelapse configuration and management tool for creating and processing timelapse videos from HTTP and RTSP video streams.

## Overview

TimeLapse-Manager provides a simple web interface and REST API for:
- Creating automated capture jobs from video streams
- Scheduling captures with flexible time windows
- Processing captured images into timelapse videos
- Managing and downloading completed videos

## Quick Start

```bash
docker-compose up -d
```

Access the web interface at `http://<host>:8080`

## Core Functions

**Job Management**
- Create capture jobs with configurable intervals and schedules
- Support for HTTP snapshots and RTSP streams via FFMPEG
- Optional daily time windows (e.g., capture only during daylight hours)
- Automated background capture scheduler

**Video Processing**
- Generate timelapse videos from captured images
- Configurable resolution, framerate, and quality settings
- Real-time progress tracking

**File Storage**
- Captures organized by job and date: `/captures/{job_id}_{job_name}/YYYY/MM/DD/HH/`
- Processed videos stored in: `/timelapses/`
- SQLite database for job configurations and metadata: `/app/data/timelapse-manager.db`

## API Documentation

Interactive API documentation with authentication details and example requests:

**Swagger UI:** `http://localhost:8080/docs`

External API requests require authentication via API key (available in Settings):
- Header: `X-API-Key: YOUR_API_KEY`
- Query parameter: `?api_key=YOUR_API_KEY`

## Docker Configuration

Docker volumes:
- `./captures` → `/captures` - Captured images
- `./timelapses` → `/timelapses` - Processed videos
- `./data` → `/app/data` - Database persistence

Environment variables:

| Variable | Description | Default | Status |
|----------|-------------|---------|--------|
| `PUID` | User ID for file permissions | `0` | **Recommended** |
| `PGID` | Group ID for file permissions | `0` | **Recommended** |
| `TZ` | Timezone for scheduling and timestamps | `Etc/UTC` | **Recommended** |
| `PORT` | Server port | `8080` | Optional |
| `LOG_LEVEL` | Logging level: DEBUG, INFO, WARNING, ERROR | `INFO` | Optional |
| `FFMPEG_TIMEOUT` | FFMPEG operation timeout in seconds | `10` | Optional |

## Technology Stack

- **Backend:** FastAPI (Python) with SQLite database
- **Frontend:** Vanilla HTML/CSS/JavaScript
- **Video Processing:** FFMPEG
- **Container:** Docker

## Repository

https://github.com/kernelkaribou/timelapse-manager

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests. However this is a fun, 100% AI coded project so I am not looking to maintain anything beyond realistic uses, primarily my own.

## License

MIT License - See [LICENSE](LICENSE) file for details.

## Author

Maintained by [kernelkaribou](https://github.com/kernelkaribou)
