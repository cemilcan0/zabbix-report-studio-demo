// Zabbix Dashboard Application
const API_BASE = '/alarm/api';

// Global State
let state = {
    sessionId: '',
    hostGroups: [],
    selectedGroups: new Set(),
    currentProblems: [],
    historyEvents: [],
    searchFilter: '',
    selectedSeverities: new Set(['0', '1', '2', '3', '4', '5']),
    selectedHistorySeverities: new Set(['0', '1', '2', '3', '4', '5']),
    lastSelectedIndex: -1,
    collapsedPanels: new Set()
};

// DOM Elements
const elements = {};

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    initializeElements();
    bindEvents();
    setDefaultDates();

    // Hide the login form, show the dashboard
    elements.loginSection.classList.add('hidden');
    elements.dashboardSection.classList.remove('hidden');

    // Automatic Zabbix login
    try {
        const res = await fetch('/alarm/api/auto-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        const data = await res.json();
        if (data.success) {
            state.sessionId = data.sessionId;
            const urlEl = document.getElementById('connectedUrl');
            if (urlEl) urlEl.textContent = data.url;
            loadHostGroups();
        } else {
            showToast('Zabbix bağlantısı kurulamadı: ' + data.error, 'error');
        }
    } catch (e) {
        showToast('Zabbix bağlantı hatası: ' + e.message, 'error');
    }
});

function initializeElements() {
    elements.loginSection = document.getElementById('loginSection');
    elements.dashboardSection = document.getElementById('dashboardSection');
    elements.loginForm = document.getElementById('loginForm');
    elements.loginError = document.getElementById('loginError');
    elements.hostGroupsList = document.getElementById('hostGroupsList');
    elements.problemsList = document.getElementById('problemsList');
    elements.loadingOverlay = document.getElementById('loadingOverlay');
    elements.loadingText = document.getElementById('loadingText');
    elements.toastContainer = document.getElementById('toastContainer');
}

function bindEvents() {
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
    document.getElementById('selectAllBtn').addEventListener('click', toggleSelectAll);
    document.getElementById('selectVisibleBtn').addEventListener('click', selectVisible);
    document.getElementById('clearSelBtn').addEventListener('click', clearSelection);
    document.getElementById('fetchProblemsBtn').addEventListener('click', fetchProblems);
    document.getElementById('exportProblemsBtn').addEventListener('click', exportProblems);
    document.getElementById('fetchHistoryBtn').addEventListener('click', fetchHistory);
    document.getElementById('exportHistoryBtn').addEventListener('click', exportHistory);

    // Host group search
    document.getElementById('hostGroupSearch').addEventListener('input', (e) => {
        state.searchFilter = e.target.value.toLowerCase();
        renderHostGroups();
    });

    // Severity filter for problems
    document.querySelectorAll('.severity-checkbox input:not(.history-severity-filter)').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                state.selectedSeverities.add(e.target.value);
            } else {
                state.selectedSeverities.delete(e.target.value);
            }
            renderProblems();
        });
    });

    // Severity filter for history
    document.querySelectorAll('.history-severity-filter').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                state.selectedHistorySeverities.add(e.target.value);
            } else {
                state.selectedHistorySeverities.delete(e.target.value);
            }
            renderHistoryList();
        });
    });

    // Accordion collapse/expand
    document.querySelectorAll('.btn-collapse').forEach(btn => {
        btn.addEventListener('click', () => {
            const panelId = btn.dataset.panel;
            togglePanel(panelId);
        });
    });
}

function setDefaultDates() {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const locale = {
        firstDayOfWeek: 1,
        weekdays: {
            shorthand: ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'],
            longhand: ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']
        },
        months: {
            shorthand: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'],
            longhand: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
        }
    };

    flatpickr("#startDate", {
        enableTime: true,
        dateFormat: "Y-m-d H:i",
        time_24hr: true,
        defaultDate: weekAgo,
        locale
    });

    flatpickr("#endDate", {
        enableTime: true,
        dateFormat: "Y-m-d H:i",
        time_24hr: true,
        defaultDate: now,
        locale
    });
}

// Loading & Toast
function showLoading(text = 'Yükleniyor...') {
    elements.loadingText.textContent = text;
    elements.loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    elements.loadingOverlay.classList.add('hidden');
}

function showToast(message, type = 'info') {
    const icons = {
        success: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
        error: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
        warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
        info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
    };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${icons[type]}</svg><p>${message}</p>`;
    elements.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// API Helper
async function apiRequest(endpoint, data = {}) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, sessionId: state.sessionId })
    });
    if (response.status === 401) {
        showToast('Oturum süresi doldu. Ana sayfaya yönlendiriliyorsunuz...', 'error');
        setTimeout(() => window.location.href = 'index.html', 2000);
        throw new Error('Oturum süresi doldu');
    }
    const result = await response.json();
    if (!result.success) throw new Error(result.error || 'API hatası');
    return result.data;
}

// Logout - return to the portal home page
async function handleLogout() {
    try {
        await fetch(`${API_BASE}/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: state.sessionId })
        });
    } catch (e) { }
    window.location.href = 'index.html';
}

// Host Groups
async function loadHostGroups() {
    showLoading('Host grupları yükleniyor...');
    try {
        const groups = await apiRequest('/hostgroups');
        state.hostGroups = groups;
        renderHostGroups();
    } catch (error) {
        showToast(`Host grupları yüklenemedi: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

function renderHostGroups() {
    const filteredGroups = state.hostGroups.filter(group =>
        group.name.toLowerCase().includes(state.searchFilter)
    );

    if (filteredGroups.length === 0) {
        elements.hostGroupsList.innerHTML = '<div class="empty-state"><p>Host grubu bulunamadı</p></div>';
        return;
    }

    elements.hostGroupsList.innerHTML = filteredGroups.map((group, index) => {
        const hostCount = typeof group.hosts === 'number' ? group.hosts : (group.hosts?.length || 0);
        return `
            <div class="host-group-item ${state.selectedGroups.has(group.groupid) ? 'selected' : ''}" data-id="${group.groupid}" data-index="${index}">
                <input type="checkbox" ${state.selectedGroups.has(group.groupid) ? 'checked' : ''}>
                <div class="host-group-info">
                    <div class="host-group-name">${escapeHtml(group.name)}</div>
                </div>
                <span class="host-count">${hostCount}</span>
            </div>
        `;
    }).join('');

    elements.hostGroupsList.querySelectorAll('.host-group-item').forEach(item => {
        item.addEventListener('click', (e) => toggleGroupSelection(item.dataset.id, parseInt(item.dataset.index), e.shiftKey));
    });

    updateSelectedCount();
}

function toggleGroupSelection(groupId, index, shiftKey) {
    const filteredGroups = state.hostGroups.filter(group =>
        group.name.toLowerCase().includes(state.searchFilter)
    );

    if (shiftKey && state.lastSelectedIndex !== -1 && state.lastSelectedIndex !== index) {
        const start = Math.min(state.lastSelectedIndex, index);
        const end = Math.max(state.lastSelectedIndex, index);
        for (let i = start; i <= end; i++) {
            state.selectedGroups.add(filteredGroups[i].groupid);
        }
    } else {
        if (state.selectedGroups.has(groupId)) {
            state.selectedGroups.delete(groupId);
        } else {
            state.selectedGroups.add(groupId);
        }
    }

    state.lastSelectedIndex = index;
    renderHostGroups();
}

function getFilteredGroups() {
    return state.hostGroups.filter(g =>
        g.name.toLowerCase().includes(state.searchFilter)
    );
}

function toggleSelectAll() {
    // If all groups are selected, clear; otherwise select all
    const allSelected = state.selectedGroups.size === state.hostGroups.length;
    state.selectedGroups.clear();
    if (!allSelected) {
        state.hostGroups.forEach(g => state.selectedGroups.add(g.groupid));
    }
    state.lastSelectedIndex = -1;
    renderHostGroups();
}

function selectVisible() {
    // Select only the (visible) groups that pass the search filter
    const visible = getFilteredGroups();
    const allVisibleSelected = visible.every(g => state.selectedGroups.has(g.groupid));
    if (allVisibleSelected) {
        // If all are selected, deselect the visible ones
        visible.forEach(g => state.selectedGroups.delete(g.groupid));
    } else {
        // Select the visible ones (add to the current selection)
        visible.forEach(g => state.selectedGroups.add(g.groupid));
    }
    state.lastSelectedIndex = -1;
    renderHostGroups();
}

function clearSelection() {
    state.selectedGroups.clear();
    state.lastSelectedIndex = -1;
    renderHostGroups();
}

function updateSelectedCount() {
    document.getElementById('selectedCount').textContent = state.selectedGroups.size;
    document.getElementById('fetchProblemsBtn').disabled = state.selectedGroups.size === 0;

    // Update the "Select Visible" button text
    const visBtn = document.getElementById('selectVisibleBtn');
    if (visBtn) {
        const visible = getFilteredGroups();
        const allVisibleSel = visible.length > 0 && visible.every(g => state.selectedGroups.has(g.groupid));
        visBtn.textContent = allVisibleSel ? 'Görünenleri Kaldır' : 'Görünenleri Seç';
    }

    // Update the "Select All" button text
    const allBtn = document.getElementById('selectAllBtn');
    if (allBtn) {
        const allSel = state.hostGroups.length > 0 && state.selectedGroups.size === state.hostGroups.length;
        allBtn.textContent = allSel ? 'Tümünü Kaldır' : 'Tümünü Seç';
    }
}

function togglePanel(panelId) {
    const panel = document.querySelector(`[data-panel-id="${panelId}"]`);
    const btn = document.querySelector(`[data-panel="${panelId}"]`);

    if (state.collapsedPanels.has(panelId)) {
        state.collapsedPanels.delete(panelId);
        panel.classList.remove('collapsed');
        btn.classList.remove('collapsed');
    } else {
        state.collapsedPanels.add(panelId);
        panel.classList.add('collapsed');
        btn.classList.add('collapsed');
    }
}

// Problems
async function fetchProblems() {
    if (state.selectedGroups.size === 0) return;
    showLoading('Aktif problemler yükleniyor...');

    try {
        const problems = await apiRequest('/problems', {
            groupIds: Array.from(state.selectedGroups)
        });

        state.currentProblems = problems;
        renderProblems();
        document.getElementById('problemCount').textContent = problems.length;
        document.getElementById('exportProblemsBtn').disabled = problems.length === 0;

        if (problems.length === 0) {
            showToast('Aktif problem bulunamadı', 'success');
        } else {
            showToast(`${problems.length} problem bulundu`, 'info');
        }
    } catch (error) {
        showToast(`Problemler yüklenemedi: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

function renderProblems() {
    const filteredProblems = state.currentProblems.filter(p =>
        state.selectedSeverities.has(p.severity)
    );

    document.getElementById('problemCount').textContent = filteredProblems.length;

    if (filteredProblems.length === 0) {
        elements.problemsList.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg><p>Aktif problem yok</p></div>';
        return;
    }

    elements.problemsList.innerHTML = filteredProblems.map(problem => {
        const severityClass = getSeverityClass(problem.severity);
        const severityName = getSeverityName(problem.severity);
        const hostName = problem.hosts?.[0]?.name || 'Bilinmiyor';
        const time = formatTimestamp(problem.clock);

        return `
            <div class="problem-item ${severityClass}">
                <div class="problem-header">
                    <div class="problem-name">${escapeHtml(problem.name)}</div>
                    <span class="problem-severity">${severityName}</span>
                </div>
                <div class="problem-details">
                    <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>${escapeHtml(hostName)}</span>
                    <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${time}</span>
                </div>
            </div>
        `;
    }).join('');
}

// History
async function fetchHistory() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    if (!startDate || !endDate) {
        showToast('Lütfen tarih aralığı seçin', 'warning');
        return;
    }

    showLoading('Alarm geçmişi yükleniyor...');

    try {
        const startTimestamp = Math.floor(new Date(startDate).getTime() / 1000);
        const endTimestamp = Math.floor(new Date(endDate).getTime() / 1000);

        const events = await apiRequest('/history', {
            timeFrom: startTimestamp,
            timeTill: endTimestamp,
            groupIds: Array.from(state.selectedGroups)
        });

        state.historyEvents = events;
        renderHistoryList();
        document.getElementById('historyResults').classList.remove('hidden');
        document.getElementById('historySeverityFilter').classList.remove('hidden');
        document.getElementById('historyCount').textContent = events.length;

        showToast(`${events.length} alarm bulundu`, 'info');
    } catch (error) {
        showToast(`Alarm geçmişi yüklenemedi: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

function renderHistoryList() {
    const historyList = document.getElementById('historyList');

    const filteredEvents = state.historyEvents.filter(event =>
        state.selectedHistorySeverities.has(event.severity)
    );

    document.getElementById('historyCount').textContent = filteredEvents.length;

    if (filteredEvents.length === 0) {
        historyList.innerHTML = '<div class="empty-state"><p>Seçili severity seviyelerinde alarm bulunamadı</p></div>';
        return;
    }

    historyList.innerHTML = filteredEvents.slice(0, 50).map(event => {
        const hostName = event.hosts?.[0]?.name || 'Bilinmiyor';
        const isResolved = event.r_eventid && event.r_eventid !== '0';
        const severityClass = getSeverityClass(event.severity);
        const severityName = getSeverityName(event.severity);

        return `
            <div class="history-item ${severityClass}">
                <span class="time">${formatTimestamp(event.clock)}</span>
                <span class="problem-severity">${severityName}</span>
                <span class="status ${isResolved ? 'resolved' : 'problem'}">${isResolved ? 'Çözüldü' : 'Problem'}</span>
                <span>${escapeHtml(event.name || 'N/A')}</span>
                <span class="host-name">${escapeHtml(hostName)}</span>
            </div>
        `;
    }).join('');

    if (filteredEvents.length > 50) {
        historyList.innerHTML += `<div class="history-item" style="justify-content:center;color:var(--text-muted);">... ve ${filteredEvents.length - 50} alarm daha</div>`;
    }
}

// Excel Export
function exportProblems() {
    if (state.currentProblems.length === 0) return;

    const data = state.currentProblems.map(p => ({
        'Problem': p.name,
        'Severity': getSeverityName(p.severity),
        'Host': p.hosts?.[0]?.name || 'Bilinmiyor',
        'Başlangıç Zamanı': formatTimestamp(p.clock),
        'Event ID': p.eventid
    }));

    exportToExcel(data, 'Zabbix_Aktif_Problemler');
    showToast('Excel dosyası indirildi', 'success');
}

function exportHistory() {
    if (state.historyEvents.length === 0) return;

    const filteredEvents = state.historyEvents.filter(e =>
        state.selectedHistorySeverities.has(e.severity)
    );

    const data = filteredEvents.map(e => ({
        'Event': e.name || 'N/A',
        'Host': e.hosts?.[0]?.name || 'Bilinmiyor',
        'Zaman': formatTimestamp(e.clock),
        'Durum': (e.r_eventid && e.r_eventid !== '0') ? 'Çözüldü' : 'Problem',
        'Severity': getSeverityName(e.severity),
        'Event ID': e.eventid
    }));

    exportToExcel(data, 'Zabbix_Alarm_Gecmisi');
    showToast('Excel dosyası indirildi', 'success');
}

function exportToExcel(data, filename) {
    const ws = XLSX.utils.json_to_sheet(data);
    const colWidths = Object.keys(data[0] || {}).map(key => ({ wch: Math.max(key.length, 20) }));
    ws['!cols'] = colWidths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Rapor');
    const date = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `${filename}_${date}.xlsx`);
}

// Helpers
function getSeverityClass(severity) {
    const classes = ['severity-not-classified', 'severity-info', 'severity-warning', 'severity-average', 'severity-high', 'severity-disaster'];
    return classes[parseInt(severity)] || 'severity-not-classified';
}

function getSeverityName(severity) {
    const names = ['Not Classified', 'Information', 'Warning', 'Average', 'High', 'Disaster'];
    return names[parseInt(severity)] || 'Unknown';
}

function formatTimestamp(timestamp) {
    return new Date(parseInt(timestamp) * 1000).toLocaleString('tr-TR');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}