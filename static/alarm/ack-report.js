const API_BASE = '/alarm/api';
Chart.register(ChartDataLabels);

const SEVERITY_MAP = {
    '0': { name: 'Not Classified', class: 'not-classified', color: '#97AAB3' },
    '1': { name: 'Information', class: 'info', color: '#7499FF' },
    '2': { name: 'Warning', class: 'warning', color: '#FFC800' },
    '3': { name: 'Average', class: 'average', color: '#FFAA00' },
    '4': { name: 'High', class: 'high', color: '#FF8800' },
    '5': { name: 'Disaster', class: 'disaster', color: '#FF4444' }
};

const ackState = {
    sessionId: '',
    zabbixUrl: '',
    hostGroups: [],
    selectedGroups: new Set(),
    selectedSeverities: new Set(['5', '4', '3', '2']),
    mode: 'active',
    reportData: [],
    filteredData: [],
    currentFilter: 'all',
    searchText: '',
    distChart: null,
    hostSearchFilter: '',
    _toastTimer: null
};

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
    initDatePickers();
    initSeverityFilter();
    initModeToggle();
    initFilterChips();

    document.getElementById('generateAckBtn').addEventListener('click', generateAckReport);
    document.getElementById('exportAckBtn').addEventListener('click', exportAckExcel);
    document.getElementById('filtersToggle').addEventListener('click', () => {
        document.querySelector('.report-filters-panel').classList.toggle('collapsed');
    });
    document.getElementById('ackHostSearch').addEventListener('input', (e) => {
        ackState.hostSearchFilter = e.target.value.toLowerCase();
        renderHostGroupChips();
    });
    document.getElementById('ackSearchInput').addEventListener('input', (e) => {
        ackState.searchText = e.target.value.toLowerCase();
        applyFilters();
    });

    try {
        const res = await fetch('/alarm/api/auto-login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
        });
        const data = await res.json();
        if (data.success) {
            ackState.sessionId = data.sessionId;
            ackState.zabbixUrl = data.url;
            const urlEl = document.getElementById('ackConnectedUrl');
            if (urlEl) urlEl.textContent = data.url;
            loadHostGroups();
        } else {
            showToast('Zabbix bağlantısı kurulamadı: ' + data.error, 'error');
        }
    } catch (e) {
        showToast('Zabbix bağlantı hatası: ' + e.message, 'error');
    }
});

function initDatePickers() {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    flatpickr('#ackStartDate', { enableTime: true, time_24hr: true, dateFormat: 'Y-m-d H:i', defaultDate: firstDay, locale: { firstDayOfWeek: 1 } });
    flatpickr('#ackEndDate', { enableTime: true, time_24hr: true, dateFormat: 'Y-m-d H:i', defaultDate: now, locale: { firstDayOfWeek: 1 } });
}

function initSeverityFilter() {
    document.querySelectorAll('#ackSeverityFilter input[type="checkbox"]').forEach(cb => {
        cb.checked = ackState.selectedSeverities.has(cb.value);
        cb.addEventListener('change', () => {
            if (cb.checked) ackState.selectedSeverities.add(cb.value); else ackState.selectedSeverities.delete(cb.value);
        });
    });
}

function initModeToggle() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            ackState.mode = btn.dataset.mode;
            const dateCard = document.getElementById('dateFilterCard');
            dateCard.style.opacity = ackState.mode === 'active' ? '0.4' : '1';
            dateCard.style.pointerEvents = ackState.mode === 'active' ? 'none' : 'auto';
        });
    });
    // Initial state
    document.getElementById('dateFilterCard').style.opacity = '0.4';
    document.getElementById('dateFilterCard').style.pointerEvents = 'none';
}

function initFilterChips() {
    document.querySelectorAll('.ack-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.ack-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            ackState.currentFilter = chip.dataset.filter;
            applyFilters();
        });
    });
}

// ===== Host Groups =====
async function loadHostGroups() {
    try {
        const result = await apiRequest('/hostgroups', {});
        ackState.hostGroups = result;
        renderHostGroupChips();
    } catch (e) { showToast('Host grupları yüklenemedi: ' + e.message, 'error'); }
}

function renderHostGroupChips() {
    const container = document.getElementById('ackHostGroups');
    const filtered = ackState.hostGroups.filter(g => !ackState.hostSearchFilter || g.name.toLowerCase().includes(ackState.hostSearchFilter));
    if (!filtered.length) { container.innerHTML = '<div class="empty-state">Sonuç bulunamadı</div>'; }
    else {
        container.innerHTML = filtered.map(g => `
            <div class="report-host-chip ${ackState.selectedGroups.has(g.groupid) ? 'selected' : ''}"
                 data-id="${g.groupid}" onclick="toggleGroup('${g.groupid}')">
                ${escapeHtml(g.name)} (${g.hosts})
            </div>
        `).join('');
    }
    document.getElementById('ackSelectedGroupCount').textContent = `${ackState.selectedGroups.size} seçili`;
}

function toggleGroup(gid) {
    if (ackState.selectedGroups.has(gid)) ackState.selectedGroups.delete(gid); else ackState.selectedGroups.add(gid);
    renderHostGroupChips();
}

// ===== Generate Report =====
async function generateAckReport() {
    if (ackState.selectedSeverities.size === 0) { showToast('En az bir seviye seçin', 'warning'); return; }
    if (ackState.mode === 'history') {
        const s = document.getElementById('ackStartDate').value, e = document.getElementById('ackEndDate').value;
        if (!s || !e) { showToast('Tarih aralığı seçin', 'warning'); return; }
    }
    showLoading('ACK verileri çekiliyor...');
    try {
        const body = {
            sessionId: ackState.sessionId,
            mode: ackState.mode,
            groupIds: Array.from(ackState.selectedGroups),
            severities: Array.from(ackState.selectedSeverities)
        };
        if (ackState.mode === 'history') {
            body.timeFrom = Math.floor(new Date(document.getElementById('ackStartDate').value).getTime() / 1000);
            body.timeTill = Math.floor(new Date(document.getElementById('ackEndDate').value).getTime() / 1000);
        }
        const res = await fetch(`${API_BASE}/ack-data`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const result = await res.json();
        if (!result.success) throw new Error(result.error || 'Veri alınamadı');

        ackState.reportData = result.data;
        ackState.filteredData = result.data;
        ackState.currentFilter = 'all';
        ackState.searchText = '';
        document.getElementById('ackSearchInput').value = '';
        document.querySelectorAll('.ack-chip').forEach(c => c.classList.remove('active'));
        document.querySelector('.ack-chip[data-filter="all"]').classList.add('active');

        renderStats();
        renderDistribution();
        updateFilterCounts();
        applyFilters();

        document.getElementById('ackReportContent').classList.remove('hidden');
        document.getElementById('exportAckBtn').style.display = '';
        document.querySelector('.report-filters-panel').classList.add('collapsed');
        setTimeout(() => document.getElementById('ackReportContent').scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
        showToast(`ACK raporu oluşturuldu — ${result.data.length} alarm`, 'info');
    } catch (e) {
        showToast('Hata: ' + e.message, 'error');
    } finally { hideLoading(); }
}

// ===== Stats =====
function renderStats() {
    const d = ackState.reportData, total = d.length;
    const acked = d.filter(x => x.acknowledged).length;
    const noAck = total - acked;
    const delays = d.filter(x => x.first_ack_delay !== null).map(x => x.first_ack_delay);
    const avgDelay = delays.length ? (delays.reduce((a, b) => a + b, 0) / delays.length).toFixed(1) : '-';
    const late30 = d.filter(x => x.first_ack_delay !== null && x.first_ack_delay > 30).length;

    document.getElementById('ackGeneralStats').innerHTML = `
        <div class="stat-card"><span class="stat-value">${total.toLocaleString('tr-TR')}</span><span class="stat-label">Toplam Alarm</span></div>
        <div class="stat-card ack-yes"><span class="stat-value">${acked.toLocaleString('tr-TR')}</span><span class="stat-label">ACK Girilen</span><span class="stat-detail">%${total ? ((acked/total)*100).toFixed(1) : 0}</span></div>
        <div class="stat-card ack-no"><span class="stat-value">${noAck.toLocaleString('tr-TR')}</span><span class="stat-label">ACK Girilmemiş</span><span class="stat-detail">%${total ? ((noAck/total)*100).toFixed(1) : 0}</span></div>
        <div class="stat-card ack-avg"><span class="stat-value">${avgDelay}</span><span class="stat-label">Ort. ACK Süresi (dk)</span></div>
        <div class="stat-card ack-late"><span class="stat-value">${late30.toLocaleString('tr-TR')}</span><span class="stat-label">30dk+ Geç ACK</span></div>
    `;
}

// ===== Distribution =====
function renderDistribution() {
    const d = ackState.reportData, total = d.length;
    const onTime = d.filter(x => x.first_ack_delay !== null && x.first_ack_delay <= 30).length;
    const late30 = d.filter(x => x.first_ack_delay !== null && x.first_ack_delay > 30 && x.first_ack_delay <= 60).length;
    const late60 = d.filter(x => x.first_ack_delay !== null && x.first_ack_delay > 60).length;
    const noAck = d.filter(x => !x.acknowledged).length;
    const cats = [
        { name: '≤30 dk (Zamanında)', count: onTime, color: '#22c55e', cls: 'ack-dist-row-ontime' },
        { name: '30dk – 1 saat', count: late30, color: '#f59e0b', cls: 'ack-dist-row-late30' },
        { name: '>1 saat', count: late60, color: '#ef4444', cls: 'ack-dist-row-late60' },
        { name: 'ACK Yok', count: noAck, color: '#6b7280', cls: 'ack-dist-row-noack' }
    ];

    const tbody = document.querySelector('#ackDistTable tbody');
    tbody.innerHTML = cats.map(c => `
        <tr class="${c.cls}"><td><strong>${c.name}</strong></td><td><strong>${c.count.toLocaleString('tr-TR')}</strong></td><td>${total ? ((c.count/total)*100).toFixed(1) : 0}%</td></tr>
    `).join('');

    // Chart
    const ctx = document.getElementById('ackDistChart').getContext('2d');
    if (ackState.distChart) ackState.distChart.destroy();
    ackState.distChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: cats.map(c => c.name),
            datasets: [{ data: cats.map(c => c.count), backgroundColor: cats.map(c => c.color), borderColor: 'rgba(0,0,0,0.3)', borderWidth: 1 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '55%',
            plugins: {
                legend: { position: 'bottom', labels: { color: '#ccc', padding: 15, font: { size: 12 } } },
                tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.raw} (%${total ? ((c.raw/total)*100).toFixed(1) : 0})` } },
                datalabels: {
                    color: '#fff', font: { weight: 'bold', size: 13 },
                    formatter: (v) => v > 0 ? `%${((v/total)*100).toFixed(0)}` : '',
                    display: (c) => (c.dataset.data[c.dataIndex] / total) * 100 >= 5
                }
            }
        }
    });
}

// ===== Filter Counts =====
function updateFilterCounts() {
    const d = ackState.reportData;
    document.getElementById('filterAllCount').textContent = d.length;
    document.getElementById('filterNoAckCount').textContent = d.filter(x => !x.acknowledged).length;
    document.getElementById('filterLate30Count').textContent = d.filter(x => x.first_ack_delay !== null && x.first_ack_delay > 30).length;
    document.getElementById('filterLate60Count').textContent = d.filter(x => x.first_ack_delay !== null && x.first_ack_delay > 60).length;
    document.getElementById('filterOnTimeCount').textContent = d.filter(x => x.first_ack_delay !== null && x.first_ack_delay <= 30).length;
}

// ===== Apply Filters =====
function applyFilters() {
    let data = ackState.reportData;
    const f = ackState.currentFilter;
    if (f === 'no_ack') data = data.filter(x => !x.acknowledged);
    else if (f === 'late_30') data = data.filter(x => x.first_ack_delay !== null && x.first_ack_delay > 30);
    else if (f === 'late_60') data = data.filter(x => x.first_ack_delay !== null && x.first_ack_delay > 60);
    else if (f === 'on_time') data = data.filter(x => x.first_ack_delay !== null && x.first_ack_delay <= 30);

    if (ackState.searchText) {
        const s = ackState.searchText;
        data = data.filter(x => x.host.toLowerCase().includes(s) || x.name.toLowerCase().includes(s));
    }

    ackState.filteredData = data;
    renderDetailTable(data);
}

// ===== Detail Table =====
function renderDetailTable(data) {
    document.getElementById('ackDetailCount').textContent = data.length;
    const tbody = document.querySelector('#ackDetailTable tbody');
    tbody.innerHTML = data.map(d => {
        const sev = SEVERITY_MAP[d.severity] || SEVERITY_MAP['0'];
        const date = formatDate(d.clock);

        // ACK status badge
        let ackBadge;
        if (!d.acknowledged) {
            ackBadge = '<span class="ack-badge ack-none">🚫 ACK Yok</span>';
        } else if (d.first_ack_delay <= 30) {
            ackBadge = `<span class="ack-badge ack-ok">✅ ${d.first_ack_delay} dk</span>`;
        } else if (d.first_ack_delay <= 60) {
            ackBadge = `<span class="ack-badge ack-late">⏰ ${d.first_ack_delay} dk</span>`;
        } else {
            ackBadge = `<span class="ack-badge ack-very-late">🕐 ${formatDelayText(d.first_ack_delay)}</span>`;
        }

        // ACK entries
        let ackDetails;
        if (!d.acks || d.acks.length === 0) {
            ackDetails = '<div class="ack-no-entry">🚫 Henüz ACK girilmemiş</div>';
        } else {
            const showAll = d.acks.length <= 2;
            const visibleAcks = showAll ? d.acks : d.acks.slice(0, 1);
            ackDetails = visibleAcks.map(a => renderAckEntry(a)).join('');
            if (!showAll) {
                const hiddenAcks = d.acks.slice(1);
                ackDetails += `<div class="ack-hidden-entries" id="ackHidden_${d.eventid}" style="display:none;">${hiddenAcks.map(a => renderAckEntry(a)).join('')}</div>`;
                ackDetails += `<button class="ack-toggle-btn" onclick="toggleAckEntries('${d.eventid}', this)">+${hiddenAcks.length} daha göster</button>`;
            }
        }

        return `<tr>
            <td><span class="severity-badge-table ${sev.class}">${sev.name}</span></td>
            <td>${date}</td>
            <td><strong>${escapeHtml(d.host)}</strong></td>
            <td>${escapeHtml(d.name)}</td>
            <td>${ackBadge}</td>
            <td><div class="ack-details-cell">${ackDetails}</div></td>
        </tr>`;
    }).join('');
}

function renderAckEntry(ack) {
    let delayCls = 'delay-ok';
    if (ack.delay_minutes > 60) delayCls = 'delay-bad';
    else if (ack.delay_minutes > 30) delayCls = 'delay-warn';

    const msg = ack.message ? `<div class="ack-entry-message">"${escapeHtml(ack.message)}"</div>` : '';
    return `<div class="ack-entry">
        <div class="ack-entry-header">
            <span class="ack-entry-user">👤 ${escapeHtml(ack.user)}</span>
            <span class="ack-entry-delay ${delayCls}">${formatDelayText(ack.delay_minutes)}</span>
        </div>
        <div class="ack-entry-time">🕐 ${formatDate(ack.clock)}</div>
        ${msg}
    </div>`;
}

function toggleAckEntries(eventId, btn) {
    const el = document.getElementById('ackHidden_' + eventId);
    if (!el) return;
    const isHidden = el.style.display === 'none';
    el.style.display = isHidden ? '' : 'none';
    btn.textContent = isHidden ? 'Gizle' : `+${el.children.length} daha göster`;
}

// ===== Export Excel =====
async function exportAckExcel() {
    showToast('Excel hazırlanıyor...', 'info');
    try {
        const wb = new ExcelJS.Workbook();
        wb.creator = 'Zabbix ACK Raporu';
        const ws = wb.addWorksheet('ACK Raporu');
        const hdrFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E1B4B' } };
        const hdrFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
        const hdrAlign = { vertical: 'middle', horizontal: 'center', wrapText: true };
        const border = { top: { style: 'thin', color: { argb: 'FF9CA3AF' } }, bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } }, left: { style: 'thin', color: { argb: 'FF9CA3AF' } }, right: { style: 'thin', color: { argb: 'FF9CA3AF' } } };

        const headers = ['Seviye', 'Tarih', 'Host', 'Problem', 'ACK Durumu', 'İlk ACK Süresi (dk)', 'ACK Yapan', 'ACK Zamanı', 'ACK Mesajı'];
        ws.columns = [{ width: 15 }, { width: 20 }, { width: 30 }, { width: 40 }, { width: 15 }, { width: 18 }, { width: 20 }, { width: 20 }, { width: 40 }];

        const hdrRow = ws.addRow(headers);
        hdrRow.height = 26;
        hdrRow.eachCell(c => { c.fill = hdrFill; c.font = hdrFont; c.alignment = hdrAlign; c.border = border; });

        const data = ackState.filteredData;
        for (const d of data) {
            const sev = SEVERITY_MAP[d.severity] || SEVERITY_MAP['0'];
            const ackStatus = d.acknowledged ? 'ACK Var' : 'ACK Yok';

            if (!d.acks || d.acks.length === 0) {
                const row = ws.addRow([sev.name, formatDate(d.clock), d.host, d.name, ackStatus, '-', '-', '-', '-']);
                row.eachCell(c => { c.border = border; c.font = { size: 10, name: 'Calibri', color: { argb: 'FF1F2937' } }; c.alignment = { vertical: 'middle' }; });
                if (!d.acknowledged) row.getCell(5).font = { bold: true, color: { argb: 'FFDC2626' }, size: 10, name: 'Calibri' };
            } else {
                for (let i = 0; i < d.acks.length; i++) {
                    const a = d.acks[i];
                    const row = ws.addRow([
                        i === 0 ? sev.name : '', i === 0 ? formatDate(d.clock) : '', i === 0 ? d.host : '', i === 0 ? d.name : '',
                        i === 0 ? ackStatus : '', a.delay_minutes, a.user, formatDate(a.clock), a.message || ''
                    ]);
                    row.eachCell(c => { c.border = border; c.font = { size: 10, name: 'Calibri', color: { argb: 'FF1F2937' } }; c.alignment = { vertical: 'middle' }; });
                    if (a.delay_minutes > 60) row.getCell(6).font = { bold: true, color: { argb: 'FFDC2626' }, size: 10, name: 'Calibri' };
                    else if (a.delay_minutes > 30) row.getCell(6).font = { bold: true, color: { argb: 'FFD97706' }, size: 10, name: 'Calibri' };
                    else row.getCell(6).font = { bold: true, color: { argb: 'FF16A34A' }, size: 10, name: 'Calibri' };
                }
            }
        }

        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `Zabbix_ACK_Raporu_${new Date().toISOString().slice(0, 10)}.xlsx`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('Excel indirildi', 'success');
    } catch (e) {
        showToast('Excel hatası: ' + e.message, 'error');
    }
}

// ===== Utilities =====
function formatDate(ts) {
    return new Date(ts * 1000).toLocaleString('tr-TR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDelayText(minutes) {
    if (minutes === null || minutes === undefined) return '-';
    if (minutes < 1) return '<1 dk';
    if (minutes < 60) return Math.round(minutes) + ' dk';
    const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
    return m > 0 ? `${h}s ${m}dk` : `${h}s`;
}

function escapeHtml(str) {
    if (!str) return '';
    const d = document.createElement('div'); d.textContent = str; return d.innerHTML;
}

async function apiRequest(endpoint, data) {
    const r = await fetch(`${API_BASE}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, sessionId: ackState.sessionId }) });
    if (r.status === 401) { showToast('Oturum süresi doldu', 'error'); setTimeout(() => window.location.href = 'index.html', 2000); throw new Error('Oturum doldu'); }
    const result = await r.json();
    if (!result.success) throw new Error(result.error || 'Hata');
    return result.data;
}

function showToast(msg, type = 'info') {
    const t = document.getElementById('toast'); t.textContent = msg; t.className = `toast ${type}`;
    clearTimeout(ackState._toastTimer); ackState._toastTimer = setTimeout(() => t.classList.add('hidden'), 4000);
}

function showLoading(msg) { document.getElementById('loadingText').textContent = msg; document.getElementById('loadingOverlay').classList.remove('hidden'); }
function hideLoading() { document.getElementById('loadingOverlay').classList.add('hidden'); }
