# Timelapse Manager

A comprehensive timelapse configuration and management tool with a web UI for creating, managing, and viewing timelapse videos from HTTP and RTSP video streams.

## Features

### Web UI
- **Job Management**: Create, configure, and manage timelapse capture jobs
- **Stream Support**: Capture from HTTP or RTSP video streams using FFMPEG
- **Flexible Scheduling**: Set start/end times and capture intervals
- **Duration Calculator**: Estimate video length at different framerates (24/30/60 FPS)
- **URL Testing**: Test stream URLs before creating jobs
- **Video Processing**: Build timelapse videos with custom resolution, framerate, and quality
- **Progress Tracking**: Monitor video processing progress in real-time
- **Global Settings**: Configure default paths and naming patterns

### Backend
- **SQLite Database**: Efficient storage of jobs, captures, and processed videos
- **Automated Capture**: Background scheduler for automatic image capture
- **FFMPEG Integration**: Professional video capture and processing
- **REST API**: Full-featured API for all operations
- **Docker Support**: Easy deployment with Docker and docker-compose

## Quick Start

### Using Docker (Recommended)

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd timelapser
   ```

2. **Start with docker-compose**
   ```bash
   docker-compose up -d
   ```

3. **Access the application**
   Open your browser and navigate to `http://localhost:8080`

### Manual Installation

1. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

2. **Install FFMPEG**
   - Ubuntu/Debian: `apt-get install ffmpeg`
   - macOS: `brew install ffmpeg`
   - Windows: Download from [ffmpeg.org](https://ffmpeg.org/download.html)

3. **Run the application**
   ```bash
   python backend/app.py
   ```

4. **Access the application**
   Open your browser and navigate to `http://localhost:8080`

## Configuration

### Environment Variables

- `PORT`: Server port (default: 8080)
- `DATABASE_PATH`: Path to SQLite database (default: ./backend/data/timelapser.db)
- `DEFAULT_CAPTURES_PATH`: Default path for image captures (default: /mnt/captures)
- `DEFAULT_VIDEOS_PATH`: Default path for processed videos (default: /mnt/timelapses)
- `FFMPEG_TIMEOUT`: Timeout for FFMPEG operations in seconds (default: 30)

### Docker Volumes

The docker-compose configuration mounts the following directories:

- `./captures` → `/mnt/captures` - Captured images
- `./timelapses` → `/mnt/timelapses` - Processed videos
- `./data` → `/app/backend/data` - SQLite database

## Usage

### Creating a Job

1. Click **"Create Job"** in the Jobs view
2. Enter a job name and stream URL
3. Select stream type (HTTP or RTSP)
4. Test the URL to verify it works
5. Set start time, end time (optional), and capture interval
6. Configure framerate and view duration estimates
7. Optionally customize capture path and naming pattern
8. Click **"Create Job"**

### Processing a Video

1. Navigate to a job card
2. Click **"Process Video"**
3. Configure output settings:
   - Resolution (4K, Full HD, HD, SD)
   - Framerate (24, 30, 60 FPS)
   - Quality (low, medium, high, lossless)
   - Optional: Select specific capture range
4. Click **"Start Processing"**
5. Monitor progress in the Videos tab
6. Download when complete

### Managing Jobs

- **Disable/Enable**: Pause/resume capture without deleting data
- **Archive**: Mark jobs as archived while preserving data
- **Delete**: Permanently remove job and all captures
- **Update**: Modify schedule and settings

## API Documentation

Once running, access the interactive API documentation at:
- Swagger UI: `http://localhost:8080/docs`
- ReDoc: `http://localhost:8080/redoc`

### Key Endpoints

- `GET /api/jobs/` - List all jobs
- `POST /api/jobs/` - Create new job
- `GET /api/jobs/{id}` - Get job details
- `PATCH /api/jobs/{id}` - Update job
- `DELETE /api/jobs/{id}` - Delete job
- `POST /api/jobs/test-url` - Test stream URL
- `POST /api/videos/` - Start video processing
- `GET /api/videos/` - List processed videos
- `GET /api/videos/{id}/download` - Download video
- `GET /api/settings/` - Get global settings
- `PATCH /api/settings/` - Update global settings

## Architecture

### Backend (FastAPI + Python)
- `app.py` - Main FastAPI application
- `database.py` - SQLite database models and management
- `models.py` - Pydantic models for validation
- `config.py` - Configuration management
- `routers/` - API endpoint definitions
- `services/` - Business logic services
  - `capture_scheduler.py` - Automated capture scheduling
  - `image_capture.py` - Image capture from streams
  - `video_processor.py` - Video processing with FFMPEG
  - `url_tester.py` - Stream URL validation
  - `duration_calculator.py` - Duration estimation

### Frontend (HTML/CSS/JavaScript)
- Modern, responsive web interface
- Real-time updates and progress tracking
- No framework dependencies - lightweight and fast

### Database Schema
- `jobs` - Timelapse job configurations
- `captures` - Individual captured images
- `processed_videos` - Processed timelapse videos
- `settings` - Global application settings

## Naming Patterns

Customize how files are named using template variables:

### Capture Pattern
- `{job_name}` - Job name
- `{num:06d}` - Capture number with zero-padding
- `{timestamp}` - Capture timestamp (YYYYMMDD_HHMMSS)

Example: `{job_name}_capture{num:06d}_{timestamp}` → `sunrise_capture000001_20231221_060000.jpg`

### Video Pattern
- `{job_name}` - Job name
- `{created_timestamp}` - Video creation timestamp

Example: `{job_name}_{created_timestamp}` → `sunrise_20231221_120000.mp4`

## Troubleshooting

### FFMPEG Issues
- Ensure FFMPEG is installed and accessible: `ffmpeg -version`
- For RTSP streams, verify network access and credentials
- Check firewall rules for RTSP (typically port 554)

### Permission Issues
- Ensure capture and video directories are writable
- In Docker, check volume mount permissions

### Stream Connection Issues
- Test URLs with the built-in URL tester
- Verify stream is accessible from the server
- Check stream format compatibility with FFMPEG

## Development

### Running in Development Mode
```bash
cd backend
uvicorn app:app --reload --host 0.0.0.0 --port 8080
```

### Project Structure
```
timelapser/
├── backend/
│   ├── app.py
│   ├── config.py
│   ├── database.py
│   ├── models.py
│   ├── routers/
│   │   ├── jobs.py
│   │   ├── captures.py
│   │   ├── videos.py
│   │   └── settings.py
│   └── services/
│       ├── capture_scheduler.py
│       ├── image_capture.py
│       ├── video_processor.py
│       ├── url_tester.py
│       └── duration_calculator.py
├── frontend/
│   ├── index.html
│   └── static/
│       ├── css/
│       │   └── style.css
│       └── js/
│           └── app.js
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── README.md
```

## License

MIT License - feel free to use and modify as needed.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
