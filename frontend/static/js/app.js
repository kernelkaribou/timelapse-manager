// API Base URL
const API_BASE = '/api';

// Current state
let currentView = 'jobs';
let currentJobId = null;
let refreshIntervals = [];
let videoRefreshInterval = null;
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

// Toggle time window fields visibility
function toggleTimeWindow() {
    const enabled = document.getElementById('time_window_enabled').checked;
    const fieldsDiv = document.getElementById('time-window-fields');
    const startInput = document.getElementById('time_window_start');
    const endInput = document.getElementById('time_window_end');
    
    if (enabled) {
        fieldsDiv.style.display = 'block';
        startInput.required = true;
        endInput.required = true;
        
        // Add event listeners for duration estimate updates
        startInput.addEventListener('change', updateDurationEstimate);
        endInput.addEventListener('change', updateDurationEstimate);
    } else {
        fieldsDiv.style.display = 'none';
        startInput.required = false;
        endInput.required = false;
    }
    
    // Update duration estimate
    updateDurationEstimate();
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    loadJobs();
    
    // Setup refresh intervals
    refreshIntervals.push(setInterval(loadJobs, 10000)); // Refresh jobs every 10s
    
    // Setup event listeners for job creation form
    const startInput = document.getElementById('start_datetime');
    const intervalInput = document.getElementById('interval_seconds');
    
    if (startInput) {
        startInput.addEventListener('change', updateEndDateMin);
    }
    if (intervalInput) {
        intervalInput.addEventListener('change', updateEndDateMin);
    }
    
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
            const view = e.currentTarget.dataset.view;
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
            ? `<div class="job-thumbnail" style="background-image: url('${API_BASE}/captures/${job.latest_capture.id}/image'); background-size: cover; background-position: center; height: 120px; border-radius: 0.5rem; margin-bottom: 1rem;"></div>`
            : `<div class="job-thumbnail" style="background: var(--border-color); height: 120px; border-radius: 0.5rem; margin-bottom: 1rem; display: flex; align-items: center; justify-content: center; color: var(--text-secondary);">No captures yet</div>`;
        
        // Determine status display
        let statusLabel, statusClass;
        if (job.warning_message) {
            statusLabel = '⚠ Warning';
            statusClass = 'warning';
        } else if (job.status === 'sleeping') {
            statusLabel = 'Sleeping';
            statusClass = 'sleeping';
        } else if (job.status === 'disabled') {
            statusLabel = '⏸ Disabled';
            statusClass = 'disabled';
        } else {
            statusLabel = job.status.charAt(0).toUpperCase() + job.status.slice(1);
            statusClass = job.status;
        }
        
        // Build time window info
        let timeWindowInfo = '';
        if (job.time_window_enabled) {
            timeWindowInfo = `<div><strong>Time Window:</strong> ${job.time_window_start} - ${job.time_window_end}</div>`;
        }
        
        // Last capture info
        let lastCaptureInfo = '';
        if (job.latest_capture && job.latest_capture.captured_at) {
            lastCaptureInfo = `<div><strong>Last Capture:</strong> ${formatDateTime(job.latest_capture.captured_at)}</div>`;
        } else if (job.capture_count === 0) {
            lastCaptureInfo = `<div><strong>Last Capture:</strong> No captures yet</div>`;
        }
        
        // Next capture info
        let nextCaptureInfo = '';
        // Use next_scheduled_capture_at from scheduler (schedule-based) if available, fallback to next_capture_at
        const nextCapture = job.next_scheduled_capture_at || job.next_capture_at;
        if (nextCapture && job.status !== 'disabled' && job.status !== 'completed') {
            nextCaptureInfo = `<div><strong>Next Capture:</strong> ${formatDateTime(nextCapture)}</div>`;
        }
        
        return `
        <div class="job-card" onclick="showJobDetails(${job.id})">
            ${thumbnailHtml}
            <div class="job-card-header">
                <div class="job-card-title">${escapeHtml(job.name)}</div>
                <span class="job-status ${statusClass}">
                    ${statusLabel}
                </span>
            </div>
            <div class="job-info">
                <div><strong>Stream URL:</strong> <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; max-width: 250px; vertical-align: bottom;">${escapeHtml(getStreamHost(job.url))}</span></div>
                <div><strong>Interval:</strong> ${job.interval_seconds}s</div>
                ${timeWindowInfo}
                ${job.start_datetime ? `<div><strong>Start:</strong> ${formatDateTimeNoSeconds(job.start_datetime)}</div>` : ''}
                ${job.end_datetime ? `<div><strong>End:</strong> ${formatDateTimeNoSeconds(job.end_datetime)}</div>` : '<div><strong>Ongoing capture</strong></div>'}
                ${lastCaptureInfo}
                ${nextCaptureInfo}
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
        const title = document.getElementById('job-details-title');
        
        // Update modal title with job name
        title.textContent = `${job.name} - Details`;
        
        let latestImageHtml = '';
        if (captures.length > 0) {
            latestImageHtml = `
                <div style="margin: 1.5rem 0;">
                    <img src="${API_BASE}/captures/${captures[0].id}/image" alt="Latest capture" style="max-width: 100%; border-radius: 0.5rem; border: 1px solid var(--border-color);">
                </div>
            `;
        }
        
        // End datetime will be set by initializeEditTimePickers if present
        
        // Determine status display
        let statusLabel, statusClass;
        if (job.warning_message) {
            statusLabel = 'Warning';
            statusClass = 'warning';
        } else if (job.status === 'sleeping') {
            statusLabel = 'Sleeping (Outside Time Window)';
            statusClass = 'sleeping';
        } else if (job.status === 'disabled') {
            statusLabel = 'Disabled';
            statusClass = 'disabled';
        } else {
            statusLabel = job.status.charAt(0).toUpperCase() + job.status.slice(1);
            statusClass = job.status;
        }
        
        // Time window info
        let timeWindowHtml = '';
        if (job.time_window_enabled) {
            timeWindowHtml = `
                <div style="margin: 1rem 0; padding: 1rem; background: #e3f2fd; color: #1565c0; border-radius: 0.5rem; border-left: 4px solid #2196f3;">
                    <div style="display: flex; align-items: start; gap: 0.5rem;">
                        <div>
                            <strong>Time Window Enabled</strong>
                            <p style="margin-top: 0.25rem; font-size: 0.875rem;">Captures only happen between <strong>${job.time_window_start}</strong> and <strong>${job.time_window_end}</strong> each day.</p>
                            ${job.time_window_start > job.time_window_end ? '<p style="margin-top: 0.25rem; font-size: 0.75rem; opacity: 0.8;">⏰ This window spans midnight (e.g., captures from evening to early morning)</p>' : ''}
                        </div>
                    </div>
                </div>
            `;
        }
        
        // Last capture info
        let lastCaptureHtml = '';
        if (captures.length > 0) {
            lastCaptureHtml = `<div><strong>Last Capture:</strong> ${formatDateTime(captures[0].captured_at)}</div>`;
        } else {
            lastCaptureHtml = `<div><strong>Last Capture:</strong> No captures yet</div>`;
        }
        
        // Next capture info
        let nextCaptureHtml = '';
        // Use next_scheduled_capture_at from scheduler (schedule-based) if available, fallback to next_capture_at
        const nextCapture = job.next_scheduled_capture_at || job.next_capture_at;
        if (nextCapture && job.status !== 'disabled' && job.status !== 'completed') {
            nextCaptureHtml = `<div><strong>Next Capture:</strong> ${formatDateTime(nextCapture)}</div>`;
        }
        
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
                
                ${timeWindowHtml}
                
                <div class="job-info" style="margin-bottom: 1rem;">
                    <div><strong>Status:</strong> <span class="job-status ${statusClass}">${statusLabel}</span></div>
                    <div><strong>Start:</strong> ${formatDateTimeNoSeconds(job.start_datetime)}</div>
                    ${lastCaptureHtml}
                    ${nextCaptureHtml}
                </div>
                
                <div class="job-info" style="margin-bottom: 1.5rem; padding-top: 0.5rem; border-top: 1px solid var(--border-color);">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <strong>Captures:</strong> ${job.capture_count}
                        <button class="btn-icon" onclick="event.stopPropagation(); closeModal('job-details-modal'); startMaintenance(${job.id}, '${escapeHtml(job.name)}')" title="Maintenance" style="padding: 0.25rem;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
                            </svg>
                        </button>
                    </div>
                    <div><strong>Storage:</strong> ${formatBytes(job.storage_size)}</div>
                    <div><strong>Path:</strong> ${escapeHtml(job.capture_path)}</div>
                </div>

                <h4 style="margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 2px solid var(--border-color);">Job Settings</h4>

                <div class="form-group" style="margin-bottom: 1rem;">
                    <label>Capture Interval (seconds) *</label>
                    <input type="number" id="edit_interval_seconds" class="form-control" value="${job.interval_seconds}" min="10" required>
                    <small style="color: var(--text-secondary);">Minimum 10 seconds</small>
                </div>
                
                <div class="form-group" style="margin-bottom: 1rem;">
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; margin-bottom: 0.5rem;">
                        <input type="checkbox" id="edit_time_window_enabled" ${job.time_window_enabled ? 'checked' : ''} style="cursor: pointer;" onchange="toggleEditTimeWindow()">
                        <span><strong>Enable Daily Time Window</strong></span>
                    </label>
                    <small style="color: var(--text-secondary); display: block; margin-left: 1.5rem;">Restrict captures to specific hours each day</small>
                </div>
                
                <div id="edit-time-window-fields" style="display: ${job.time_window_enabled ? 'block' : 'none'}; margin-bottom: 1rem; margin-left: 1.5rem;">
                    <div style="display: flex; gap: 1rem;">
                        <div style="flex: 1;">
                            <label>Window Start Time</label>
                            <div class="time-picker-container">
                                <select id="edit_time_window_start_hour" class="form-control">
                                    <option value="">HH</option>
                                </select>
                                <span class="separator">:</span>
                                <select id="edit_time_window_start_minute" class="form-control">
                                    <option value="">MM</option>
                                </select>
                            </div>
                            <input type="hidden" id="edit_time_window_start">
                            <small style="color: var(--text-secondary); font-size: 0.75rem;">24-hour format</small>
                        </div>
                        <div style="flex: 1;">
                            <label>Window End Time</label>
                            <div class="time-picker-container">
                                <select id="edit_time_window_end_hour" class="form-control">
                                    <option value="">HH</option>
                                </select>
                                <span class="separator">:</span>
                                <select id="edit_time_window_end_minute" class="form-control">
                                    <option value="">MM</option>
                                </select>
                            </div>
                            <input type="hidden" id="edit_time_window_end">
                            <small style="color: var(--text-secondary); font-size: 0.75rem;">24-hour format</small>
                        </div>
                    </div>
                    <small style="color: var(--text-secondary); display: block; margin-top: 0.5rem;">Can span midnight (e.g., 22:00 to 02:00)</small>
                </div>

                <div class="form-group" style="margin-bottom: 1rem;">
                    <label>End Date & Time</label>
                    <div class="datetime-picker-container">
                        <input type="date" id="edit_end_date" class="form-control">
                        <div class="time-part">
                            <select id="edit_end_hour" class="form-control">
                                <option value="">HH</option>
                            </select>
                            <span class="separator">:</span>
                            <select id="edit_end_minute" class="form-control">
                                <option value="">MM</option>
                            </select>
                        </div>
                    </div>
                    <input type="hidden" id="edit_end_datetime">
                    <small style="color: var(--text-secondary);">Leave empty for ongoing capture (24-hour format)</small>
                </div>

                <div class="form-group" style="margin-bottom: 1.5rem;">
                    <label>Stream URL *</label>
                    <input type="text" id="edit_url" class="form-control" value="${escapeHtml(job.url)}" required>
                    <small style="color: var(--text-secondary);">HTTP or RTSP stream URL</small>
                </div>
                
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: space-between; align-items: center; padding-top: 1rem; border-top: 2px solid var(--border-color);">
                    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
                        <button class="btn btn-primary" onclick="event.stopPropagation(); closeModal('job-details-modal'); showProcessVideoModal(${job.id}, '${escapeHtml(job.name)}')">
                            Build Timelapse
                        </button>
                        ${job.status !== 'completed' ? 
                            `<button class="btn btn-secondary" onclick="confirmCompleteJob(${job.id}, '${escapeHtml(job.name)}')">Complete</button>` : ''
                        }
                        ${job.status === 'active' || job.status === 'sleeping' ? 
                            `<button class="btn btn-warning" onclick="confirmDisableJob(${job.id}, '${escapeHtml(job.name)}')">Disable</button>` :
                            job.status === 'disabled' ?
                            `<button class="btn btn-success" onclick="confirmEnableJob(${job.id}, '${escapeHtml(job.name)}')">Enable</button>` : ''
                        }
                        <button class="btn-icon" onclick="closeModal('job-details-modal'); deleteJob(${job.id}, '${escapeHtml(job.name)}')" title="Delete Job" style="padding: 0.5rem;">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                <line x1="14" y1="11" x2="14" y2="17"></line>
                            </svg>
                        </button>
                    </div>
                    <button id="save-job-btn" class="btn btn-purple" onclick="saveJobChanges(${job.id})" style="font-weight: 600;" disabled>
                        Save
                    </button>
                </div>
            </div>
        `;
        
        showModal('job-details-modal');
        
        // Initialize custom time pickers for edit modal
        initializeEditTimePickers(job);
        
        // Track changes to enable/disable save button
        setupJobEditChangeTracking(job);
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
    
    const startDatetime = document.getElementById('start_datetime').value;
    const endDatetime = document.getElementById('end_datetime').value || null;
    const intervalSeconds = parseInt(document.getElementById('interval_seconds').value);
    
    // Validate dates
    const startDate = new Date(startDatetime);
    
    if (endDatetime) {
        const endDate = new Date(endDatetime);
        const now = new Date();
        
        if (endDate <= startDate) {
            showNotification('End date must be after start date', 'error');
            return;
        }
        
        if (endDate < now) {
            showNotification('End date cannot be in the past', 'error');
            return;
        }
        
        const minEnd = new Date(startDate.getTime() + intervalSeconds * 1000);
        if (endDate < minEnd) {
            showNotification(`End date must be at least ${intervalSeconds} seconds after start date`, 'error');
            return;
        }
    }
    
    const formData = {
        name: document.getElementById('job_name').value,
        url: url,
        stream_type: stream_type,
        start_datetime: startDatetime,
        end_datetime: endDatetime,
        interval_seconds: intervalSeconds,
        framerate: parseInt(document.getElementById('framerate').value),
        capture_path: document.getElementById('capture_path').value || null,
        naming_pattern: document.getElementById('naming_pattern').value || null,
        time_window_enabled: document.getElementById('time_window_enabled').checked,
        time_window_start: document.getElementById('time_window_enabled').checked ? document.getElementById('time_window_start').value : null,
        time_window_end: document.getElementById('time_window_enabled').checked ? document.getElementById('time_window_end').value : null
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

function setupJobEditChangeTracking(originalJob) {
    const saveBtn = document.getElementById('save-job-btn');
    if (!saveBtn) return;
    
    // Initially disabled
    saveBtn.disabled = true;
    saveBtn.style.opacity = '0.5';
    saveBtn.style.cursor = 'not-allowed';
    
    const enableSaveButton = () => {
        saveBtn.disabled = false;
        saveBtn.style.opacity = '1';
        saveBtn.style.cursor = 'pointer';
    };
    
    // Track changes on all editable fields
    const fields = [
        'edit_interval_seconds',
        'edit_framerate',
        'edit_end_date',
        'edit_end_hour',
        'edit_end_minute',
        'edit_time_window_enabled',
        'edit_time_window_start_hour',
        'edit_time_window_start_minute',
        'edit_time_window_end_hour',
        'edit_time_window_end_minute',
        'edit_url',
        'edit_stream_type'
    ];
    
    fields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.addEventListener('change', enableSaveButton);
            field.addEventListener('input', enableSaveButton);
        }
    });
}

function confirmDisableJob(jobId, jobName) {
    showConfirm(
        `Are you sure you want to disable the job "${jobName}"? The job will stop capturing images until re-enabled.`,
        async (confirmed) => {
            if (confirmed) {
                closeModal('job-details-modal');
                await updateJobStatus(jobId, 'disabled', jobName);
            }
        }
    );
}

function confirmEnableJob(jobId, jobName) {
    showConfirm(
        `Are you sure you want to enable the job "${jobName}"? The job will start capturing images according to its schedule.`,
        async (confirmed) => {
            if (confirmed) {
                closeModal('job-details-modal');
                await updateJobStatus(jobId, 'active', jobName);
            }
        }
    );
}

function confirmCompleteJob(jobId, jobName) {
    showConfirm(
        `Are you sure you want to complete the job "${jobName}"? This will set the job's end time to now and mark it as completed.`,
        async (confirmed) => {
            if (confirmed) {
                closeModal('job-details-modal');
                await completeJob(jobId, jobName);
            }
        }
    );
}

async function completeJob(jobId, jobName) {
    try {
        const now = new Date();
        const endDatetime = now.toISOString();
        
        const response = await fetch(`${API_BASE}/jobs/${jobId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                status: 'completed',
                end_datetime: endDatetime
            })
        });
        
        if (response.ok) {
            loadJobs();
            showNotification(`Job "${jobName}" completed successfully`);
        } else {
            showNotification('Failed to complete job', 'error');
        }
    } catch (error) {
        console.error('Failed to complete job:', error);
        showNotification('Failed to complete job', 'error');
    }
}

async function updateJobStatus(jobId, status, jobName) {
    try {
        const response = await fetch(`${API_BASE}/jobs/${jobId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        
        if (response.ok) {
            loadJobs();
            const action = status === 'active' ? 'enabled' : 'disabled';
            showNotification(`Job "${jobName}" ${action} successfully`);
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

function toggleEditTimeWindow() {
    const enabled = document.getElementById('edit_time_window_enabled').checked;
    const fieldsDiv = document.getElementById('edit-time-window-fields');
    const startInput = document.getElementById('edit_time_window_start');
    const endInput = document.getElementById('edit_time_window_end');
    
    if (enabled) {
        fieldsDiv.style.display = 'block';
        startInput.required = true;
        endInput.required = true;
    } else {
        fieldsDiv.style.display = 'none';
        startInput.required = false;
        endInput.required = false;
    }
}

async function saveJobChanges(jobId) {
    // Collect all form values
    const interval = parseInt(document.getElementById('edit_interval_seconds').value);
    const url = document.getElementById('edit_url').value.trim();
    const endDatetime = document.getElementById('edit_end_datetime').value || null;
    const timeWindowEnabled = document.getElementById('edit_time_window_enabled').checked;
    const timeWindowStart = document.getElementById('edit_time_window_start').value;
    const timeWindowEnd = document.getElementById('edit_time_window_end').value;
    
    // Validate required fields
    if (!url) {
        showNotification('URL cannot be empty', 'error');
        return;
    }
    
    if (!interval || interval < 10) {
        showNotification('Interval must be at least 10 seconds', 'error');
        return;
    }
    
    // Validate time window if enabled
    if (timeWindowEnabled && (!timeWindowStart || !timeWindowEnd)) {
        showNotification('Both start and end times are required when time window is enabled', 'error');
        return;
    }
    
    // Validate end time if provided
    if (endDatetime) {
        const endTime = new Date(endDatetime);
        const now = new Date();
        
        if (endTime <= now) {
            showNotification('End time must be in the future', 'error');
            return;
        }
        
        // Check if end time is at least one interval in the future
        const minEndTime = new Date(now.getTime() + interval * 1000);
        if (endTime < minEndTime) {
            showNotification(`End time must be at least ${interval} seconds in the future`, 'error');
            return;
        }
    }
    
    // Auto-detect stream type from URL
    const stream_type = url.toLowerCase().startsWith('rtsp://') ? 'rtsp' : 'http';
    
    // Build update payload
    const updateData = {
        interval_seconds: interval,
        url: url,
        stream_type: stream_type,
        end_datetime: endDatetime,
        time_window_enabled: timeWindowEnabled,
        time_window_start: timeWindowEnabled ? timeWindowStart : null,
        time_window_end: timeWindowEnabled ? timeWindowEnd : null
    };
    
    try {
        const response = await fetch(`${API_BASE}/jobs/${jobId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
        });
        
        if (response.ok) {
            // Reload jobs BEFORE closing modal to prevent showing stale data
            await loadJobs();
            closeModal('job-details-modal');
            showNotification('Job settings updated successfully');
        } else {
            const error = await response.json();
            showNotification(error.detail || 'Failed to update job', 'error');
        }
    } catch (error) {
        console.error('Failed to update job:', error);
        showNotification('Failed to update job', 'error');
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
            resultDiv.innerHTML = `<p style="color: #e74c3c; margin-top: 10px;">${result.message}</p>`;
        }
    } catch (error) {
        resultDiv.className = 'test-result error';
        resultDiv.innerHTML = `<p style="color: #e74c3c; margin-top: 10px;">Error: Please check the URL.</p>`;
    }
}

// Videos
async function loadVideos() {
    try {
        const response = await fetch(`${API_BASE}/videos/`);
        const videos = await response.json();
        
        // Check if any videos are processing
        const hasProcessing = videos.some(v => v.status === 'processing');
        
        // Start refresh interval if there are processing videos
        if (hasProcessing && !videoRefreshInterval) {
            videoRefreshInterval = setInterval(loadVideos, 5000);
        }
        // Stop refresh interval if no processing videos
        else if (!hasProcessing && videoRefreshInterval) {
            clearInterval(videoRefreshInterval);
            videoRefreshInterval = null;
        }
        
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
            <div class="video-card-content">
                <div class="video-card-main">
                    <div class="video-card-header">
                        <div class="video-card-title">${escapeHtml(video.name)}</div>
                        <span class="job-status ${video.status}">${video.status}</span>
                    </div>
                    <div class="video-info">
                        ${video.job_name ? 
                            `<div><strong>Job:</strong> <a href="#" class="job-link" onclick="event.preventDefault(); navigateToJob(${video.job_id})">${escapeHtml(video.job_name)}</a></div>` : 
                            `<div><strong>Job:</strong> <span class="text-muted">Unknown (removed)</span></div>`
                        }
                        <div><strong>Resolution:</strong> ${video.resolution} | <strong>FPS:</strong> ${video.framerate}</div>
                        <div><strong>Quality:</strong> ${video.quality}</div>
                        <div><strong>Frames:</strong> ${video.total_frames} | <strong>Duration:</strong> ${formatDuration(video.duration_seconds)}</div>
                        ${video.status === 'completed' ? `<div><strong>Size:</strong> ${formatBytes(video.file_size)}</div>` : ''}
                        ${video.start_time ? `<div><strong>Start:</strong> ${formatDateTimeNoSeconds(video.start_time)}</div>` : ''}
                        ${video.end_time ? `<div><strong>End:</strong> ${formatDateTimeNoSeconds(video.end_time)}</div>` : ''}
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
                            <a href="${API_BASE}/videos/${video.id}/download" class="btn btn-primary btn-sm" onclick="return handleVideoDownload(event, ${video.id})">Download</a>
                        ` : ''}
                        <button class="btn btn-danger btn-sm" onclick="deleteVideo(${video.id}, '${escapeHtml(video.name)}')">Delete</button>
                    </div>
                </div>
                ${video.status === 'completed' ? `
                    <div class="video-preview" id="preview-${video.id}" data-video-id="${video.id}">
                        <video class="video-thumbnail" preload="metadata" muted playsinline onerror="handleVideoError(${video.id})">
                            <source src="${API_BASE}/videos/${video.id}/download#t=0.1" type="video/mp4">
                        </video>
                        <div class="play-overlay" onclick="playVideo(${video.id}, '${escapeHtml(video.name)}')">
                            <svg class="play-icon" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8 5v14l11-7z"/>
                            </svg>
                        </div>
                    </div>
                ` : ''}
            </div>
        </div>
    `).join('');
    
    // Check file accessibility for completed videos
    videos.filter(v => v.status === 'completed').forEach(video => {
        checkVideoAccessibility(video.id);
    });
}

async function checkVideoAccessibility(videoId) {
    try {
        const response = await fetch(`${API_BASE}/videos/${videoId}/check`);
        const result = await response.json();
        
        if (!result.accessible) {
            handleVideoError(videoId, result.reason);
        }
    } catch (error) {
        console.error(`Failed to check video ${videoId} accessibility:`, error);
    }
}

function handleVideoError(videoId, reason = 'Video file not found or not accessible') {
    const preview = document.getElementById(`preview-${videoId}`);
    if (preview) {
        preview.innerHTML = `
            <div class="video-error" title="${escapeHtml(reason)}">
                <svg class="error-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
                <p style="font-size: 0.75rem; margin-top: 0.5rem; color: var(--text-secondary);">File Not Found</p>
            </div>
        `;
        preview.style.cursor = 'default';
        preview.onclick = null;
    }
}

function handleVideoDownload(event, videoId) {
    // Let the browser handle the download naturally
    // The backend will return appropriate error if file doesn't exist
    return true;
}

async function showProcessVideoModal(jobId, jobName) {
    try {
        // Fetch job data and capture time range
        const [job, timeRange] = await Promise.all([
            fetch(`${API_BASE}/jobs/${jobId}`).then(r => r.json()),
            fetch(`${API_BASE}/captures/job/${jobId}/time-range`).then(r => r.json())
        ]);
        
        const captureCount = timeRange.count;
        
        // Generate timestamp in the same format as backend (YYYYMMDD_HHMMSS)
        const now = new Date();
        const timestamp = now.getFullYear() +
            String(now.getMonth() + 1).padStart(2, '0') +
            String(now.getDate()).padStart(2, '0') + '_' +
            String(now.getHours()).padStart(2, '0') +
            String(now.getMinutes()).padStart(2, '0') +
            String(now.getSeconds()).padStart(2, '0');
        
        // Set values
        document.getElementById('process_job_id').value = jobId;
        document.getElementById('video_name').value = `${jobName}_${timestamp}`;
        document.getElementById('video_framerate').value = job.framerate;
        document.getElementById('video_output_path').value = '/timelapses';
        
        // Update modal title
        document.querySelector('#process-video-modal .modal-header h3').textContent = `Build Timelapse - ${jobName}`;
        
        // Store capture count for duration calculation
        document.getElementById('video_framerate').setAttribute('data-capture-count', captureCount);
        
        // Set time range inputs to first and last capture times
        if (captureCount > 0) {
            // Parse ISO timestamps and set date/time pickers
            const firstDate = new Date(timeRange.first_capture_time);
            const lastDate = new Date(timeRange.last_capture_time);
            
            // Set start time
            const startDateInput = document.getElementById('video_start_date');
            const startHourSelect = document.getElementById('video_start_hour');
            const startMinuteSelect = document.getElementById('video_start_minute');
            
            if (startDateInput) startDateInput.value = firstDate.toISOString().split('T')[0];
            if (startHourSelect) startHourSelect.value = String(firstDate.getHours()).padStart(2, '0');
            if (startMinuteSelect) startMinuteSelect.value = String(firstDate.getMinutes()).padStart(2, '0');
            
            // Set end time
            const endDateInput = document.getElementById('video_end_date');
            const endHourSelect = document.getElementById('video_end_hour');
            const endMinuteSelect = document.getElementById('video_end_minute');
            
            if (endDateInput) endDateInput.value = lastDate.toISOString().split('T')[0];
            if (endHourSelect) endHourSelect.value = String(lastDate.getHours()).padStart(2, '0');
            if (endMinuteSelect) endMinuteSelect.value = String(lastDate.getMinutes()).padStart(2, '0');
            
            // Trigger sync to update hidden inputs
            if (startDateInput) startDateInput.dispatchEvent(new Event('change'));
            if (endDateInput) endDateInput.dispatchEvent(new Event('change'));
            
            // Store job ID for time range queries
            window.currentJobId = jobId;
            
            // Set up event listener for duration updates when time range changes
            // Use a named function so we can add it once
            const updateDuration = debounce(updateVideoDurationEstimate, 300);
            
            // Store reference to clean up later
            window._videoModalListeners = {
                startTime: () => updateDuration(),
                endTime: () => updateDuration()
            };
            
            const startTimeHidden = document.getElementById('start_time');
            const endTimeHidden = document.getElementById('end_time');
            if (startTimeHidden) startTimeHidden.addEventListener('change', window._videoModalListeners.startTime);
            if (endTimeHidden) endTimeHidden.addEventListener('change', window._videoModalListeners.endTime);
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
    const createBtn = document.getElementById('create-video-btn');
    
    if (captureCount === 0) {
        const useRange = document.getElementById('use_range').checked;
        const message = useRange 
            ? '<p style="color: #dc3545; font-weight: 600;"><strong>Warning:</strong> No captures in selected time range!</p>'
            : '<p style="color: var(--text-secondary);">No captures available for this job yet.</p>';
        document.getElementById('video-duration-estimate').innerHTML = message;
        
        // Disable create button when no captures
        if (createBtn) {
            createBtn.disabled = true;
            createBtn.style.opacity = '0.5';
            createBtn.style.cursor = 'not-allowed';
        }
        return;
    }
    
    // Enable create button when captures exist
    if (createBtn) {
        createBtn.disabled = false;
        createBtn.style.opacity = '1';
        createBtn.style.cursor = 'pointer';
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
        output_path: document.getElementById('video_output_path').value.trim() || null,
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
            showNotification('Video processing started');
        } else {
            const error = await response.json();
            showNotification(`Failed to start processing: ${error.detail || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        console.error('Failed to process video:', error);
        showNotification('Failed to start video processing', 'error');
    }
}

function playVideo(videoId, videoName) {
    const modal = document.getElementById('video-player-modal');
    const video = document.getElementById('video-player');
    const source = document.getElementById('video-source');
    const title = document.getElementById('video-player-title');
    
    title.textContent = videoName;
    source.src = `${API_BASE}/videos/${videoId}/download`;
    video.load();
    
    modal.classList.add('active');
    video.play();
}

function closeVideoPlayer() {
    const modal = document.getElementById('video-player-modal');
    const video = document.getElementById('video-player');
    
    video.pause();
    video.currentTime = 0;
    modal.classList.remove('active');
}

function navigateToJob(jobId) {
    // Switch to jobs view
    switchView('jobs');
    // Open job details modal
    setTimeout(() => showJobDetails(jobId), 100);
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
    
    // Clean up video modal listeners to prevent memory leaks
    if (modalId === 'process-video-modal' && window._videoModalListeners) {
        const startTimeHidden = document.getElementById('start_time');
        const endTimeHidden = document.getElementById('end_time');
        if (startTimeHidden && window._videoModalListeners.startTime) {
            startTimeHidden.removeEventListener('change', window._videoModalListeners.startTime);
        }
        if (endTimeHidden && window._videoModalListeners.endTime) {
            endTimeHidden.removeEventListener('change', window._videoModalListeners.endTime);
        }
        window._videoModalListeners = null;
    }
}

function showCreateJobModal() {
    // Default values are set by setDefaultStartTime() which is called on page load
    // Custom datetime pickers handle date/hour/minute separately
    
    const intervalInput = document.getElementById('interval_seconds');
    
    // Set default values for capture path and naming pattern
    document.getElementById('capture_path').value = '/captures';
    document.getElementById('naming_pattern').value = '{job_name}_{num:06d}_{timestamp}';
    
    // Set initial min for end date
    updateEndDateMin();
    
    showModal('create-job-modal');
    
    // Trigger initial duration estimate with default values
    setTimeout(() => {
        updateDurationEstimate();
    }, 100);
}

// Update minimum end date based on start date and interval
function updateEndDateMin() {
    const startInput = document.getElementById('start_datetime');
    const endInput = document.getElementById('end_datetime');
    const intervalInput = document.getElementById('interval_seconds');
    
    if (startInput && startInput.value && intervalInput) {
        const intervalSeconds = parseInt(intervalInput.value) || 60;
        // Min validation is handled by validation logic in createJob()
    }
}

// Utility functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

// ===== DateTime Utility Functions =====
// 
// TIMEZONE APPROACH:
// - Backend stores datetimes in ISO format with timezone (e.g., "2025-12-22T14:30:00-06:00")
// - Frontend custom pickers work in user's local browser time
// - When sending to backend: browser Date objects automatically include timezone
// - When displaying from backend: formatDateTime() parses ISO string and displays in browser's local time
// - This ensures timestamps are always shown in the user's local time while maintaining timezone info
//
// DATETIME FORMAT:
// - Always use 24-hour format for display (00:00 - 23:59)
// - Custom pickers use dropdowns (date picker + hour/minute selects) to avoid locale issues
// - Hidden inputs store values in ISO format for API submission

function toUTCString(localDateTimeString) {
    // Convert datetime-local format (YYYY-MM-DDTHH:mm) to ISO string format
    // Note: Backend stores in local time, not UTC, so we format as local ISO
    // Seconds are set to :00 for start times (schedule grid alignment)
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
    // Parse the ISO string - it should now have timezone info
    const date = new Date(isoString);
    // If the date is invalid, return the raw string
    if (isNaN(date.getTime())) return isoString;
    // Force 24-hour format
    return date.toLocaleString('en-CA', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit',
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        hour12: false 
    });
}

function formatDateTimeNoSeconds(isoString) {
    if (!isoString) return 'N/A';
    // Parse the ISO string - it should now have timezone info
    const date = new Date(isoString);
    // If the date is invalid, return the raw string
    if (isNaN(date.getTime())) return isoString;
    // Force 24-hour format without seconds
    return date.toLocaleString('en-CA', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit',
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: false 
    });
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
    const timeWindowEnabled = document.getElementById('time_window_enabled')?.checked || false;
    const timeWindowStart = document.getElementById('time_window_start')?.value;
    const timeWindowEnd = document.getElementById('time_window_end')?.value;
    
    if (!startDate || !interval) return;
    
    const estimateDiv = document.getElementById('duration-estimate');
    
    // Helper function to calculate captures with time window
    function calculateCaptures(durationSeconds) {
        if (!timeWindowEnabled || !timeWindowStart || !timeWindowEnd) {
            // Simple calculation without time window
            return Math.floor(durationSeconds / interval);
        }
        
        // For jobs with defined start/end times, calculate actual overlap
        if (endDate) {
            const jobStart = new Date(startDate);
            const jobEnd = new Date(endDate);
            
            // Parse time window
            const [startHour, startMin] = timeWindowStart.split(':').map(Number);
            const [endHour, endMin] = timeWindowEnd.split(':').map(Number);
            
            const windowSpansMidnight = startHour > endHour || (startHour === startHour && startMin >= endMin);
            
            let totalCaptures = 0;
            let current = new Date(jobStart);
            const maxIterations = 1000; // Safety limit
            let iterations = 0;
            
            // Iterate through each day in the job duration
            while (current < jobEnd && iterations < maxIterations) {
                iterations++;
                
                const currentDate = new Date(current);
                const currentDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
                
                // Calculate window boundaries for this day
                let dayWindowStart = new Date(currentDay);
                dayWindowStart.setHours(startHour, startMin, 0, 0);
                
                let dayWindowEnd = new Date(currentDay);
                dayWindowEnd.setHours(endHour, endMin, 0, 0);
                
                if (windowSpansMidnight) {
                    // If window spans midnight, end time is next day
                    dayWindowEnd.setDate(dayWindowEnd.getDate() + 1);
                }
                
                // Skip if this window is entirely before current position
                if (dayWindowEnd <= current) {
                    current = new Date(currentDay);
                    current.setDate(current.getDate() + 1);
                    current.setHours(0, 0, 0, 0);
                    continue;
                }
                
                // Find overlap between [current, jobEnd] and [dayWindowStart, dayWindowEnd]
                const overlapStart = new Date(Math.max(current.getTime(), dayWindowStart.getTime()));
                const overlapEnd = new Date(Math.min(jobEnd.getTime(), dayWindowEnd.getTime()));
                
                if (overlapStart < overlapEnd) {
                    // There's an overlap - calculate captures in this period
                    const overlapSeconds = (overlapEnd - overlapStart) / 1000;
                    totalCaptures += Math.floor(overlapSeconds / interval);
                }
                
                // Move to next day
                current = new Date(currentDay);
                current.setDate(current.getDate() + 1);
                current.setHours(0, 0, 0, 0);
                
                // If we've passed the job end, stop
                if (current >= jobEnd) break;
            }
            
            return totalCaptures;
        } else {
            // For ongoing jobs, use the fraction approach as an estimate
            const [startHour, startMin] = timeWindowStart.split(':').map(Number);
            const [endHour, endMin] = timeWindowEnd.split(':').map(Number);
            
            const windowStartMinutes = startHour * 60 + startMin;
            const windowEndMinutes = endHour * 60 + endMin;
            
            // Calculate window duration in minutes
            let windowDurationMinutes;
            if (windowEndMinutes > windowStartMinutes) {
                windowDurationMinutes = windowEndMinutes - windowStartMinutes;
            } else {
                windowDurationMinutes = (24 * 60) - windowStartMinutes + windowEndMinutes;
            }
            
            const windowDurationSeconds = windowDurationMinutes * 60;
            const windowFraction = windowDurationSeconds / 86400;
            const totalCapturesWithoutWindow = durationSeconds / interval;
            
            return Math.floor(totalCapturesWithoutWindow * windowFraction);
        }
    }
    
    if (endDate) {
        // Calculate for defined time range
        const start = new Date(startDate);
        const end = new Date(endDate);
        const durationSeconds = (end - start) / 1000;
        const captures = calculateCaptures(durationSeconds);
        
        const windowNote = timeWindowEnabled ? ` <small style="color: var(--text-secondary);">(with ${timeWindowStart}-${timeWindowEnd} time window)</small>` : '';
        
        estimateDiv.innerHTML = `
            <h4>Estimated Video Duration${windowNote}</h4>
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
        
        const windowNote = timeWindowEnabled ? ` <small style="color: var(--text-secondary);">(with ${timeWindowStart}-${timeWindowEnd} time window)</small>` : '';
        estimateDiv.innerHTML = `<h4>Estimated Video Duration @ ${framerate} FPS (Ongoing Job)${windowNote}</h4>`;
        
        durations.forEach(dur => {
            const captures = calculateCaptures(dur.seconds);
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
    if (videoRefreshInterval) {
        clearInterval(videoRefreshInterval);
        videoRefreshInterval = null;
    }
});

// ===== Maintenance Functions =====

let maintenanceData = null;

async function startMaintenance(jobId, jobName) {
    showConfirm(
        `This will scan all captures for "${jobName}" to identify files that no longer exist on disk. The scan may take a moment depending on the number of captures. Continue?`,
        async (confirmed) => {
            if (confirmed) {
                await performMaintenanceScan(jobId, jobName);
            }
        }
    );
}

async function performMaintenanceScan(jobId, jobName) {
    const modal = document.getElementById('maintenance-modal');
    const title = document.getElementById('maintenance-title');
    const content = document.getElementById('maintenance-content');
    
    // Update modal title with job name
    title.textContent = `${jobName} - Maintenance`;
    
    // Show scanning message
    content.innerHTML = `
        <div style="text-align: center; padding: 2rem;">
            <div style="font-size: 2rem; margin-bottom: 1rem;">🔍</div>
            <p>Scanning captures for "${escapeHtml(jobName)}"...</p>
            <p style="color: var(--text-secondary); font-size: 0.875rem; margin-top: 0.5rem;">
                This may take a moment...
            </p>
        </div>
    `;
    modal.classList.add('active');
    
    try {
        const response = await fetch(`${API_BASE}/jobs/${jobId}/maintenance/scan`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error('Scan failed');
        }
        
        maintenanceData = await response.json();
        displayMaintenanceResults(jobId, jobName);
        
    } catch (error) {
        console.error('Maintenance scan failed:', error);
        content.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <div style="font-size: 2rem; margin-bottom: 1rem;">❌</div>
                <p style="color: var(--danger);">Failed to scan captures</p>
                <p style="color: var(--text-secondary); font-size: 0.875rem; margin-top: 0.5rem;">
                    ${escapeHtml(error.message)}
                </p>
                <button class="btn btn-secondary" style="margin-top: 1rem;" onclick="closeMaintenance()">Close</button>
            </div>
        `;
    }
}

function displayMaintenanceResults(jobId, jobName) {
    const content = document.getElementById('maintenance-content');
    const data = maintenanceData;
    
    if (data.missing_count === 0 && (data.orphaned_count === 0 || !data.orphaned_count)) {
        // No issues found
        content.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <h3 style="margin-bottom: 0.5rem;">Maintenance Results</h3>
                <p style="color: var(--text-secondary);">
                    All ${data.total_captures} captures have their files on disk. Database and files are in sync.
                </p>
                <button class="btn btn-primary" style="margin-top: 1.5rem;" onclick="closeMaintenance()">Close</button>
            </div>
        `;
    } else {
        // Issues found - show details
        const missingList = data.missing_files && data.missing_files.length > 0 ? data.missing_files.map(file => `
            <div style="padding: 0.4rem 0.5rem; background: white; border-radius: 3px; margin-bottom: 0.25rem; border-left: 2px solid var(--danger);">
                <div style="font-size: 0.8rem; color: #000; word-break: break-all; font-family: monospace; line-height: 1.3;">
                    ${escapeHtml(file.file_path)}
                </div>
                <div style="font-size: 0.7rem; color: #666; margin-top: 0.15rem; line-height: 1.2;">
                    ${formatDateTime(file.captured_at)} • ${formatBytes(file.file_size)}
                </div>
            </div>
        `).join('') : '';
        
        content.innerHTML = `
            <div>
                <div style="text-align: center; margin-bottom: 1.5rem;">
                    <h3 style="margin-bottom: 0.5rem;">Maintenance Results</h3>
                </div>
                
                <div style="background: var(--bg-secondary); padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem;">
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem;">
                        <div>
                            <div style="font-size: 0.875rem; color: var(--text-secondary);">Total Captures</div>
                            <div style="font-size: 1.5rem; font-weight: bold;">${data.total_captures}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.875rem; color: var(--text-secondary);">Missing Files</div>
                            <div style="font-size: 1.5rem; font-weight: bold; color: var(--danger);">${data.missing_count}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.875rem; color: var(--text-secondary);">Orphaned Files</div>
                            <div style="font-size: 1.5rem; font-weight: bold; color: #f59e0b;">${data.orphaned_count || 0}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.875rem; color: var(--text-secondary);">Existing Files</div>
                            <div style="font-size: 1.5rem; font-weight: bold; color: var(--success);">${data.existing_count}</div>
                        </div>
                    </div>
                </div>
                
                ${data.missing_count > 0 ? `
                <div style="margin-bottom: 1.5rem;">
                    <h4 style="margin-bottom: 0.5rem;">Missing Files (${data.missing_count}):</h4>
                    <div style="max-height: 300px; overflow-y: auto; padding: 0.4rem; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px;">
                        ${missingList}
                    </div>
                </div>
                
                <div style="background: #fff3cd; border: 1px solid #ffc107; padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem;">
                    <strong style="color: #856404;">Important</strong>
                    <p style="color: #856404; margin-top: 0.5rem; margin-bottom: 0; font-size: 0.875rem;">
                        These files are missing from disk. Submitting will remove the database records for these captures. 
                        Ensure files are truly missing and not temporarily unavailable (e.g., unmounted drive). This action cannot be undone.
                    </p>
                </div>
                ` : ''}
                
                ${data.orphaned_count > 0 ? `
                <div style="margin-bottom: 1.5rem; ${data.missing_count > 0 ? 'padding-top: 1rem; border-top: 2px solid var(--border-color);' : ''}">
                    <h4 style="margin-bottom: 0.5rem;">Orphaned Files (${data.orphaned_count}):</h4>
                    <div style="max-height: 300px; overflow-y: auto; padding: 0.4rem; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px;">
                        ${(data.orphaned_files && data.orphaned_files.length > 0) ? data.orphaned_files.map(f => `
                            <div style="padding: 0.4rem 0.5rem; background: white; border-radius: 3px; margin-bottom: 0.25rem; border-left: 2px solid #f59e0b;">
                                <div style="font-size: 0.8rem; color: #000; word-break: break-all; font-family: monospace; line-height: 1.3;">
                                    ${escapeHtml(f.file_path)}
                                </div>
                                <div style="font-size: 0.7rem; color: #666; margin-top: 0.15rem; line-height: 1.2;">
                                    ${formatDateTime(f.captured_at)} • ${formatBytes(f.file_size)}
                                </div>
                            </div>
                        `).join('') : '<div style="padding: 1rem; text-align: center; color: #666;">No orphaned files data</div>'}
                    </div>
                </div>
                
                <div style="background: #dbeafe; border: 1px solid #3b82f6; padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem;">
                    <strong style="color: #1e40af;">Important</strong>
                    <p style="color: #1e40af; margin-top: 0.5rem; margin-bottom: 0; font-size: 0.875rem;">
                        Timestamps will be extracted from filenames, EXIF data, or file modification times. 
                        Submitting will add these files to the database and update job statistics. This action cannot be undone.
                    </p>
                </div>
                ` : ''}
                
                ${data.missing_count > 0 || data.orphaned_count > 0 ? `
                <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                    <button class="btn btn-secondary" onclick="closeMaintenance()">Cancel</button>
                    <button class="btn btn-primary" onclick="confirmMaintenanceSubmit(${jobId}, '${escapeHtml(jobName)}')">
                        Submit
                    </button>
                </div>
                ` : `
                <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                    <button class="btn btn-primary" onclick="closeMaintenance()">Close</button>
                </div>
                `}
            </div>
        `;
    }
}

function confirmMaintenanceSubmit(jobId, jobName) {
    showConfirm(
        'Are you sure you want to perform all maintenance tasks? This action cannot be undone.',
        async (confirmed) => {
            if (confirmed) {
                await performMaintenanceActions(jobId, jobName);
            }
        }
    );
}

async function performMaintenanceActions(jobId, jobName) {
    const content = document.getElementById('maintenance-content');
    const data = maintenanceData;
    
    content.innerHTML = `
        <div style="text-align: center; padding: 2rem;">
            <p>Processing maintenance actions...</p>
        </div>
    `;
    
    try {
        let cleanupResult = null;
        let importResult = null;
        
        // Perform cleanup if there are missing files
        if (data.missing_count > 0) {
            const captureIds = data.missing_files.map(f => f.id);
            const response = await fetch(`${API_BASE}/jobs/${jobId}/maintenance/cleanup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ capture_ids: captureIds })
            });
            
            if (!response.ok) {
                throw new Error('Cleanup failed');
            }
            cleanupResult = await response.json();
        }
        
        // Perform import if there are orphaned files
        if (data.orphaned_count > 0) {
            const response = await fetch(`${API_BASE}/jobs/${jobId}/maintenance/import`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orphaned_files: data.orphaned_files })
            });
            
            if (!response.ok) {
                throw new Error('Import failed');
            }
            importResult = await response.json();
        }
        
        // Show success with combined results
        let resultHtml = `
            <div style="text-align: center; padding: 2rem;">
                <h3 style="margin-bottom: 0.5rem;">Maintenance Complete</h3>
                <p style="color: var(--text-secondary); margin-bottom: 1rem;">Successfully processed all actions</p>
                <div style="background: var(--bg-secondary); padding: 1rem; border-radius: 8px; display: inline-block; text-align: left;">
        `;
        
        if (cleanupResult) {
            resultHtml += `
                    <div style="margin-bottom: 0.5rem;">
                        <strong>Records removed:</strong> ${cleanupResult.deleted_count}
                    </div>
                    <div style="margin-bottom: 0.5rem;">
                        <strong>Size recovered:</strong> ${formatBytes(cleanupResult.size_recovered)}
                    </div>
            `;
        }
        
        if (importResult) {
            resultHtml += `
                    <div style="margin-bottom: 0.5rem;">
                        <strong>Files imported:</strong> ${importResult.imported_count}
                    </div>
            `;
        }
        
        // Use the final result for capture count and storage
        const finalResult = importResult || cleanupResult;
        resultHtml += `
                    <div style="margin-bottom: 0.5rem;">
                        <strong>Total captures:</strong> ${finalResult.new_capture_count}
                    </div>
                    <div>
                        <strong>Total storage:</strong> ${formatBytes(finalResult.new_storage_size)}
                    </div>
                </div>
                <div style="margin-top: 1.5rem;">
                    <button class="btn btn-primary" onclick="closeMaintenance(); loadJobs()">Close</button>
                </div>
            </div>
        `;
        
        content.innerHTML = resultHtml;
        showNotification(`Maintenance completed successfully for "${jobName}"`, 'success');
        
    } catch (error) {
        console.error('Maintenance failed:', error);
        content.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <p style="color: var(--danger);">Failed to complete maintenance</p>
                <p style="color: var(--text-secondary); font-size: 0.875rem; margin-top: 0.5rem;">
                    ${escapeHtml(error.message)}
                </p>
                <button class="btn btn-secondary" style="margin-top: 1rem;" onclick="closeMaintenance()">Close</button>
            </div>
        `;
        showNotification('Maintenance failed', 'error');
    }
}

function confirmMaintenanceCleanup(jobId, jobName) {
    showConfirm(
        `Are you absolutely sure you want to remove ${maintenanceData.missing_count} database record(s) for missing files? This action cannot be undone.`,
        async (confirmed) => {
            if (confirmed) {
                await performMaintenanceCleanup(jobId, jobName);
            }
        }
    );
}

function confirmMaintenanceImport(jobId, jobName) {
    showConfirm(
        `Import ${maintenanceData.orphaned_count} orphaned file(s) into the database? Timestamps will be extracted from the files.`,
        async (confirmed) => {
            if (confirmed) {
                await performMaintenanceImport(jobId, jobName);
            }
        }
    );
}

async function performMaintenanceImport(jobId, jobName) {
    const content = document.getElementById('maintenance-content');
    
    // Show importing message
    content.innerHTML = `
        <div style="text-align: center; padding: 2rem;">
            <div style="font-size: 2rem; margin-bottom: 1rem;">📥</div>
            <p>Importing orphaned files...</p>
        </div>
    `;
    
    try {
        const response = await fetch(`${API_BASE}/jobs/${jobId}/maintenance/import`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                orphaned_files: maintenanceData.orphaned_files
            })
        });
        
        if (!response.ok) {
            throw new Error('Import failed');
        }
        
        const result = await response.json();
        
        // Show success
        content.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <h3 style="margin-bottom: 0.5rem;">Import Complete</h3>
                <p style="color: var(--text-secondary); margin-bottom: 1rem;">
                    Imported ${result.imported_count} file(s) into the database
                </p>
                <div style="background: var(--bg-secondary); padding: 1rem; border-radius: 8px; display: inline-block; text-align: left;">
                    <div style="margin-bottom: 0.5rem;">
                        <strong>Files imported:</strong> ${result.imported_count}
                    </div>
                    <div style="margin-bottom: 0.5rem;">
                        <strong>Total captures:</strong> ${result.new_capture_count}
                    </div>
                    <div>
                        <strong>Total storage:</strong> ${formatBytes(result.new_storage_size)}
                    </div>
                </div>
                <div style="margin-top: 1.5rem;">
                    <button class="btn btn-primary" onclick="closeMaintenance(); loadJobs()">Close</button>
                </div>
            </div>
        `;
        
        showNotification(`Successfully imported ${result.imported_count} file(s) for "${jobName}"`, 'success');
        
    } catch (error) {
        console.error('Maintenance import failed:', error);
        content.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <p style="color: var(--danger);">Failed to import files</p>
                <p style="color: var(--text-secondary); font-size: 0.875rem; margin-top: 0.5rem;">
                    ${escapeHtml(error.message)}
                </p>
                <button class="btn btn-secondary" style="margin-top: 1rem;" onclick="closeMaintenance()">Close</button>
            </div>
        `;
        showNotification('Maintenance import failed', 'error');
    }
}

async function performMaintenanceCleanup(jobId, jobName) {
    const content = document.getElementById('maintenance-content');
    
    // Show cleaning message
    content.innerHTML = `
        <div style="text-align: center; padding: 2rem;">
            <p>Cleaning up database records...</p>
        </div>
    `;
    
    try {
        const captureIds = maintenanceData.missing_files.map(f => f.id);
        
        const response = await fetch(`${API_BASE}/jobs/${jobId}/maintenance/cleanup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                capture_ids: captureIds
            })
        });
        
        if (!response.ok) {
            throw new Error('Cleanup failed');
        }
        
        const result = await response.json();
        
        // Show success
        content.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <h3 style="margin-bottom: 0.5rem;">Cleanup Complete</h3>
                <p style="color: var(--text-secondary); margin-bottom: 1rem;">
                    Removed ${result.deleted_count} database record(s)
                </p>
                <div style="background: var(--bg-secondary); padding: 1rem; border-radius: 8px; display: inline-block; text-align: left;">
                    <div style="margin-bottom: 0.5rem;">
                        <strong>Size recovered:</strong> ${formatBytes(result.size_recovered)}
                    </div>
                    <div style="margin-bottom: 0.5rem;">
                        <strong>Remaining captures:</strong> ${result.new_capture_count}
                    </div>
                    <div>
                        <strong>Current storage:</strong> ${formatBytes(result.new_storage_size)}
                    </div>
                </div>
                <div style="margin-top: 1.5rem;">
                    <button class="btn btn-primary" onclick="closeMaintenance(); loadJobs()">Close</button>
                </div>
            </div>
        `;
        
        showNotification(`Successfully cleaned up ${result.deleted_count} missing file record(s)`, 'success');
        
    } catch (error) {
        console.error('Maintenance cleanup failed:', error);
        content.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <p style="color: var(--danger);">Failed to cleanup records</p>
                <p style="color: var(--text-secondary); font-size: 0.875rem; margin-top: 0.5rem;">
                    ${escapeHtml(error.message)}
                </p>
                <button class="btn btn-secondary" style="margin-top: 1rem;" onclick="closeMaintenance()">Close</button>
            </div>
        `;
    }
}

function closeMaintenance() {
    const modal = document.getElementById('maintenance-modal');
    modal.classList.remove('active');
    maintenanceData = null;
}

// ===== Custom 24-Hour Time Picker Functions =====

function populateHourOptions(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    // Clear all existing options
    while (select.options.length > 0) {
        select.remove(0);
    }
    
    for (let i = 0; i < 24; i++) {
        const option = document.createElement('option');
        option.value = i.toString().padStart(2, '0');
        option.textContent = i.toString().padStart(2, '0');
        select.appendChild(option);
    }
    
    // Default to 00 if no value is set
    if (!select.value) {
        select.value = '00';
    }
}

function populateMinuteOptions(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    // Clear all existing options
    while (select.options.length > 0) {
        select.remove(0);
    }
    
    for (let i = 0; i < 60; i++) {
        const option = document.createElement('option');
        option.value = i.toString().padStart(2, '0');
        option.textContent = i.toString().padStart(2, '0');
        select.appendChild(option);
    }
    
    // Default to 00 if no value is set
    if (!select.value) {
        select.value = '00';
    }
}

function initializeTimePickers() {
    // Time window pickers
    populateHourOptions('time_window_start_hour');
    populateHourOptions('time_window_end_hour');
    populateMinuteOptions('time_window_start_minute');
    populateMinuteOptions('time_window_end_minute');
    
    // DateTime pickers for job creation
    populateHourOptions('start_hour');
    populateHourOptions('end_hour');
    populateMinuteOptions('start_minute');
    populateMinuteOptions('end_minute');
    
    // DateTime pickers for video processing
    populateHourOptions('video_start_hour');
    populateHourOptions('video_end_hour');
    populateMinuteOptions('video_start_minute');
    populateMinuteOptions('video_end_minute');
    
    // Setup sync for time windows
    setupTimePickerSync('time_window_start');
    setupTimePickerSync('time_window_end');
    
    // Setup sync for datetime pickers
    setupDateTimePickerSync('start');
    setupDateTimePickerSync('end');
    setupDateTimePickerSync('video_start', 'start_time');
    setupDateTimePickerSync('video_end', 'end_time');
    
    // Set default start time to now
    setDefaultStartTime();
}

function setupTimePickerSync(baseId) {
    const hourSelect = document.getElementById(`${baseId}_hour`);
    const minuteSelect = document.getElementById(`${baseId}_minute`);
    const hiddenInput = document.getElementById(baseId);
    
    if (!hourSelect || !minuteSelect || !hiddenInput) return;
    
    const syncValue = () => {
        const hour = hourSelect.value;
        const minute = minuteSelect.value;
        if (hour && minute) {
            hiddenInput.value = `${hour}:${minute}`;
        } else {
            hiddenInput.value = '';
        }
    };
    
    hourSelect.addEventListener('change', syncValue);
    minuteSelect.addEventListener('change', syncValue);
}

function setupDateTimePickerSync(baseId, hiddenId) {
    const dateInput = document.getElementById(`${baseId}_date`);
    const hourSelect = document.getElementById(`${baseId}_hour`);
    const minuteSelect = document.getElementById(`${baseId}_minute`);
    const hiddenInput = document.getElementById(hiddenId || `${baseId}_datetime`);
    
    if (!dateInput || !hourSelect || !minuteSelect || !hiddenInput) return;
    
    const syncValue = () => {
        const date = dateInput.value;
        const hour = hourSelect.value;
        const minute = minuteSelect.value;
        
        if (date && hour && minute) {
            hiddenInput.value = `${date}T${hour}:${minute}`;
        } else {
            hiddenInput.value = '';
        }
        // Dispatch change event so listeners on hidden input get notified
        hiddenInput.dispatchEvent(new Event('change'));
    };
    
    dateInput.addEventListener('change', syncValue);
    hourSelect.addEventListener('change', syncValue);
    minuteSelect.addEventListener('change', syncValue);
}

function setDefaultStartTime() {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const hour = now.getHours().toString().padStart(2, '0');
    const minute = now.getMinutes().toString().padStart(2, '0');
    
    const dateInput = document.getElementById('start_date');
    const hourSelect = document.getElementById('start_hour');
    const minuteSelect = document.getElementById('start_minute');
    
    if (dateInput) dateInput.value = dateStr;
    if (hourSelect) hourSelect.value = hour;
    if (minuteSelect) minuteSelect.value = minute;
    
    // Trigger sync
    if (dateInput) dateInput.dispatchEvent(new Event('change'));
}

function initializeEditTimePickers(job) {
    // Populate hour and minute options for edit modal
    populateHourOptions('edit_time_window_start_hour');
    populateHourOptions('edit_time_window_end_hour');
    populateHourOptions('edit_end_hour');
    
    populateMinuteOptions('edit_time_window_start_minute');
    populateMinuteOptions('edit_time_window_end_minute');
    populateMinuteOptions('edit_end_minute');
    
    // Setup sync for time windows
    setupTimePickerSync('edit_time_window_start');
    setupTimePickerSync('edit_time_window_end');
    
    // Setup sync for end datetime
    setupDateTimePickerSync('edit_end', 'edit_end_datetime');
    
    // Set initial values for time window if enabled
    if (job.time_window_enabled && job.time_window_start && job.time_window_end) {
        setTimePickerValue('edit_time_window_start', job.time_window_start);
        setTimePickerValue('edit_time_window_end', job.time_window_end);
    }
    
    // Set initial values for end datetime if present
    if (job.end_datetime) {
        setDateTimePickerValue('edit_end', job.end_datetime, 'edit_end_datetime');
    }
}

function setTimePickerValue(baseId, timeString) {
    if (!timeString) return;
    
    const [hour, minute] = timeString.split(':');
    const hourSelect = document.getElementById(`${baseId}_hour`);
    const minuteSelect = document.getElementById(`${baseId}_minute`);
    
    if (hourSelect && minuteSelect) {
        hourSelect.value = hour;
        minuteSelect.value = minute;
        hourSelect.dispatchEvent(new Event('change'));
    }
}

function setDateTimePickerValue(baseId, datetimeString, hiddenId) {
    if (!datetimeString) return;
    
    const dt = new Date(datetimeString);
    const dateStr = dt.toISOString().split('T')[0];
    const hour = dt.getHours().toString().padStart(2, '0');
    const minute = dt.getMinutes().toString().padStart(2, '0');
    
    const dateInput = document.getElementById(`${baseId}_date`);
    const hourSelect = document.getElementById(`${baseId}_hour`);
    const minuteSelect = document.getElementById(`${baseId}_minute`);
    
    if (dateInput) dateInput.value = dateStr;
    if (hourSelect) hourSelect.value = hour;
    if (minuteSelect) minuteSelect.value = minute;
    
    // Trigger sync
    if (dateInput) dateInput.dispatchEvent(new Event('change'));
}

// Initialize time pickers on page load
document.addEventListener('DOMContentLoaded', initializeTimePickers);

// Settings Functions
async function loadSettings() {
    const apiKeyInput = document.getElementById('api-key-display');
    if (!apiKeyInput) {
        console.error('API key input element not found');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/settings/api-key`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        apiKeyInput.value = data.api_key;
    } catch (error) {
        console.error('Failed to load settings:', error);
        showNotification('Failed to load settings', 'error');
    }
}

async function copyApiKey() {
    const input = document.getElementById('api-key-display');
    try {
        await navigator.clipboard.writeText(input.value);
        showNotification('API key copied to clipboard', 'success');
    } catch (error) {
        // Fallback for older browsers
        input.select();
        document.execCommand('copy');
        showNotification('API key copied to clipboard', 'success');
    }
}

async function regenerateApiKey() {
    showConfirm('Are you sure you want to regenerate the API key? This will invalidate the current key and any external integrations using it will need to be updated.', async (confirmed) => {
        if (!confirmed) return;
        
        try {
            const response = await fetch(`${API_BASE}/settings/api-key/regenerate`, {
                method: 'POST'
            });
            
            if (!response.ok) {
                throw new Error('Failed to regenerate API key');
            }
            
            const data = await response.json();
            document.getElementById('api-key-display').value = data.api_key;
            showNotification('API key regenerated successfully', 'success');
        } catch (error) {
            console.error('Failed to regenerate API key:', error);
            showNotification('Failed to regenerate API key', 'error');
        }
    });
}
