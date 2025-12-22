"""
Database models and initialization
"""
import sqlite3
from datetime import datetime
from typing import Optional, List, Dict, Any
from contextlib import contextmanager
from . import config


@contextmanager
def get_db():
    """Context manager for database connections"""
    conn = sqlite3.connect(config.DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """Initialize the database with required tables"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Jobs table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                url TEXT NOT NULL,
                stream_type TEXT NOT NULL,
                start_datetime TEXT NOT NULL,
                end_datetime TEXT,
                interval_seconds INTEGER NOT NULL,
                framerate INTEGER NOT NULL,
                status TEXT DEFAULT 'active',
                capture_path TEXT NOT NULL,
                naming_pattern TEXT NOT NULL,
                capture_count INTEGER DEFAULT 0,
                storage_size INTEGER DEFAULT 0,
                warning_message TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        
        # Captures table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS captures (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                captured_at TEXT NOT NULL,
                FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
            )
        """)
        
        # Processed videos table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS processed_videos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                resolution TEXT NOT NULL,
                framerate INTEGER NOT NULL,
                quality TEXT NOT NULL,
                start_capture_id INTEGER,
                end_capture_id INTEGER,
                start_time TEXT,
                end_time TEXT,
                total_frames INTEGER NOT NULL,
                duration_seconds REAL NOT NULL,
                status TEXT DEFAULT 'processing',
                progress REAL DEFAULT 0,
                created_at TEXT NOT NULL,
                completed_at TEXT,
                FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
            )
        """)
        
        # Settings table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        
        # Insert default settings if not exists
        cursor.execute("""
            INSERT OR IGNORE INTO settings (key, value, updated_at)
            VALUES 
                ('default_captures_path', ?, ?),
                ('default_videos_path', ?, ?),
                ('default_capture_pattern', ?, ?)
        """, (
            config.DEFAULT_CAPTURES_PATH, datetime.now().astimezone().isoformat(),
            config.DEFAULT_VIDEOS_PATH, datetime.now().astimezone().isoformat(),
            config.DEFAULT_CAPTURE_PATTERN, datetime.now().astimezone().isoformat()
        ))
        
        # Create indexes
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_captures_job_id ON captures(job_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_videos_job_id ON processed_videos(job_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)")
        
        # Migration: Add warning_message column if it doesn't exist
        cursor.execute("PRAGMA table_info(jobs)")
        columns = [col[1] for col in cursor.fetchall()]
        if 'warning_message' not in columns:
            cursor.execute("ALTER TABLE jobs ADD COLUMN warning_message TEXT")
        
        # Migration: Add start_time and end_time columns to processed_videos if they don't exist
        cursor.execute("PRAGMA table_info(processed_videos)")
        video_columns = [col[1] for col in cursor.fetchall()]
        if 'start_time' not in video_columns:
            cursor.execute("ALTER TABLE processed_videos ADD COLUMN start_time TEXT")
        if 'end_time' not in video_columns:
            cursor.execute("ALTER TABLE processed_videos ADD COLUMN end_time TEXT")
        
        conn.commit()


def dict_from_row(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert a sqlite3.Row to a dictionary"""
    return dict(zip(row.keys(), row))
