// API Base URL
const API_BASE = '/api';

// Current state
let currentView = 'jobs';
let currentJobId = null;
let refreshIntervals = [];
let confirmCallback = null;

// Notification system
function showNotification(message, type = 'success') {
    const toast = document.getElementById('notification-toast');
    const messageEl = document.getElementById('notification-message');
    
    messageEl.textContent = message;
    toast.className = `notification-toast ${type}`;
    
    // Show toast
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Hide after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Confirmation system
function showConfirm(message, callback, showOptions = false) {
    const modal = document.getElementById('confirm-modal');
    const messageEl = document.getElementById('confirm-message');
    const optionsDiv = document.getElementById('confirm-options');
    const checkbox = document.getElementById('delete-captures-checkbox');
    
    messageEl.textContent = message;
    confirmCallback = callback;
    
    // Show/hide options and reset checkbox
    if (showOptions) {
        optionsDiv.style.display = 'block';
        checkbox.checked = false;
    } else {
        optionsDiv.style.display = 'none';
    }
    
    modal.classList.add('active');
}

function closeConfirmModal(confirmed) {
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('active');
    
    if (confirmCallback) {
        confirmCallback(confirmed);
        confirmCallback = null;
    }
}

// Prevent Enter key from submitting forms
function preventEnterSubmit(event) {
    if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA') {
        event.preventDefault();
        return false;
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    loadJobs();
    loadSettings();
    
    // Setup refresh intervals
    refreshIntervals.push(setInterval(loadJobs, 10000)); // Refresh jobs every 10s
    refreshIntervals.push(setInterval(loadVideos, 5000)); // Refresh videos every 5s
    
    // Setup range checkbox
    document.getElementById('use_range').addEventListener('change', (e) => {
        const captureRange = document.getElementById('capture-range');
        const startTimeInput = document.getElementById('start_time');
        const endTimeInput = document.getElementById('end_time');
        
        if (e.target.checked) {
            captureRange.style.display = 'flex';
            startTimeInput.disabled = false;
            endTimeInput.disabled = false;
            // Update duration estimate for the selected time range
            updateVideoDurationEstimate();
        } else {
            captureRange.style.display = 'none';
            startTimeInput.disabled = true;
            endTimeInput.disabled = true;
            // Revert to showing full duration estimate
            updateVideoDurationEstimate();
        }
    });
    
    // Prevent Enter key from submitting forms
    document.querySelectorAll('form').forEach(form => {
        form.addEventListener('keydown', preventEnterSubmit);
    });
});

// Navigation
function setupNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const view = e.target.dataset.view;
            switchView(view);
        });
    });
}

function switchView(view) {
    // Update navigation
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.view === view);
    });
    
    // Update content
    document.querySelectorAll('.view').forEach(v => {
        v.classList.toggle('active', v.id === `${view}-view`);
    });
    
    currentView = view;
    
    // Load data for view
    if (view === 'jobs') loadJobs();
    if (view === 'videos') loadVideos();
    if (view === 'settings') loadSettings();
}

// Jobs
async function loadJobs() {
    try {
        const response = await fetch(`${API_BASE}/jobs/`);
        const jobs = await response.json();
        
        // Get latest captures for each job
        const jobsWithCaptures = await Promise.all(jobs.map(async (job) => {
            try {
                const capturesResp = await fetch(`${API_BASE}/captures/?job_id=${job.id}&limit=1`);
                const captures = await capturesResp.json();
                job.latest_capture = captures.length > 0 ? captures[0] : null;
            } catch (error) {
                job.latest_capture = null;
            }
            return job;
        }));
        
        renderJobs(jobsWithCaptures);
    } catch (error) {
        console.error('Failed to load jobs:', error);
    }
}

function renderJobs(jobs) {
    const container = document.getElementById('jobs-list');
    
    if (jobs.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>No jobs yet</h3>
                <p>Create your first timelapse job to get started</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = jobs.map(job => {
        const thumbnailHtml = job.latest_capture 
            ? `<div class="job-thumbnail" style="background-image: url('${getImageUrl(job.latest_capture.file_path)}'); background-size: cover; background-position: center; height: 120px; border-radius: 0.5rem; margin-bottom: 1rem;"></div>`
            : `<div class="job-thumbnail" style="background: var(--border-color); height: 120px; border-radius: 0.5rem; margin-bottom: 1rem; display: flex; align-items: center; justify-content: center; color: var(--text-secondary);">No captures yet</div>`;
        
        return `
        <div class="job-card" onclick="showJobDetails(${job.id})">
            ${thumbnailHtml}
            <div class="job-card-header">
                <div class="job-card-title">${escapeHtml(job.name)}</div>
                <span class="job-status ${job.warning_message ? 'warning' : job.status}">
                    ${job.warning_message ? '⚠ Warning' : (job.status.charAt(0).toUpperCase() + job.status.slice(1))}
                </span>
            </div>
            <div class="job-info">
                <div><strong>Stream:</strong> <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; max-width: 250px; vertical-align: bottom;">${escapeHtml(getStreamHost(job.url))}</span></div>
                <div><strong>Interval:</strong> ${job.interval_seconds}s</div>
                ${job.end_datetime ? `<div><strong>Ends:</strong> ${formatDateTime(job.end_datetime)}</div>` : '<div><strong>Ongoing capture</strong></div>'}
                <div style="margin-top: 0.5rem;">
                    <span class="stat-inline">${job.capture_count} captures</span> · 
                    <span class="stat-inline">${formatBytes(job.storage_size)}</span>
                </div>
            </div>
        </div>
    `;
    }).join('');
}

async function showJobDetails(jobId) {
    try {
        const [job, captures] = await Promise.all([
            fetch(`${API_BASE}/jobs/${jobId}`).then(r => r.json()),
            fetch(`${API_BASE}/captures/?job_id=${jobId}&limit=1`).then(r => r.json())
        ]);
        
        const modal = document.getElementById('job-details-modal');
        const content = document.getElementById('job-details-content');
        
        let latestImageHtml = '';
        if (captures.length > 0) {
            latestImageHtml = `
                <div style="margin: 1.5rem 0;">
                    <h4 style="margin-bottom: 0.5rem;">Latest Capture</h4>
                    <p style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 0.5rem;">${formatDateTime(captures[0].captured_at)}</p>
                    <img src="${getImageUrl(captures[0].file_path)}" alt="Latest capture" style="max-width: 100%; border-radius: 0.5rem; border: 1px solid var(--border-color);">
                </div>
            `;
        }
        
        // Calculate minimum end time (now + interval)
        const now = new Date();
        now.setSeconds(now.getSeconds() + job.interval_seconds);
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        const minEndTime = now.toISOString().slice(0, 16);
        
        const currentEndTime = job.end_datetime ? toLocalDateTimeString(job.end_datetime) : '';
        
        content.innerHTML = `
            <div style="padding: 1.5rem;">
                ${latestImageHtml}
                
                ${job.warning_message ? `
                <div style="margin: 1rem 0; padding: 1rem; background: #fed7aa; color: #9a3412; border-radius: 0.5rem; border-left: 4px solid #ea580c;">
                    <div style="display: flex; align-items: start; gap: 0.5rem;">
                        <span style="font-size: 1.25rem;">⚠</span>
                        <div>
                            <strong>Capture Warning</strong>
                            <p style="margin-top: 0.25rem; font-size: 0.875rem;">${escapeHtml(job.warning_message)}</p>
                            <p style="margin-top: 0.5rem; font-size: 0.75rem; opacity: 0.8;">Verify settings for the job. The job will continue attempting captures in case this is a temporary issue.</p>
                        </div>
                    </div>
                </div>
                ` : ''}
                
                <div class="job-info" style="margin-bottom: 1.5rem;">
                    <div><strong>Name:</strong> ${escapeHtml(job.name)}</div>
                    <div><strong>Status:</strong> <span class="job-status ${job.warning_message ? 'warning' : job.status}">${job.warning_message ? '⚠ Warning' : (job.status.charAt(0).toUpperCase() + job.status.slice(1))}</span></div>
                    <div><strong>Start:</strong> ${formatDateTime(job.start_datetime)}</div>
                </div>

                <div class="form-group" style="margin-bottom: 1.5rem;">
                    <label>End Date & Time ${job.end_datetime ? '' : '(Currently ongoing)'}</label>
                    <input type="datetime-local" id="edit_end_datetime" class="form-control" value="${currentEndTime}" min="${minEndTime}">
                    <small style="color: var(--text-secondary);">Leave empty for ongoing capture, or set to at least ${job.interval_seconds}s in the future</small>
                    <button class="btn btn-primary btn-sm" style="margin-top: 0.5rem;" onclick="updateJobEndTime(${job.id})">Update End Time</button>
                </div>

                <div class="form-group" style="margin-bottom: 1rem;">
                    <label>Stream URL</label>
                    <input type="text" id="edit_url" class="form-control" value="${escapeHtml(job.url)}">
                    <button class="btn btn-primary btn-sm" style="margin-top: 0.5rem;" onclick="updateJobUrl(${job.id})">Update URL</button>
                </div>
                
                <div class="form-group" style="margin-bottom: 1rem;">
                    <label>Capture Interval (seconds)</label>
                    <input type="number" id="edit_interval_seconds" class="form-control" value="${job.interval_seconds}" min="10">
                    <small style="color: var(--text-secondary);">Minimum 10 seconds</small>
                    <button class="btn btn-primary btn-sm" style="margin-top: 0.5rem;" onclick="updateJobInterval(${job.id})">Update Interval</button>
                </div>
                
                <div class="job-info" style="margin-bottom: 1.5rem;">
                    <div><strong>Captures:</strong> ${job.capture_count}</div>
                    <div><strong>Storage:</strong> ${formatBytes(job.storage_size)}</div>
                    <div><strong>Path:</strong> ${escapeHtml(job.capture_path)}</div>
                </div>
                
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: flex-end;">
                    <button class="btn btn-primary" onclick="event.stopPropagation(); closeModal('job-details-modal'); showProcessVideoModal(${job.id}, '${escapeHtml(job.name)}')">
                        Build Timelapse
                    </button>
                    ${job.status === 'active' ? 
                        `<button class="btn btn-secondary" onclick="updateJobStatus(${job.id}, 'disabled'); closeModal('job-details-modal')">Disable</button>` :
                        job.status === 'disabled' ?
                        `<button class="btn btn-secondary" onclick="updateJobStatus(${job.id}, 'active'); closeModal('job-details-modal')">Enable</button>` : ''
                    }
                    <button class="btn btn-danger" onclick="closeModal('job-details-modal'); deleteJob(${job.id}, '${escapeHtml(job.name)}')">
                        Delete
                    </button>
                </div>
            </div>
        `;
        
        showModal('job-details-modal');
    } catch (error) {
        console.error('Failed to load job details:', error);
        showNotification('Failed to load job details', 'error');
    }
}

async function createJob(event) {
    event.preventDefault();
    
    const url = document.getElementById('job_url').value;
    // Auto-detect stream type from URL
    const stream_type = url.toLowerCase().startsWith('rtsp://') ? 'rtsp' : 'http';
    
    const formData = {
        name: document.getElementById('job_name').value,
        url: url,
        stream_type: stream_type,
        start_datetime: document.getElementById('start_datetime').value,
        end_datetime: document.getElementById('end_datetime').value || null,
        interval_seconds: parseInt(document.getElementById('interval_seconds').value),
        framerate: parseInt(document.getElementById('framerate').value),
        capture_path: document.getElementById('capture_path').value || null,
        naming_pattern: document.getElementById('naming_pattern').value || null
    };
    
    try {
        const response = await fetch(`${API_BASE}/jobs/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });
        
        if (response.ok) {
            closeModal('create-job-modal');
            document.getElementById('create-job-form').reset();
            loadJobs();
            showNotification(`Job "${formData.name}" created successfully!`);
        } else {
            const error = await response.json();
            showNotification(`Failed to create job: ${error.detail || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        console.error('Failed to create job:', error);
        showNotification('Failed to create job', 'error');
    }
}

async function updateJobStatus(jobId, status) {
    try {
        const response = await fetch(`${API_BASE}/jobs/${jobId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        
        if (response.ok) {
            loadJobs();
            showNotification(`Job ${status === 'active' ? 'enabled' : 'disabled'} successfully`);
        } else {
            showNotification('Failed to update job status', 'error');
        }
    } catch (error) {
        console.error('Failed to update job:', error);
        showNotification('Failed to update job', 'error');
    }
}

async function updateJobEndTime(jobId) {
    const endDatetimeInput = document.getElementById('edit_end_datetime');
    const endDatetime = endDatetimeInput.value || null;
    
    // Validate end time if provided
    if (endDatetime) {
        const endTime = new Date(endDatetime);
        const now = new Date();
        
        if (endTime <= now) {
            showNotification('End time must be in the future', 'error');
            return;
        }
    }
    
    try {
        const response = await fetch(`${API_BASE}/jobs/${jobId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ end_datetime: endDatetime })
        });
        
        if (response.ok) {
            closeModal('job-details-modal');
            loadJobs();
            showNotification('End time updated successfully');
        } else {
            const error = await response.json();
            showNotification(error.detail || 'Failed to update end time', 'error');
        }
    } catch (error) {
        console.error('Failed to update end time:', error);
        showNotification('Failed to update end time', 'error');
    }
}

async function updateJobUrl(jobId) {
    const urlInput = document.getElementById('edit_url');
    const url = urlInput.value.trim();
    
    if (!url) {
        showNotification('URL cannot be empty', 'error');
        return;
    }
    
    // Auto-detect stream type from URL
    const stream_type = url.toLowerCase().startsWith('rtsp://') ? 'rtsp' : 'http';
    
    try {
        const response = await fetch(`${API_BASE}/jobs/${jobId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, stream_type })
        });
        
        if (response.ok) {
            showNotification('Stream URL updated successfully');
            // Refresh the modal to show updated info
            showJobDetails(jobId);
        } else {
            const error = await response.json();
            showNotification(error.detail || 'Failed to update URL', 'error');
        }
    } catch (error) {
        console.error('Failed to update URL:', error);
        showNotification('Failed to update URL', 'error');
    }
}

async function updateJobInterval(jobId) {
    const intervalInput = document.getElementById('edit_interval_seconds');
    const interval = parseInt(intervalInput.value);
    
    if (!interval || interval < 10) {
        showNotification('Interval must be at least 10 seconds', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/jobs/${jobId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ interval_seconds: interval })
        });
        
        if (response.ok) {
            showNotification('Capture interval updated successfully');
            // Refresh the modal to show updated info
            showJobDetails(jobId);
        } else {
            const error = await response.json();
            showNotification(error.detail || 'Failed to update interval', 'error');
        }
    } catch (error) {
        console.error('Failed to update interval:', error);
        showNotification('Failed to update interval', 'error');
    }
}

async function deleteJob(jobId, jobName) {
    showConfirm(
        `Are you sure you want to delete the job "${jobName}"?`,
        async (confirmed) => {
            if (!confirmed) return;
            
            const deleteCaptures = document.getElementById('delete-captures-checkbox').checked;
            
            try {
                const response = await fetch(`${API_BASE}/jobs/${jobId}?delete_captures=${deleteCaptures}`, {
                    method: 'DELETE'
                });
                
                if (response.ok) {
                    loadJobs();
                    if (deleteCaptures) {
                        showNotification(`Job "${jobName}" and all captures deleted successfully`);
                    } else {
                        showNotification(`Job "${jobName}" deleted successfully (captures preserved)`);
                    }
                } else {
                    showNotification(`Failed to delete job "${jobName}"`, 'error');
                }
            } catch (error) {
                console.error('Failed to delete job:', error);
                showNotification(`Failed to delete job "${jobName}"`, 'error');
            }
        },
        true  // Show checkbox option
    );
}

async function testUrl() {
    const url = document.getElementById('job_url').value;
    const resultDiv = document.getElementById('test-result');
    
    if (!url) {
        showNotification('Please enter a URL first', 'warning');
        return;
    }
    
    resultDiv.innerHTML = '<p style="color: #666;">Testing URL...</p>';
    resultDiv.className = 'test-result';
    
    try {
        const response = await fetch(`${API_BASE}/jobs/test-url?url=${encodeURIComponent(url)}`, {
            method: 'POST'
        });
        const result = await response.json();
        
        if (result.success) {
            resultDiv.className = 'test-result';
            resultDiv.innerHTML = `
                <img src="${result.image_data}" alt="Test capture" style="max-width: 100%; margin-top: 10px; border: 1px solid #ddd; border-radius: 4px;">
            `;
        } else {
            resultDiv.className = 'test-result error';
            resultDiv.innerHTML = `<p style="color: #e74c3c; margin-top: 10px;">✗ ${result.message}</p>`;
        }
    } catch (error) {
        resultDiv.className = 'test-result error';
        resultDiv.innerHTML = `<p style="color: #e74c3c; margin-top: 10px;">✗ Error: Please check the URL.</p>`;
    }
}

// Videos
async function loadVideos() {
    try {
        const response = await fetch(`${API_BASE}/videos/`);
        const videos = await response.json();
        renderVideos(videos);
    } catch (error) {
        console.error('Failed to load videos:', error);
    }
}

function renderVideos(videos) {
    const container = document.getElementById('videos-list');
    
    if (videos.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>No processed videos</h3>
                <p>Process a job to create your first timelapse video</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = videos.map(video => `
        <div class="video-card">
            <div class="video-card-header">
                <div class="video-card-title">${escapeHtml(video.name)}</div>
                <span class="job-status ${video.status}">${video.status}</span>
            </div>
            <div class="video-info">
                <div><strong>Resolution:</strong> ${video.resolution} | <strong>FPS:</strong> ${video.framerate}</div>
                <div><strong>Quality:</strong> ${video.quality}</div>
                <div><strong>Frames:</strong> ${video.total_frames} | <strong>Duration:</strong> ${formatDuration(video.duration_seconds)}</div>
                ${video.status === 'completed' ? `<div><strong>Size:</strong> ${formatBytes(video.file_size)}</div>` : ''}
                <div><strong>Created:</strong> ${formatDateTime(video.created_at)}</div>
            </div>
            ${video.status === 'processing' ? `
                <div class="video-progress">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${video.progress}%"></div>
                    </div>
                    <p style="font-size: 0.875rem; margin-top: 0.5rem; color: var(--text-secondary);">${Math.round(video.progress)}% complete</p>
                </div>
            ` : ''}
            <div class="video-actions">
                ${video.status === 'completed' ? `
                    <a href="${API_BASE}/videos/${video.id}/download" class="btn btn-primary btn-sm">Download</a>
                ` : ''}
                <button class="btn btn-danger btn-sm" onclick="deleteVideo(${video.id}, '${escapeHtml(video.name)}')">Delete</button>
            </div>
        </div>
    `).join('');
}

async function showProcessVideoModal(jobId, jobName) {
    try {
        // Fetch job data and capture time range (not all captures)
        const [job, timeRange] = await Promise.all([
            fetch(`${API_BASE}/jobs/${jobId}`).then(r => r.json()),
            fetch(`${API_BASE}/captures/job/${jobId}/time-range`).then(r => r.json())
        ]);
        
        const captureCount = timeRange.count;
        console.log(`Job ${jobId} (${jobName}): Found ${captureCount} captures`);
        
        // Set values
        document.getElementById('process_job_id').value = jobId;
        document.getElementById('video_name').value = `${jobName}_timelapse`;
        document.getElementById('video_framerate').value = job.framerate;
        
        // Update modal title
        document.querySelector('#process-video-modal .modal-header h3').textContent = `Build Timelapse - ${jobName}`;
        
        // Store capture count for duration calculation
        document.getElementById('video_framerate').setAttribute('data-capture-count', captureCount);
        console.log(`Set data-capture-count attribute to: ${captureCount}`);
        
        // Set time range inputs to first and last capture times
        if (captureCount > 0) {
            const startTimeInput = document.getElementById('start_time');
            const endTimeInput = document.getElementById('end_time');
            
            const firstTime = toLocalDateTimeString(timeRange.first_capture_time);
            const lastTime = toLocalDateTimeString(timeRange.last_capture_time);
            
            startTimeInput.value = firstTime;
            startTimeInput.min = firstTime;
            startTimeInput.max = lastTime;
            
            endTimeInput.value = lastTime;
            endTimeInput.min = firstTime;
            endTimeInput.max = lastTime;
            
            // Ensure inputs are disabled initially (since use_range is unchecked)
            startTimeInput.disabled = true;
            endTimeInput.disabled = true;
            
            // Store job ID for time range queries
            window.currentJobId = jobId;
            
            // Add debounced listeners to update duration when time range changes
            startTimeInput.addEventListener('change', debounce(updateVideoDurationEstimate, 500));
            endTimeInput.addEventListener('change', debounce(updateVideoDurationEstimate, 500));
        }
        
        // Reset the use_range checkbox
        document.getElementById('use_range').checked = false;
        document.getElementById('capture-range').style.display = 'none';
        
        // Calculate and display initial duration
        updateVideoDurationEstimate();
        
        showModal('process-video-modal');
    } catch (error) {
        console.error('Failed to load job data:', error);
        showNotification('Failed to load job data', 'error');
    }
}

function updateVideoDurationEstimate() {
    const framerate = parseInt(document.getElementById('video_framerate').value) || 30;
    const useRange = document.getElementById('use_range').checked;
    
    // If custom time range is selected, fetch count for that range
    if (useRange) {
        const startTimeInput = document.getElementById('start_time');
        const endTimeInput = document.getElementById('end_time');
        
        if (!startTimeInput.value || !endTimeInput.value || !window.currentJobId) return;
        
        // Convert input times to ISO strings for API query
        const startTimeStr = toISOStringForQuery(startTimeInput.value, false);
        const endTimeStr = toISOStringForQuery(endTimeInput.value, true);
        
        // Query the backend for capture count in this time range
        fetch(`${API_BASE}/captures/job/${window.currentJobId}/time-range?start_time=${encodeURIComponent(startTimeStr)}&end_time=${encodeURIComponent(endTimeStr)}`)
            .then(r => r.json())
            .then(data => {
                displayDurationEstimate(data.count, framerate);
            })
            .catch(error => {
                console.error('Failed to get capture count:', error);
            });
    } else {
        // Use full capture count from data attribute
        const captureCount = parseInt(document.getElementById('video_framerate').getAttribute('data-capture-count')) || 0;
        displayDurationEstimate(captureCount, framerate);
    }
}

function displayDurationEstimate(captureCount, framerate) {
    if (captureCount === 0) {
        const useRange = document.getElementById('use_range').checked;
        const message = useRange 
            ? '<p style="color: #dc3545; font-weight: 600;"><strong>Warning:</strong> No captures in selected time range!</p>'
            : '<p style="color: var(--text-secondary);">No captures available for this job yet.</p>';
        document.getElementById('video-duration-estimate').innerHTML = message;
        return;
    }
    
    const durationSeconds = captureCount / framerate;
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = Math.floor(durationSeconds % 60);
    
    document.getElementById('video-duration-estimate').innerHTML = `
        <p style="font-size: 0.875rem; color: var(--text-secondary);">${captureCount} captures at ${framerate} FPS</p>
        <p>${minutes}m ${seconds}s</p>
    `;
}

// Debounce helper function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function toggleCustomResolution() {
    const resolutionSelect = document.getElementById('video_resolution');
    const customResolutionDiv = document.getElementById('custom-resolution');
    const customWidth = document.getElementById('custom_width');
    const customHeight = document.getElementById('custom_height');
    
    if (resolutionSelect.value === 'custom') {
        customResolutionDiv.style.display = 'flex';
        customWidth.required = true;
        customHeight.required = true;
    } else {
        customResolutionDiv.style.display = 'none';
        customWidth.required = false;
        customHeight.required = false;
    }
}
async function processVideo(event) {
    event.preventDefault();
    
    const useRange = document.getElementById('use_range').checked;
    let resolution = document.getElementById('video_resolution').value;
    
    // Handle custom resolution
    if (resolution === 'custom') {
        const width = document.getElementById('custom_width').value;
        const height = document.getElementById('custom_height').value;
        resolution = `${width}x${height}`;
    }
    
    const formData = {
        job_id: parseInt(document.getElementById('process_job_id').value),
        name: document.getElementById('video_name').value,
        resolution: resolution,
        framerate: parseInt(document.getElementById('video_framerate').value),
        quality: document.getElementById('video_quality').value,
        start_time: useRange ? toISOStringForQuery(document.getElementById('start_time').value, false) : null,
        end_time: useRange ? toISOStringForQuery(document.getElementById('end_time').value, true) : null
    };
    
    try {
        const response = await fetch(`${API_BASE}/videos/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });
        
        if (response.ok) {
            closeModal('process-video-modal');
            document.getElementById('process-video-form').reset();
            switchView('videos');
            showNotification('Video processing started! Check the Videos tab for progress.');
        } else {
            const error = await response.json();
            showNotification(`Failed to start processing: ${error.detail || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        console.error('Failed to process video:', error);
        showNotification('Failed to start video processing', 'error');
    }
}

async function deleteVideo(videoId, videoName) {
    showConfirm(
        `Are you sure you want to delete "${videoName}"?`,
        async (confirmed) => {
            if (!confirmed) return;
            
            try {
                const response = await fetch(`${API_BASE}/videos/${videoId}`, {
                    method: 'DELETE'
                });
                
                if (response.ok) {
                    loadVideos();
                    showNotification(`Video "${videoName}" deleted successfully`);
                } else {
                    showNotification(`Failed to delete video "${videoName}"`, 'error');
                }
            } catch (error) {
                console.error('Failed to delete video:', error);
                showNotification(`Failed to delete video "${videoName}"`, 'error');
            }
        }
    );
}

// Settings
async function loadSettings() {
    try {
        const response = await fetch(`${API_BASE}/settings/`);
        const settings = await response.json();
        
        document.getElementById('default_captures_path').value = settings.default_captures_path;
        document.getElementById('default_videos_path').value = settings.default_videos_path;
        document.getElementById('default_capture_pattern').value = settings.default_capture_pattern;
        document.getElementById('default_video_pattern').value = settings.default_video_pattern;
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

async function saveSettings(event) {
    event.preventDefault();
    
    const formData = {
        default_captures_path: document.getElementById('default_captures_path').value,
        default_videos_path: document.getElementById('default_videos_path').value,
        default_capture_pattern: document.getElementById('default_capture_pattern').value,
        default_video_pattern: document.getElementById('default_video_pattern').value
    };
    
    try {
        const response = await fetch(`${API_BASE}/settings/`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });
        
        if (response.ok) {
            showNotification('Settings saved successfully!');
        } else {
            showNotification('Failed to save settings', 'error');
        }
    } catch (error) {
        console.error('Failed to save settings:', error);
        showNotification('Failed to save settings', 'error');
    }
}

// Modal management
function showModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
    
    // Clear form when closing create job modal
    if (modalId === 'create-job-modal') {
        document.getElementById('create-job-form').reset();
        document.getElementById('test-result').innerHTML = '';
        document.getElementById('duration-estimate').innerHTML = '';
    }
}

function showCreateJobModal() {
    // Set default start time to now
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('start_datetime').value = now.toISOString().slice(0, 16);
    
    showModal('create-job-modal');
    
    // Trigger initial duration estimate with default values
    setTimeout(() => {
        updateDurationEstimate();
    }, 100);
}

// Utility functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getImageUrl(filePath) {
    // Convert container file path to web URL
    // /mnt/captures/... -> /captures/...
    // /mnt/timelapses/... -> /videos/...
    if (!filePath) return '';
    return filePath.replace('/mnt/captures', '/captures').replace('/mnt/timelapses', '/videos');
}

function getStreamHost(url) {
    // Extract protocol and host/domain from URL (e.g., http://example.com:8080)
    // This removes the path, query params, and fragments
    try {
        const urlObj = new URL(url);
        return `${urlObj.protocol}//${urlObj.host}`;
    } catch (e) {
        // If URL parsing fails, return first 30 chars
        return url.length > 30 ? url.substring(0, 30) + '...' : url;
    }
}

function toLocalDateTimeString(isoString) {
    // Convert ISO datetime string to local datetime-local format (YYYY-MM-DDTHH:mm)
    if (!isoString) return '';
    const date = new Date(isoString);
    // Adjust for timezone offset to get local time
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
}

function toUTCString(localDateTimeString) {
    // Convert datetime-local format (YYYY-MM-DDTHH:mm) to ISO string format
    // Note: Backend stores in local time, not UTC, so we format as local ISO
    // Since datetime-local doesn't include seconds, we use :00 for start times
    // and :59 for end times to be more inclusive
    if (!localDateTimeString) return null;
    const date = new Date(localDateTimeString);
    // Format as ISO but without timezone info to match backend's datetime.now() format
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

function toISOStringForQuery(localDateTimeString, isEndTime) {
    // Convert datetime-local format to ISO string for database queries
    // For end times, add 59 seconds to include the entire minute
    if (!localDateTimeString) return null;
    const date = new Date(localDateTimeString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = isEndTime ? '59' : '00';  // Use 59 for end times to be inclusive
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatDateTime(isoString) {
    if (!isoString) return 'N/A';
    const date = new Date(isoString);
    return date.toLocaleString();
}

function formatDuration(seconds) {
    if (!seconds) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

async function updateDurationEstimate() {
    const startDate = document.getElementById('start_datetime').value;
    const endDate = document.getElementById('end_datetime').value;
    const interval = parseInt(document.getElementById('interval_seconds').value);
    const framerate = parseInt(document.getElementById('framerate').value) || 30;
    
    if (!startDate || !interval) return;
    
    const estimateDiv = document.getElementById('duration-estimate');
    
    if (endDate) {
        // Calculate for defined time range
        const start = new Date(startDate);
        const end = new Date(endDate);
        const durationSeconds = (end - start) / 1000;
        const captures = Math.floor(durationSeconds / interval);
        
        estimateDiv.innerHTML = `
            <h4>Estimated Video Duration</h4>
            <div class="duration-grid">
                <div class="duration-item">
                    <div class="duration-fps">${captures} captures @ ${framerate} FPS</div>
                    <div class="duration-time">${formatDuration(captures / framerate)}</div>
                </div>
            </div>
        `;
    } else {
        // Show estimates for common durations in horizontal table format
        const durations = [
            { label: '1 Hour', seconds: 3600 },
            { label: '1 Day', seconds: 86400 },
            { label: '1 Week', seconds: 604800 },
            { label: '1 Month', seconds: 2592000 }
        ];
        
        estimateDiv.innerHTML = `<h4>Estimated Video Duration @ ${framerate} FPS (Ongoing Job)</h4>`;
        
        durations.forEach(dur => {
            const captures = Math.floor(dur.seconds / interval);
            estimateDiv.innerHTML += `
                <div class="duration-row">
                    <strong>${dur.label}</strong>
                    <div class="duration-table">
                        <div class="duration-item">
                            <div class="duration-fps">Captures</div>
                            <div class="duration-time">${captures.toLocaleString()}</div>
                        </div>
                        <div class="duration-item">
                            <div class="duration-fps">Duration</div>
                            <div class="duration-time">${formatDuration(captures / framerate)}</div>
                        </div>
                    </div>
                </div>
            `;
        });
    }
}

// Trigger initial estimate
document.getElementById('start_datetime')?.addEventListener('change', updateDurationEstimate);
document.getElementById('end_datetime')?.addEventListener('change', updateDurationEstimate);
document.getElementById('framerate')?.addEventListener('change', updateDurationEstimate);

// Close modals on outside click
window.onclick = function(event) {
    if (event.target.classList.contains('modal') && event.target.id !== 'confirm-modal') {
        event.target.classList.remove('active');
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    refreshIntervals.forEach(interval => clearInterval(interval));
});
