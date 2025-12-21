"""
URL testing service - validates stream URLs and captures test images
"""
import subprocess
import os
import base64
import tempfile
import logging

from ..models import TestUrlResponse
from .. import config

logger = logging.getLogger(__name__)


async def test_stream_url(url: str, stream_type: str = None) -> TestUrlResponse:
    """
    Test a stream URL by attempting to capture a single frame
    
    Args:
        url: The stream URL to test
        stream_type: Either 'http' or 'rtsp' (auto-detected if not provided)
        
    Returns:
        TestUrlResponse with success status and test image info
    """
    try:
        # Auto-detect stream type if not provided
        if stream_type is None:
            stream_type = 'rtsp' if url.lower().startswith('rtsp://') else 'http'
        
        # Create temp file for test capture
        with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp:
            output_path = tmp.name
        
        # Attempt capture based on stream type
        if stream_type == 'rtsp':
            cmd = [
                'ffmpeg',
                '-loglevel', 'error',
                '-rtsp_transport', 'tcp',
                '-i', url,
                '-frames:v', '1',
                '-q:v', '2',
                '-y',
                output_path
            ]
        else:  # http
            cmd = [
                'ffmpeg',
                '-loglevel', 'error',
                '-i', url,
                '-frames:v', '1',
                '-q:v', '2',
                '-y',
                output_path
            ]
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=config.FFMPEG_TIMEOUT,
            check=False
        )
        
        if result.returncode == 0 and os.path.exists(output_path):
            file_size = os.path.getsize(output_path)
            
            # Read and encode image as base64
            with open(output_path, 'rb') as img_file:
                image_bytes = img_file.read()
                image_base64 = base64.b64encode(image_bytes).decode('utf-8')
            
            # Clean up temp file immediately
            os.remove(output_path)
            
            return TestUrlResponse(
                success=True,
                message="Successfully captured test image",
                image_data=f"data:image/jpeg;base64,{image_base64}",
                image_size=file_size
            )
        else:
            # Clean up temp file
            if os.path.exists(output_path):
                os.remove(output_path)
            
            error_msg = result.stderr.decode() if result.stderr else "Unknown error"
            return TestUrlResponse(
                success=False,
                message=f"Error: Please check the URL. {error_msg[:100]}"
            )
            
    except subprocess.TimeoutExpired:
        return TestUrlResponse(
            success=False,
            message="Error: Connection timed out. Please check the URL."
        )
    except Exception as e:
        logger.error(f"Error testing URL: {e}")
        return TestUrlResponse(
            success=False,
            message=f"Error: {str(e)}"
        )
