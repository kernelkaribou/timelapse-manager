FROM python:3.11-slim

# Install ffmpeg and tzdata for timezone support
RUN apt-get update && \
    apt-get install -y ffmpeg tzdata && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Create necessary directories
RUN mkdir -p /app/backend/data /mnt/captures /mnt/timelapses

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV DATABASE_PATH=/app/backend/data/timelapser.db
ENV DEFAULT_CAPTURES_PATH=/mnt/captures
ENV DEFAULT_VIDEOS_PATH=/mnt/timelapses

# Expose port
EXPOSE 8080

# Run the application
CMD ["python", "-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8080"]
