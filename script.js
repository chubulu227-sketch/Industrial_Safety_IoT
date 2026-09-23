/**
 * Industrial IoT Smart Monitoring Dashboard JavaScript
 * Real-Time Notification Monitoring System with State-Transition Filtering,
 * Persistence via LocalStorage, Nav Unread Badge Counter, and Live Telemetry API.
 */

// 1. Primary Sensor State Object (Starts at 0 / NORMAL / OFF / CLOSED)
const sensorData = {
    temperature: 0,
    humidity: 0,
    gas: 0,
    flame: "NORMAL",
    gasStatus: "NORMAL",
    motion: "NORMAL",
    vibration: "NORMAL",
    coolingFan: "OFF",
    exhaustFan: "OFF",
    mainGate: "CLOSED",
    emergencyGate: "CLOSED"
};

// 2. State-Transition Memory Tracker (Prevents duplicate notifications)
const previousState = {
    temperature: 0,
    humidity: 0,
    gas: 0,
    flame: "NORMAL",
    gasStatus: "NORMAL",
    motion: "NORMAL",
    vibration: "NORMAL",
    coolingFan: "OFF",
    exhaustFan: "OFF",
    mainGate: "CLOSED",
    emergencyGate: "CLOSED",
    gpsStatus: "WAITING",
    deviceStatus: "OFFLINE",
    deviceId: "ESP32-SAFETY-01",
    emergencyAlert: false,
    flameAlert: false,
    gasAlert: false,
    motionAlert: false,
    vibrationAlert: false
};

// Cross-Tab Notification Channel & Atomic Deduplication Engine
const CURRENT_TAB_ID = 'tab_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
const NOTIF_CHANNEL_NAME = 'scada_notification_channel';
let notifBroadcastChannel = null;

if (typeof BroadcastChannel !== 'undefined') {
    try {
        notifBroadcastChannel = new BroadcastChannel(NOTIF_CHANNEL_NAME);
        notifBroadcastChannel.onmessage = handleNotifBroadcastMessage;
    } catch (e) {
        console.warn('[Notifications] BroadcastChannel unavailable, using storage fallback:', e);
        notifBroadcastChannel = null;
    }
}

function claimOperationalEvent(eventDomain, eventKey) {
    if (!eventDomain || !eventKey) return false;
    try {
        const now = Date.now();
        const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem('scada_transition_keys_v1') : null;
        const transitions = raw ? JSON.parse(raw) : {};

        const existing = transitions[eventDomain];
        if (existing && existing.key === eventKey) {
            return false; // Already claimed by another tab or earlier
        }

        transitions[eventDomain] = {
            key: eventKey,
            tabId: CURRENT_TAB_ID,
            timestamp: now
        };

        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('scada_transition_keys_v1', JSON.stringify(transitions));
        }

        if (notifBroadcastChannel) {
            try {
                notifBroadcastChannel.postMessage({
                    type: 'CLAIM_EVENT',
                    domain: eventDomain,
                    key: eventKey,
                    tabId: CURRENT_TAB_ID,
                    timestamp: now
                });
            } catch (e) {}
        }
        return true;
    } catch (e) {
        return true;
    }
}

function syncTransitionStateLocally(domain, key) {
    if (!domain || !key) return;
    if (domain === 'FAN_COOLING') {
        previousState.coolingFan = (key === 'FAN|COOLING|ON') ? 'ON' : 'OFF';
    } else if (domain === 'FAN_EXHAUST') {
        previousState.exhaustFan = (key === 'FAN|EXHAUST|ON') ? 'ON' : 'OFF';
    } else if (domain === 'GATE_MAIN') {
        previousState.mainGate = (key === 'GATE|MAIN|OPEN') ? 'OPEN' : 'CLOSED';
    } else if (domain === 'GATE_EMERGENCY') {
        previousState.emergencyGate = (key === 'GATE|EMERGENCY|OPEN') ? 'OPEN' : 'CLOSED';
    } else if (domain === 'EMERGENCY_FLAME') {
        previousState.flameAlert = (key === 'ACTIVE');
        previousState.emergencyAlert = previousState.flameAlert || previousState.gasAlert || previousState.motionAlert || previousState.vibrationAlert;
    } else if (domain === 'EMERGENCY_GAS') {
        previousState.gasAlert = (key === 'ACTIVE');
        previousState.emergencyAlert = previousState.flameAlert || previousState.gasAlert || previousState.motionAlert || previousState.vibrationAlert;
    } else if (domain === 'EMERGENCY_MOTION') {
        previousState.motionAlert = (key === 'ACTIVE');
        previousState.emergencyAlert = previousState.flameAlert || previousState.gasAlert || previousState.motionAlert || previousState.vibrationAlert;
    } else if (domain === 'EMERGENCY_VIBRATION') {
        previousState.vibrationAlert = (key === 'ACTIVE');
        previousState.emergencyAlert = previousState.flameAlert || previousState.gasAlert || previousState.motionAlert || previousState.vibrationAlert;
    } else if (domain === 'EMERGENCY') {
        if (key === 'EMERGENCY|RECOVERY') {
            previousState.emergencyAlert = false;
            previousState.flameAlert = false;
            previousState.gasAlert = false;
            previousState.motionAlert = false;
            previousState.vibrationAlert = false;
        } else {
            previousState.emergencyAlert = true;
            if (key.includes('FLAME')) previousState.flameAlert = true;
            if (key.includes('GAS')) previousState.gasAlert = true;
            if (key.includes('MOTION')) previousState.motionAlert = true;
            if (key.includes('VIBRATION')) previousState.vibrationAlert = true;
        }
    } else if (domain === 'SYSTEM') {
        previousState.deviceStatus = (key === 'SYSTEM|ONLINE') ? 'ONLINE' : 'OFFLINE';
    }
}

// 3. GPS State Object (Initial state: WAITING FOR GPS)
const gpsState = {
    status: "WAITING",
    latitude: null,
    longitude: null,
    altitude: null,
    speed: null,
    satellites: null
};

// 4. Notifications Storage Array & Filter State
let notifications = [];
let currentNotifFilter = "ALL";

// 5. Employee Attendance Data Model
const currentDateKey = new Date().toISOString().split('T')[0];

const attendanceData = [
    {
        empId: "EMP001",
        name: "Alex Rivera",
        role: "Operator",
        date: currentDateKey,
        inTime: "08:42 AM",
        outTime: "05:31 PM"
    },
    {
        empId: "EMP002",
        name: "Marcus Chen",
        role: "Technician",
        date: currentDateKey,
        inTime: "08:55 AM",
        outTime: "--"
    }
];

function loadAttendanceData() {
    try {
        const saved = localStorage.getItem('scada_attendance_v1');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
                attendanceData.length = 0;
                parsed.forEach(item => attendanceData.push(item));
            }
        }
    } catch (e) {
        console.error('Failed to load attendance from localStorage:', e);
    }
}

function saveAttendanceData() {
    try {
        localStorage.setItem('scada_attendance_v1', JSON.stringify(attendanceData));
    } catch (e) {
        console.error('Failed to save attendance to localStorage:', e);
    }
}

// Sensor Ranges
const SENSOR_RANGES = {
    temp: { min: 0, max: 60 },
    humidity: { min: 0, max: 100 },
    gas: { min: 0, max: 4100 }
};

// Real Live History Telemetry Buffer (Last 24 Hours)
let sensorHistory = [];
const MAX_HISTORY_POINTS = 200;

function loadSensorHistory() {
    try {
        const saved = localStorage.getItem('scada_sensor_history_v1');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
                sensorHistory.length = 0;
                parsed.forEach(p => sensorHistory.push(p));
            }
        }
    } catch (e) {
        console.error('Failed to load sensor history from localStorage:', e);
    }
}

function saveSensorHistory() {
    try {
        localStorage.setItem('scada_sensor_history_v1', JSON.stringify(sensorHistory));
    } catch (e) {
        console.error('Failed to save sensor history to localStorage:', e);
    }
}

// Device Online/Offline State & Timing (Driven by central TelemetryManager)
let lastDataReceivedAt = 0;
const DEVICE_OFFLINE_TIMEOUT = 10000;
let currentDeviceStatus = "OFFLINE";

// Chart.js & Leaflet Instances
let tempChart = null;
let humidityChart = null;
let gasChart = null;
let historyChart = null;
let leafletMap = null;
let leafletMarker = null;

// DOM Load Initialization
document.addEventListener('DOMContentLoaded', () => {
    migrateNotificationHistory();
    loadNotifications();
    loadAttendanceData();
    loadSensorHistory();
    initDigitalClock();
    initGaugeCharts();
    initLeafletMap();
    initHistoryChart();
    updateDashboard();
    renderAttendanceTable();
    setupModalHandlers();
    setupNotificationHandlers();
    setupAttendanceScanSimulation();
    initBrowserGeolocationFallback();
    initSidebarResponsive();
    ensureEmergencyOverlay();

    // Attach to Central TelemetryManager
    if (typeof window !== 'undefined' && window.TelemetryManager) {
        window.TelemetryManager.onStatusChange((status, deviceId, isNewTransition) => {
            const actualTransition = (previousState.deviceStatus !== status);
            currentDeviceStatus = status;
            previousState.deviceStatus = status;
            setDeviceStatusUI(status);

            if (isNewTransition && actualTransition) {
                if (status === 'ONLINE') {
                    if (claimOperationalEvent('SYSTEM', 'SYSTEM|ONLINE')) {
                        addNotification("SYSTEM_ONLINE", "SYSTEM ONLINE", `${deviceId} is back online.`, "SUCCESS", deviceId, "SYSTEM");
                    }
                } else {
                    if (claimOperationalEvent('SYSTEM', 'SYSTEM|OFFLINE')) {
                        addNotification("SYSTEM_OFFLINE", "SYSTEM OFFLINE", `${deviceId} has stopped sending data.`, "CRITICAL", deviceId, "SYSTEM");
                    }
                }
            }
        });

        window.TelemetryManager.subscribe((data) => {
            applyTelemetryToUI(data);
        });

        const initialStatus = window.TelemetryManager.getDeviceStatus();
        currentDeviceStatus = initialStatus;
        previousState.deviceStatus = initialStatus;
        setDeviceStatusUI(initialStatus);

        const cached = window.TelemetryManager.getLatestTelemetry();
        if (cached) {
            applyTelemetryToUI(cached);
        }
    } else {
        setDeviceStatusUI(currentDeviceStatus);
    }
});

/* -------------------------------------------------------------
 * DIGITAL CLOCK
 * ------------------------------------------------------------- */
function initDigitalClock() {
    const clockEl = document.getElementById('digitalClock');
    
    function updateClock() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const dateStr = now.toISOString().split('T')[0];
        
        if (clockEl) {
            clockEl.innerHTML = `
                <span class="clock-time">${timeStr}</span>
                <span class="clock-date">${dateStr}</span>
            `;
        }

        // Live Relative Telemetry Update & Dynamic Editorial Greeting
        const greetingEl = document.getElementById('pageGreeting');
        if (greetingEl) {
            const hour = now.getHours();
            if (hour >= 5 && hour < 12) {
                greetingEl.innerText = "Good morning";
            } else if (hour >= 12 && hour < 17) {
                greetingEl.innerText = "Good afternoon";
            } else {
                greetingEl.innerText = "Good evening";
            }
        }

        const relEl = document.getElementById('lastUpdateRelative');
        if (relEl) {
            if (lastDataReceivedAt === 0) {
                relEl.innerText = "Awaiting initial telemetry";
            } else {
                const sec = Math.max(0, Math.floor((Date.now() - lastDataReceivedAt) / 1000));
                if (sec < 2) {
                    relEl.innerText = "Just now";
                } else {
                    relEl.innerText = `${sec} sec ago`;
                }
            }
        }
    }
    
    updateClock();
    setInterval(updateClock, 1000);
}

/* -------------------------------------------------------------
 * CHART.JS GAUGE INITIALIZATION (Start cleanly at 0)
 * ------------------------------------------------------------- */
function initGaugeCharts() {
    const tempCanvas = document.getElementById('tempGaugeCanvas');
    const humCanvas = document.getElementById('humidityGaugeCanvas');
    const gasCanvas = document.getElementById('gasGaugeCanvas');

    if (!tempCanvas && !humCanvas && !gasCanvas) return;

    const getGaugeOptions = () => ({
        rotation: 270,
        circumference: 180,
        cutout: '76%',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            tooltip: { enabled: false },
            legend: { display: false }
        },
        animation: {
            duration: 600,
            easing: 'easeOutQuart'
        }
    });

    const neutralTrack = 'rgba(255, 255, 255, 0.07)';

    // 1. Temperature Gauge (Calm warm amber)
    if (tempCanvas) {
        const ctxTemp = tempCanvas.getContext('2d');
        tempChart = new Chart(ctxTemp, {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [0, SENSOR_RANGES.temp.max],
                    backgroundColor: ['#F59E0B', neutralTrack],
                    borderWidth: 0,
                    borderRadius: [4, 0]
                }]
            },
            options: getGaugeOptions()
        });
    }

    // 2. Humidity Gauge (Calm precision cyan/blue)
    if (humCanvas) {
        const ctxHum = humCanvas.getContext('2d');
        humidityChart = new Chart(ctxHum, {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [0, SENSOR_RANGES.humidity.max],
                    backgroundColor: ['#0284C7', neutralTrack],
                    borderWidth: 0,
                    borderRadius: [4, 0]
                }]
            },
            options: getGaugeOptions()
        });
    }

    // 3. Gas Concentration Gauge (Range 0-4100 ppm)
    if (gasCanvas) {
        const ctxGas = gasCanvas.getContext('2d');
        gasChart = new Chart(ctxGas, {
            type: 'doughnut',
            data: {
                datasets: [
                    {
                        data: [0, SENSOR_RANGES.gas.max],
                        backgroundColor: ['#6366F1', neutralTrack],
                        borderWidth: 0,
                        borderRadius: [4, 0]
                    },
                    {
                        data: [2500, 1000, 600],
                        backgroundColor: [
                            'rgba(99, 102, 241, 0.12)',
                            'rgba(245, 158, 11, 0.15)',
                            'rgba(239, 68, 68, 0.18)'
                        ],
                        borderWidth: 1,
                        borderColor: 'rgba(255, 255, 255, 0.04)',
                        weight: 0.25
                    }
                ]
            },
            options: getGaugeOptions()
        });
    }
}

function getGasArcColor(gasVal, defaultGrad) {
    if (gasVal > 3500) return '#EF4444'; // Critical
    if (gasVal > 2500) return '#F59E0B'; // Warning
    return defaultGrad || '#6366F1';     // Normal
}

/* -------------------------------------------------------------
 * REAL-TIME NOTIFICATION SYSTEM FUNCTIONS
 * ------------------------------------------------------------- */
const ALLOWED_NOTIFICATION_TITLES = new Set([
    "SYSTEM ONLINE",
    "SYSTEM OFFLINE",
    "EMERGENCY ALERT",
    "SYSTEM RECOVERY",
    "FAN STATUS",
    "GATE STATUS",
    "EMPLOYEE IN",
    "EMPLOYEE OUT"
]);

const ALLOWED_NOTIFICATION_CATEGORIES = new Set([
    "SYSTEM",
    "EMERGENCY",
    "EQUIPMENT",
    "EMPLOYEE"
]);

function getCategoryForNotification(type, title) {
    const tit = (title || "").trim().toUpperCase();
    if (tit === "EMERGENCY ALERT") return "EMERGENCY";
    if (tit === "FAN STATUS" || tit === "GATE STATUS") return "EQUIPMENT";
    if (tit === "EMPLOYEE IN" || tit === "EMPLOYEE OUT") return "EMPLOYEE";
    if (tit === "SYSTEM ONLINE" || tit === "SYSTEM OFFLINE" || tit === "SYSTEM RECOVERY") return "SYSTEM";

    const t = (type || "").toUpperCase();
    if (t.includes("EMERGENCY") || t.includes("FLAME") || t.includes("PIR") || t.includes("MOTION") || t.includes("VIBRATION")) return "EMERGENCY";
    if (t.includes("FAN") || t.includes("GATE")) return "EQUIPMENT";
    if (t.includes("EMPLOYEE")) return "EMPLOYEE";
    if (t.includes("SYSTEM") || t.includes("DEVICE")) return "SYSTEM";
    return "SYSTEM";
}

function getStandardTypeForTitle(title) {
    switch (title) {
        case "SYSTEM ONLINE": return "SYSTEM_ONLINE";
        case "SYSTEM OFFLINE": return "SYSTEM_OFFLINE";
        case "EMERGENCY ALERT": return "EMERGENCY_ALERT";
        case "SYSTEM RECOVERY": return "SYSTEM_RECOVERY";
        case "FAN STATUS": return "FAN_STATUS";
        case "GATE STATUS": return "GATE_STATUS";
        case "EMPLOYEE IN": return "EMPLOYEE_IN";
        case "EMPLOYEE OUT": return "EMPLOYEE_OUT";
        default: return "SYSTEM_NOTIFICATION";
    }
}

function getStandardSeverityForTitle(title) {
    switch (title) {
        case "SYSTEM ONLINE": return "SUCCESS";
        case "SYSTEM OFFLINE": return "CRITICAL";
        case "EMERGENCY ALERT": return "CRITICAL";
        case "SYSTEM RECOVERY": return "SUCCESS";
        case "FAN STATUS": return "INFO";
        case "GATE STATUS": return "WARNING";
        case "EMPLOYEE IN": return "INFO";
        case "EMPLOYEE OUT": return "INFO";
        default: return "INFO";
    }
}

function isAllowedNotification(n) {
    if (!n || typeof n !== 'object') return false;
    const title = (n.title || '').trim().toUpperCase();
    if (!ALLOWED_NOTIFICATION_TITLES.has(title)) {
        return false;
    }
    const cat = (n.category || '').trim().toUpperCase();
    if (!ALLOWED_NOTIFICATION_CATEGORIES.has(cat)) {
        return false;
    }
    const type = (n.type || '').trim().toUpperCase();
    if (
        type.startsWith('TEMP_') || type.startsWith('GPS_') ||
        type === 'DEVICE_ONLINE' || type === 'DEVICE_OFFLINE' ||
        type === 'GAS_NORMAL' || type === 'GAS_WARNING' || type === 'GAS_CRITICAL' ||
        type === 'FLAME_NORMAL' || type === 'FLAME_ALERT' ||
        type === 'MAIN_GATE_OPEN' || type === 'MAIN_GATE_CLOSED' ||
        type === 'EXHAUST_FAN_ON' || type === 'EXHAUST_FAN_OFF'
    ) {
        return false;
    }
    return true;
}

function convertLegacyNotification(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const rawType = (raw.type || '').toUpperCase();
    const rawTitle = (raw.title || '').toUpperCase();
    const rawMsg = (raw.message || '').toUpperCase();

    // 1. Immediately discard invalid legacy telemetry & continuous sensor noise
    if (
        rawType.startsWith('TEMP') || rawTitle.includes('TEMP') || rawMsg.includes('TEMPERATURE') ||
        rawType.startsWith('HUMIDITY') || rawTitle.includes('HUMIDITY') ||
        rawType.startsWith('GPS') || rawTitle.includes('GPS') ||
        rawType.includes('GAS_NORMAL') || rawTitle.includes('GAS NORMAL') || rawMsg.includes('GAS CONCENTRATION RETURNED') ||
        rawType.includes('GAS_WARNING') || rawTitle.includes('GAS WARNING') ||
        rawType.includes('GAS_CRITICAL') || rawTitle.includes('GAS CRITICAL')
    ) {
        return null;
    }

    // If it is already in the new operational format:
    const cleanTitle = (raw.title || '').trim().toUpperCase();
    if (ALLOWED_NOTIFICATION_TITLES.has(cleanTitle)) {
        const cat = (raw.category || getCategoryForNotification(raw.type, raw.title) || '').trim().toUpperCase();
        if (ALLOWED_NOTIFICATION_CATEGORIES.has(cat)) {
            return {
                id: raw.id || (Date.now() + Math.floor(Math.random() * 100000)),
                type: raw.type && !raw.type.startsWith('TEMP') && !raw.type.startsWith('GPS') && raw.type !== 'DEVICE_ONLINE' && raw.type !== 'DEVICE_OFFLINE'
                    ? raw.type
                    : getStandardTypeForTitle(cleanTitle),
                category: cat,
                title: cleanTitle,
                message: raw.message || `${cleanTitle} recorded.`,
                timestamp: raw.timestamp || new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                date: raw.date || new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
                severity: (raw.severity || getStandardSeverityForTitle(cleanTitle)).toUpperCase(),
                device: raw.device || 'ESP32-SAFETY-01',
                status: raw.status === 'READ' ? 'READ' : 'NEW'
            };
        }
    }

    // 2. Map legacy operational events to new category & title
    let category = null;
    let title = null;
    let type = null;
    let severity = (raw.severity || 'INFO').toUpperCase();

    if (rawType.includes('ONLINE') || rawTitle.includes('ONLINE') || rawTitle.includes('CONNECTED')) {
        category = 'SYSTEM';
        title = 'SYSTEM ONLINE';
        type = 'SYSTEM_ONLINE';
        severity = 'SUCCESS';
    } else if (rawType.includes('OFFLINE') || rawTitle.includes('OFFLINE') || rawTitle.includes('DISCONNECTED') || rawMsg.includes('STOPPED SENDING')) {
        category = 'SYSTEM';
        title = 'SYSTEM OFFLINE';
        type = 'SYSTEM_OFFLINE';
        severity = 'CRITICAL';
    } else if (rawType.includes('RECOVERY') || rawTitle.includes('RECOVERY') || rawMsg.includes('RETURNED TO NORMAL')) {
        category = 'SYSTEM';
        title = 'SYSTEM RECOVERY';
        type = 'SYSTEM_RECOVERY';
        severity = 'SUCCESS';
    } else if (rawType.includes('FLAME') || rawTitle.includes('FLAME')) {
        category = 'EMERGENCY';
        title = 'EMERGENCY ALERT';
        type = 'EMERGENCY_FLAME';
        severity = 'CRITICAL';
    } else if (rawType.includes('GAS_HIGH') || rawMsg.includes('HIGH GAS')) {
        category = 'EMERGENCY';
        title = 'EMERGENCY ALERT';
        type = 'EMERGENCY_GAS';
        severity = 'CRITICAL';
    } else if (rawType.includes('MOTION') || rawType.includes('PIR') || rawTitle.includes('MOTION') || rawMsg.includes('MOTION')) {
        category = 'EMERGENCY';
        title = 'EMERGENCY ALERT';
        type = 'EMERGENCY_MOTION';
        severity = 'CRITICAL';
    } else if (rawType.includes('VIBRATION') || rawTitle.includes('VIBRATION') || rawMsg.includes('VIBRATION')) {
        category = 'EMERGENCY';
        title = 'EMERGENCY ALERT';
        type = 'EMERGENCY_VIBRATION';
        severity = 'CRITICAL';
    } else if (rawType.includes('EMERGENCY') || rawTitle.includes('EMERGENCY')) {
        category = 'EMERGENCY';
        title = 'EMERGENCY ALERT';
        type = 'EMERGENCY_ALERT';
        severity = 'CRITICAL';
    } else if (rawType.includes('FAN') || rawTitle.includes('FAN')) {
        category = 'EQUIPMENT';
        title = 'FAN STATUS';
        type = 'FAN_STATUS';
        severity = 'INFO';
    } else if (rawType.includes('GATE') || rawTitle.includes('GATE')) {
        category = 'EQUIPMENT';
        title = 'GATE STATUS';
        type = 'GATE_STATUS';
        if (rawTitle.includes('EMERGENCY') || rawMsg.includes('EMERGENCY')) {
            severity = 'CRITICAL';
        } else if (severity !== 'SUCCESS' && severity !== 'CRITICAL') {
            severity = 'WARNING';
        }
    } else if (rawType.includes('EMPLOYEE_IN') || rawTitle.includes('EMPLOYEE IN') || (rawTitle.includes('EMPLOYEE') && rawMsg.includes('ENTERED'))) {
        category = 'EMPLOYEE';
        title = 'EMPLOYEE IN';
        type = 'EMPLOYEE_IN';
        severity = 'INFO';
    } else if (rawType.includes('EMPLOYEE_OUT') || rawTitle.includes('EMPLOYEE OUT') || (rawTitle.includes('EMPLOYEE') && rawMsg.includes('EXITED'))) {
        category = 'EMPLOYEE';
        title = 'EMPLOYEE OUT';
        type = 'EMPLOYEE_OUT';
        severity = 'INFO';
    }

    if (!category || !title || !type) {
        return null; // Cannot be safely mapped
    }

    const converted = {
        id: raw.id || (Date.now() + Math.floor(Math.random() * 100000)),
        type: type,
        category: category,
        title: title,
        message: raw.message || `${title} recorded.`,
        timestamp: raw.timestamp || new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        date: raw.date || new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        severity: severity,
        device: raw.device || 'ESP32-SAFETY-01',
        status: raw.status === 'READ' ? 'READ' : 'NEW'
    };

    return isAllowedNotification(converted) ? converted : null;
}

function migrateNotificationHistory() {
    try {
        if (typeof localStorage === 'undefined') return;
        const saved = localStorage.getItem('scada_notifications_v1');
        if (!saved) return;

        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
            const cleaned = [];
            const seenIds = new Set();
            for (const item of parsed) {
                const converted = convertLegacyNotification(item);
                if (converted && !seenIds.has(converted.id)) {
                    seenIds.add(converted.id);
                    cleaned.push(converted);
                }
            }
            notifications = cleaned;
            localStorage.setItem('scada_notifications_v1', JSON.stringify(cleaned));
            if (typeof window !== 'undefined') {
                window.notifications = notifications;
            }
            updateNotificationBadgeCount();
            renderNotifications();
        }
    } catch (e) {
        console.error('[Notifications] Migration error:', e);
    }
}

function handleNotifBroadcastMessage(event) {
    if (!event || !event.data) return;
    const msg = event.data;
    if (msg.type === 'NEW_NOTIFICATION' && msg.notification) {
        if (!isAllowedNotification(msg.notification)) return;
        const exists = notifications.some(n => n.id === msg.notification.id);
        if (!exists) {
            notifications.unshift(msg.notification);
            updateNotificationBadgeCount();
            renderNotifications();
        }
    } else if (msg.type === 'MARK_READ' && msg.id) {
        const notif = notifications.find(n => n.id === msg.id);
        if (notif && notif.status === 'NEW') {
            notif.status = 'READ';
            updateNotificationBadgeCount();
            renderNotifications();
        }
    } else if (msg.type === 'MARK_ALL_READ') {
        notifications.forEach(n => n.status = 'READ');
        updateNotificationBadgeCount();
        renderNotifications();
    } else if (msg.type === 'CLEAR_NOTIFICATIONS') {
        notifications = [];
        updateNotificationBadgeCount();
        renderNotifications();
    } else if (msg.type === 'CLAIM_EVENT') {
        syncTransitionStateLocally(msg.domain, msg.key);
    } else if (msg.type === 'DISMISS_EMERGENCY_INCIDENT') {
        const overlay = document.getElementById('liveEmergencyOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    } else if (msg.type === 'RECOVER_EMERGENCY_INCIDENT') {
        const overlay = document.getElementById('liveEmergencyOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    } else if (msg.type === 'START_EMERGENCY_INCIDENT') {
        const popupState = getEmergencyPopupState();
        if (!popupState.dismissed && previousState.emergencyAlert) {
            const overlay = document.getElementById('liveEmergencyOverlay');
            if (overlay) {
                overlay.style.display = 'block';
            }
        }
    }
}

function loadNotifications() {
    try {
        const saved = (typeof localStorage !== 'undefined') ? localStorage.getItem('scada_notifications_v1') : null;
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
                const cleaned = [];
                const seenIds = new Set();
                let modified = false;
                for (const item of parsed) {
                    const converted = convertLegacyNotification(item);
                    if (converted && !seenIds.has(converted.id)) {
                        seenIds.add(converted.id);
                        cleaned.push(converted);
                        if (!item.category || item.category !== converted.category || item.title !== converted.title) {
                            modified = true;
                        }
                    } else {
                        modified = true;
                    }
                }
                notifications = cleaned;
                if (typeof localStorage !== 'undefined' && (modified || cleaned.length !== parsed.length)) {
                    localStorage.setItem('scada_notifications_v1', JSON.stringify(cleaned));
                }
            } else {
                notifications = [];
            }
        } else {
            notifications = [];
        }
    } catch (e) {
        console.error('Failed to load notifications from localStorage:', e);
        notifications = [];
    }
    if (typeof window !== 'undefined') {
        window.notifications = notifications;
    }
    updateNotificationBadgeCount();
}

function saveNotifications() {
    try {
        localStorage.setItem('scada_notifications_v1', JSON.stringify(notifications));
    } catch (e) {
        console.error('Failed to save notifications to localStorage:', e);
    }
    if (typeof window !== 'undefined') {
        window.notifications = notifications;
    }
    updateNotificationBadgeCount();
}

function addNotification(type, title, message, severity = "INFO", device = "ESP32-SAFETY-01", category = null, broadcast = true) {
    if (typeof category === 'boolean') {
        broadcast = category;
        category = null;
    }
    const cleanTitle = (title || "").trim().toUpperCase();
    if (!ALLOWED_NOTIFICATION_TITLES.has(cleanTitle)) {
        console.warn(`[Notifications] Blocked non-operational notification: "${title}"`);
        return;
    }

    const assignedCategory = (category || getCategoryForNotification(type, title) || "").trim().toUpperCase();
    if (!ALLOWED_NOTIFICATION_CATEGORIES.has(assignedCategory)) {
        console.warn(`[Notifications] Blocked notification with invalid category: "${assignedCategory}"`);
        return;
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    const newNotif = {
        id: Date.now() + Math.floor(Math.random() * 100000),
        type: type,
        category: assignedCategory,
        title: title,
        message: message,
        timestamp: timeStr,
        date: dateStr,
        severity: (severity || getStandardSeverityForTitle(cleanTitle)).toUpperCase(),
        device: device || "ESP32-SAFETY-01",
        status: "NEW"
    };

    if (!isAllowedNotification(newNotif)) {
        console.warn(`[Notifications] Blocked disallowed notification:`, newNotif);
        return;
    }

    // Check if ID already exists
    if (notifications.some(n => n.id === newNotif.id)) return;

    notifications.unshift(newNotif);
    saveNotifications();
    renderNotifications();

    if (broadcast && notifBroadcastChannel) {
        try {
            notifBroadcastChannel.postMessage({
                type: 'NEW_NOTIFICATION',
                notification: newNotif
            });
        } catch (e) {
            console.error('Failed to broadcast notification:', e);
        }
    }
}

function updateNotificationBadgeCount() {
    const validNotifications = notifications.filter(isAllowedNotification);
    const unreadCount = validNotifications.filter(n => n.status === "NEW").length;
    const badgeEl = document.getElementById('notifNavBadge');
    if (badgeEl) {
        badgeEl.innerText = unreadCount;
        badgeEl.style.display = unreadCount > 0 ? 'inline-block' : 'none';
    }
}

function markNotificationAsRead(id, broadcast = true) {
    const notif = notifications.find(n => n.id === id);
    if (notif && notif.status === "NEW") {
        notif.status = "READ";
        saveNotifications();
        renderNotifications();

        if (broadcast && notifBroadcastChannel) {
            try {
                notifBroadcastChannel.postMessage({
                    type: 'MARK_READ',
                    id: id
                });
            } catch (e) {}
        }
    }
}

function renderNotifications() {
    const listWrapper = document.getElementById('notificationList');
    if (!listWrapper) return;

    listWrapper.innerHTML = '';

    // Step 1: Filter STRICTLY to allowed operational notifications only
    const validNotifications = notifications.filter(isAllowedNotification);

    // Step 2: Active notification list: only show NEW/unread notifications
    const unreadNotifications = validNotifications.filter(n => n.status === "NEW");

    // Step 3: Filter by selected category tab (ALL, SYSTEM, EMERGENCY, EQUIPMENT, EMPLOYEE)
    const filtered = unreadNotifications.filter(n => {
        if (!currentNotifFilter || currentNotifFilter === "ALL") return true;
        return n.category === currentNotifFilter;
    });

    if (filtered.length === 0) {
        listWrapper.innerHTML = `
            <div style="text-align:center; padding: 40px 20px; color: var(--text-muted); font-size: 13px;">
                <i class="fa-solid fa-bell-slash" style="font-size: 32px; margin-bottom: 10px; color: var(--text-dim); display:block;"></i>
                No new operational notifications.
            </div>
        `;
        return;
    }

    filtered.forEach(item => {
        const itemEl = document.createElement('div');
        const severityClass = `severity-${item.severity.toLowerCase()}`;
        const unreadClass = item.status === "NEW" ? "unread" : "";
        const iconClass = getNotifIcon(item.type, item.severity);

        itemEl.className = `notif-item ${severityClass} ${unreadClass}`;
        itemEl.style.cursor = 'pointer';
        if (itemEl.setAttribute) itemEl.setAttribute('data-id', item.id);

        itemEl.innerHTML = `
            <div class="notif-icon-box">
                <i class="${iconClass}"></i>
            </div>
            <div class="notif-content">
                <div class="notif-header-row">
                    <span class="notif-item-title">${item.title}</span>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="severity-pill">${item.severity}</span>
                        <span class="mark-read-hint" title="Mark as read" style="font-size: 11px; color: var(--text-dim);"><i class="fa-solid fa-check"></i></span>
                    </div>
                </div>
                <div class="notif-item-msg">${item.message}</div>
                <div class="notif-meta-row">
                    <span class="notif-device-tag"><i class="fa-solid fa-microchip"></i> ${item.device}</span>
                    <span class="notif-time-tag"><i class="fa-regular fa-clock"></i> ${item.timestamp} &bull; ${item.date}</span>
                </div>
            </div>
        `;

        itemEl.addEventListener('click', () => {
            markNotificationAsRead(item.id);
        });

        listWrapper.appendChild(itemEl);
    });
}

function getNotifIcon(type, severity) {
    if (type.includes("FLAME")) return "fa-solid fa-fire";
    if (type.includes("GAS")) return "fa-solid fa-smog";
    if (type.includes("MOTION")) return "fa-solid fa-person-running";
    if (type.includes("VIBRATION")) return "fa-solid fa-wave-square";
    if (type.includes("FAN")) return "fa-solid fa-fan";
    if (type.includes("GATE")) return "fa-solid fa-door-open";
    if (type.includes("TEMP")) return "fa-solid fa-temperature-half";
    if (type.includes("HUMIDITY")) return "fa-solid fa-droplet";
    if (type.includes("GPS")) return "fa-solid fa-location-dot";
    if (type.includes("EMPLOYEE")) return "fa-solid fa-user-check";
    if (type.includes("DEVICE") || type.includes("SYSTEM")) return "fa-solid fa-server";
    
    if (severity === "CRITICAL") return "fa-solid fa-triangle-exclamation";
    if (severity === "WARNING") return "fa-solid fa-circle-exclamation";
    if (severity === "SUCCESS") return "fa-solid fa-circle-check";
    return "fa-solid fa-circle-info";
}

function setupNotificationHandlers() {
    // Filter Buttons
    document.querySelectorAll('.notif-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.notif-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentNotifFilter = btn.dataset.filter;
            renderNotifications();
        });
    });

    // Mark All Read
    const btnMarkAll = document.getElementById('btnMarkAllRead');
    if (btnMarkAll) {
        btnMarkAll.addEventListener('click', () => {
            notifications.forEach(n => n.status = "READ");
            saveNotifications();
            renderNotifications();
            if (notifBroadcastChannel) {
                try {
                    notifBroadcastChannel.postMessage({ type: 'MARK_ALL_READ' });
                } catch (e) {}
            }
        });
    }

    // Clear History
    const btnClearNotif = document.getElementById('btnClearNotifHistory');
    if (btnClearNotif) {
        btnClearNotif.addEventListener('click', () => {
            if (confirm("Are you sure you want to clear all notification history?")) {
                notifications = [];
                saveNotifications();
                renderNotifications();
                if (notifBroadcastChannel) {
                    try {
                        notifBroadcastChannel.postMessage({ type: 'CLEAR_NOTIFICATIONS' });
                    } catch (e) {}
                }
            }
        });
    }

    // Manual Event Test Buttons
    const btnFlame = document.getElementById('testEvFlame');
    if (btnFlame) {
        btnFlame.addEventListener('click', () => {
            processLiveData({ type: "industrial_sensor_data", flame: true, gas_high: false, pir: false, vibration: false, device_status: "ONLINE" });
        });
    }

    const btnGas = document.getElementById('testEvGas');
    if (btnGas) {
        btnGas.addEventListener('click', () => {
            processLiveData({ type: "industrial_sensor_data", flame: false, gas: 2850, gas_high: true, pir: false, vibration: false, device_status: "ONLINE" });
        });
    }

    const btnGate = document.getElementById('testEvGate');
    if (btnGate) {
        btnGate.addEventListener('click', () => {
            processLiveData({ type: "industrial_sensor_data", flame: false, gas_high: false, pir: false, vibration: false, main_gate: true, device_status: "ONLINE" });
        });
    }

    const btnNormal = document.getElementById('testEvNormal');
    if (btnNormal) {
        btnNormal.addEventListener('click', () => {
            processLiveData({
                type: "industrial_sensor_data",
                flame: false,
                gas: 120,
                gas_high: false,
                pir: false,
                vibration: false,
                main_gate: false,
                device_status: "ONLINE"
            });
        });
    }

    // Cross-tab notification sync fallback
    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('storage', (e) => {
            if (e.key === 'scada_notifications_v1') {
                loadNotifications();
                renderNotifications();
            } else if (e.key === 'scada_transition_keys_v1' && e.newValue) {
                try {
                    const trans = JSON.parse(e.newValue);
                    Object.keys(trans).forEach(domain => {
                        syncTransitionStateLocally(domain, trans[domain].key);
                    });
                } catch (err) {}
            } else if (e.key === 'scada_emergency_popup_state_v1' && e.newValue) {
                try {
                    const parsed = JSON.parse(e.newValue);
                    const overlay = document.getElementById('liveEmergencyOverlay');
                    if (overlay) {
                        if (parsed.dismissed || !parsed.active) {
                            overlay.style.display = 'none';
                        } else if (parsed.active && !parsed.dismissed && previousState.emergencyAlert) {
                            overlay.style.display = 'block';
                        }
                    }
                } catch (err) {}
            }
        });
    }
}

/* -------------------------------------------------------------
 * 1. SHARED TELEMETRY & DEVICE STATUS UI INTEGRATION
 * ------------------------------------------------------------- */
function setDeviceStatusUI(status) {
    const devEl = document.getElementById('headerDeviceStatus');
    const finalStatus = (status === 'ONLINE') ? 'ONLINE' : 'OFFLINE';

    // Synchronize KPI device status badge if present
    const kpiDevEl = document.getElementById('kpiDeviceStatus');
    if (kpiDevEl) {
        kpiDevEl.innerText = finalStatus;
        if (finalStatus === 'ONLINE') {
            kpiDevEl.classList.remove('status-offline');
            kpiDevEl.classList.add('status-online');
        } else {
            kpiDevEl.classList.remove('status-online');
            kpiDevEl.classList.add('status-offline');
        }
    }

    if (!devEl) return;
    devEl.innerText = finalStatus;
    const indicator = devEl.closest('.status-indicator');
    const dot = indicator ? indicator.querySelector('.status-dot') : null;

    if (finalStatus === 'ONLINE') {
        devEl.style.color = 'var(--green)';
        if (dot) {
            dot.style.backgroundColor = 'var(--green)';
            dot.style.boxShadow = '0 0 10px var(--green)';
        }
        if (indicator) {
            indicator.style.borderColor = 'rgba(34, 211, 167, 0.3)';
            indicator.style.background = 'rgba(34, 211, 167, 0.1)';
            indicator.classList.remove('offline');
            indicator.classList.add('online');
        }
    } else {
        // OFFLINE
        devEl.style.color = 'var(--red)';
        if (dot) {
            dot.style.backgroundColor = 'var(--red)';
            dot.style.boxShadow = '0 0 10px var(--red)';
        }
        if (indicator) {
            indicator.style.borderColor = 'rgba(255, 77, 103, 0.3)';
            indicator.style.background = 'rgba(255, 77, 103, 0.1)';
            indicator.classList.remove('online');
            indicator.classList.add('offline');
        }
    }
}

function setDeviceOnline(deviceName) {
    if (typeof window !== 'undefined' && window.TelemetryManager && window.TelemetryManager._setCurrentDeviceStatus) {
        window.TelemetryManager._setCurrentDeviceStatus("ONLINE");
    }
    const devId = deviceName || previousState.deviceId || "ESP32-SAFETY-01";
    if (currentDeviceStatus !== "ONLINE") {
        currentDeviceStatus = "ONLINE";
        previousState.deviceStatus = "ONLINE";
        setDeviceStatusUI("ONLINE");
        if (claimOperationalEvent('SYSTEM', 'SYSTEM|ONLINE')) {
            addNotification(
                "SYSTEM_ONLINE",
                "SYSTEM ONLINE",
                `${devId} is back online.`,
                "SUCCESS",
                devId,
                "SYSTEM"
            );
        }
    } else {
        setDeviceStatusUI("ONLINE");
    }
}

function setDeviceOffline() {
    if (typeof window !== 'undefined' && window.TelemetryManager && window.TelemetryManager._setCurrentDeviceStatus) {
        window.TelemetryManager._setCurrentDeviceStatus("OFFLINE");
    }
    const devId = previousState.deviceId || "ESP32-SAFETY-01";
    if (currentDeviceStatus !== "OFFLINE") {
        currentDeviceStatus = "OFFLINE";
        previousState.deviceStatus = "OFFLINE";
        setDeviceStatusUI("OFFLINE");
        if (claimOperationalEvent('SYSTEM', 'SYSTEM|OFFLINE')) {
            addNotification(
                "SYSTEM_OFFLINE",
                "SYSTEM OFFLINE",
                `${devId} has stopped sending data.`,
                "CRITICAL",
                devId,
                "SYSTEM"
            );
        }
    } else {
        setDeviceStatusUI("OFFLINE");
    }
}

function updateDeviceOnlineStatus(data) {
    const deviceName = (data && (data.device_id || data.deviceId)) || previousState.deviceId || "ESP32-SAFETY-01";
    previousState.deviceId = deviceName;
    const incomingStatus = data ? (data.device_status || data.deviceStatus) : null;
    if (incomingStatus === 'OFFLINE') {
        setDeviceOffline();
    } else {
        setDeviceOnline(deviceName);
    }
}

function initWebSocket() {
    // Delegated to TelemetryManager - no duplicate WebSockets created
    if (typeof window !== 'undefined' && window.TelemetryManager && window.TelemetryManager.init) {
        window.TelemetryManager.init();
    }
}

function checkDeviceConnectionStatus() {
    if (typeof window !== 'undefined' && window.TelemetryManager && window.TelemetryManager.checkDeviceConnectionStatus) {
        const status = window.TelemetryManager.checkDeviceConnectionStatus();
        currentDeviceStatus = status;
        previousState.deviceStatus = status;
        setDeviceStatusUI(status);
        return status;
    }
    const now = Date.now();
    if (lastDataReceivedAt === 0 || (now - lastDataReceivedAt > DEVICE_OFFLINE_TIMEOUT)) {
        if (currentDeviceStatus !== "OFFLINE") {
            setDeviceOffline();
        }
    } else {
        if (currentDeviceStatus !== "ONLINE") {
            setDeviceOnline();
        }
    }
    return currentDeviceStatus;
}

/* -------------------------------------------------------------
 * 2. EMERGENCY OVERLAY & ALERT CONTROLLER
 * ------------------------------------------------------------- */
const EMERGENCY_POPUP_STORAGE_KEY = 'scada_emergency_popup_state_v1';

function getEmergencyPopupState() {
    try {
        const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(EMERGENCY_POPUP_STORAGE_KEY) : null;
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                return {
                    incidentId: parsed.incidentId || null,
                    active: parsed.active === true,
                    dismissed: parsed.dismissed === true
                };
            }
        }
    } catch (e) {}
    return { incidentId: null, active: false, dismissed: false };
}

function saveEmergencyPopupState(state) {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(EMERGENCY_POPUP_STORAGE_KEY, JSON.stringify(state));
        }
    } catch (e) {}
}

function dismissEmergencyAlert() {
    let popupState = getEmergencyPopupState();
    popupState.dismissed = true;
    if (!popupState.incidentId) {
        popupState.incidentId = Date.now();
        popupState.active = true;
    }
    saveEmergencyPopupState(popupState);

    // Broadcast dismissal across all open tabs
    if (notifBroadcastChannel) {
        try {
            notifBroadcastChannel.postMessage({
                type: 'DISMISS_EMERGENCY_INCIDENT',
                incidentId: popupState.incidentId
            });
        } catch (e) {}
    }

    // Immediately hide visual popup on current page
    const overlay = document.getElementById('liveEmergencyOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}
window.dismissEmergencyAlert = dismissEmergencyAlert;
window.getEmergencyPopupState = getEmergencyPopupState;
window.saveEmergencyPopupState = saveEmergencyPopupState;

function ensureEmergencyOverlay() {
    let overlay = document.getElementById('liveEmergencyOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'liveEmergencyOverlay';
        overlay.style.position = 'fixed';
        overlay.style.top = '24px';
        overlay.style.left = '50%';
        overlay.style.transform = 'translateX(-50%)';
        overlay.style.zIndex = '99999';
        overlay.style.width = '90%';
        overlay.style.maxWidth = '520px';
        overlay.style.boxSizing = 'border-box';
        overlay.style.background = '#180B0D';
        overlay.style.border = '1px solid #ef4444';
        overlay.style.borderRadius = '10px';
        overlay.style.boxShadow = '0 12px 40px rgba(0, 0, 0, 0.8), 0 0 20px rgba(239, 68, 68, 0.25)';
        overlay.style.padding = '18px 22px';
        overlay.style.color = '#ffffff';
        overlay.style.fontFamily = "'Inter', -apple-system, sans-serif";
        overlay.style.display = 'none';
        overlay.style.backdropFilter = 'blur(12px)';
        overlay.style.webkitBackdropFilter = 'blur(12px)';
        overlay.style.animation = 'emergencyPulseGlow 2s infinite ease-in-out';
        overlay.style.transition = 'all 0.25s ease';

        if (!document.getElementById('emergencyKeyframesStyle')) {
            const style = document.createElement('style');
            style.id = 'emergencyKeyframesStyle';
            style.textContent = `
                @keyframes emergencyPulseGlow {
                    0% { border-color: #ef4444; }
                    50% { border-color: #ff6b7e; }
                    100% { border-color: #ef4444; }
                }
                .emergency-condition-pill {
                    background: rgba(239, 68, 68, 0.16);
                    border: 1px solid rgba(239, 68, 68, 0.4);
                    color: #fee2e2;
                    font-size: 12.5px;
                    font-weight: 700;
                    letter-spacing: 0.4px;
                    padding: 8px 14px;
                    border-radius: 6px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                #emergencyCloseBtn {
                    background: rgba(239, 68, 68, 0.2);
                    border: 1px solid rgba(239, 68, 68, 0.4);
                    color: #ffffff;
                    width: 32px;
                    height: 32px;
                    border-radius: 6px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    font-size: 14px;
                    line-height: 1;
                    transition: all 0.2s ease;
                    outline: none;
                    padding: 0;
                    flex-shrink: 0;
                    box-sizing: border-box;
                }
                #emergencyCloseBtn:hover {
                    background: rgba(239, 68, 68, 0.5) !important;
                    border-color: #ef4444 !important;
                    color: #ffffff !important;
                    transform: scale(1.05);
                }
                #emergencyCloseBtn:active {
                    transform: scale(0.95);
                }
                @media (max-width: 480px) {
                    #liveEmergencyOverlay {
                        top: 14px !important;
                        width: 94% !important;
                        padding: 12px 14px !important;
                    }
                    .emergency-header-badge {
                        display: none !important;
                    }
                    .emergency-title-main {
                        font-size: 14px !important;
                    }
                    .emergency-title-sub {
                        font-size: 10px !important;
                    }
                }
                @media (max-width: 360px) {
                    #liveEmergencyOverlay {
                        padding: 10px 12px !important;
                    }
                    #emergencyCloseBtn {
                        width: 28px !important;
                        height: 28px !important;
                        font-size: 12px !important;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        overlay.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(239, 68, 68, 0.3); padding-bottom: 12px; margin-bottom: 14px; gap: 8px;">
                <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
                    <span style="font-size: 24px; line-height: 1; flex-shrink: 0;">🚨</span>
                    <div style="min-width: 0;">
                        <div class="emergency-title-main" style="font-size: 16px; font-weight: 800; letter-spacing: 1px; color: #ff334b; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">EMERGENCY ALERT</div>
                        <div class="emergency-title-sub" style="font-size: 11px; font-weight: 600; color: #fca5a5; letter-spacing: 0.6px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">SAFETY CONDITION DETECTED</div>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                    <div class="emergency-header-badge" style="background: rgba(239, 68, 68, 0.25); border: 1px solid #ef4444; color: #ff4d67; font-size: 10px; font-weight: 800; padding: 4px 8px; border-radius: 6px; letter-spacing: 0.5px;">LIVE CRITICAL</div>
                    <button id="emergencyCloseBtn" aria-label="Close Emergency Alert" title="Dismiss Emergency Alert">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>
            <div id="emergencyConditionList" style="display: flex; flex-direction: column; gap: 8px;"></div>
        `;
        document.body.appendChild(overlay);

        const closeBtn = overlay.querySelector('#emergencyCloseBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dismissEmergencyAlert();
            });
        }
    }
    return overlay;
}

function updateEmergencyAlert(data) {
    if (!data) return;

    const flameActive = (data.flame === true || data.flame === "DANGER" || data.flame === "ALERT" || data.flame === "DETECTED" || data.flame === 1 || data.flame === "1");
    const gasActive = (data.gas_high === true || data.gas_high === "DANGER" || data.gas_high === "ALERT" || data.gas_high === "WARNING" || data.gas_high === 1 || data.gas_high === "1");
    const motionActive = (data.pir === true || data.pir === "DETECTED" || data.pir === "DANGER" || data.pir === 1 || data.pir === "1");
    const vibrationActive = (data.vibration === true || data.vibration === "DANGER" || data.vibration === "DETECTED" || data.vibration === "ALERT" || data.vibration === "WARNING" || data.vibration === 1 || data.vibration === "1");
    const deviceId = data.device_id || data.deviceId || "ESP32-SAFETY-01";

    const anyEmergencyActive = flameActive || gasActive || motionActive || vibrationActive;
    const overlay = ensureEmergencyOverlay();
    const listEl = document.getElementById('emergencyConditionList');

    let popupState = getEmergencyPopupState();

    if (anyEmergencyActive) {
        // STATE 2: At least one emergency condition is active
        if (!popupState.active) {
            // New emergency incident begins (NORMAL -> ANY EMERGENCY)
            popupState = {
                incidentId: Date.now(),
                active: true,
                dismissed: false
            };
            saveEmergencyPopupState(popupState);
            if (notifBroadcastChannel) {
                try {
                    notifBroadcastChannel.postMessage({
                        type: 'START_EMERGENCY_INCIDENT',
                        incidentId: popupState.incidentId
                    });
                } catch (e) {}
            }
        }

        const activeConditions = [];
        if (flameActive) activeConditions.push("🔥 FLAME DETECTED");
        if (gasActive) activeConditions.push("☣ HIGH GAS DETECTED");
        if (motionActive) activeConditions.push("👤 MOTION DETECTED");
        if (vibrationActive) activeConditions.push("⚠ VIBRATION DETECTED");

        if (listEl) {
            listEl.innerHTML = activeConditions
                .map(cond => `<div class="emergency-condition-pill">${cond}</div>`)
                .join('');
        }
        if (overlay) {
            overlay.style.display = popupState.dismissed ? 'none' : 'block';
        }
    } else {
        // STATE 1: ALL emergency conditions false (RECOVERY)
        if (popupState.active) {
            popupState = {
                incidentId: null,
                active: false,
                dismissed: false
            };
            saveEmergencyPopupState(popupState);
            if (notifBroadcastChannel) {
                try {
                    notifBroadcastChannel.postMessage({
                        type: 'RECOVER_EMERGENCY_INCIDENT'
                    });
                } catch (e) {}
            }
        }
        if (overlay) overlay.style.display = 'none';
        if (listEl) {
            listEl.innerHTML = '';
        }
    }

    // INDEPENDENT TRANSITION RULES (one condition NEVER suppresses another)
    // 1. FLAME: false -> true
    if (flameActive && !previousState.flameAlert) {
        if (claimOperationalEvent('EMERGENCY_FLAME', 'ACTIVE')) {
            addNotification(
                "EMERGENCY_FLAME",
                "EMERGENCY ALERT",
                "Flame detected by safety sensor.",
                "CRITICAL",
                deviceId,
                "EMERGENCY"
            );
        }
    } else if (!flameActive && previousState.flameAlert) {
        claimOperationalEvent('EMERGENCY_FLAME', 'INACTIVE');
    }

    // 2. HIGH GAS: false -> true
    if (gasActive && !previousState.gasAlert) {
        if (claimOperationalEvent('EMERGENCY_GAS', 'ACTIVE')) {
            addNotification(
                "EMERGENCY_GAS",
                "EMERGENCY ALERT",
                "High gas concentration detected.",
                "CRITICAL",
                deviceId,
                "EMERGENCY"
            );
        }
    } else if (!gasActive && previousState.gasAlert) {
        claimOperationalEvent('EMERGENCY_GAS', 'INACTIVE');
    }

    // 3. PIR / MOTION: false -> true
    if (motionActive && !previousState.motionAlert) {
        if (claimOperationalEvent('EMERGENCY_MOTION', 'ACTIVE')) {
            addNotification(
                "EMERGENCY_MOTION",
                "EMERGENCY ALERT",
                "Motion detected in monitored area.",
                "CRITICAL",
                deviceId,
                "EMERGENCY"
            );
        }
    } else if (!motionActive && previousState.motionAlert) {
        claimOperationalEvent('EMERGENCY_MOTION', 'INACTIVE');
    }

    // 4. VIBRATION: false -> true
    if (vibrationActive && !previousState.vibrationAlert) {
        if (claimOperationalEvent('EMERGENCY_VIBRATION', 'ACTIVE')) {
            addNotification(
                "EMERGENCY_VIBRATION",
                "EMERGENCY ALERT",
                "Abnormal vibration detected.",
                "CRITICAL",
                deviceId,
                "EMERGENCY"
            );
        }
    } else if (!vibrationActive && previousState.vibrationAlert) {
        claimOperationalEvent('EMERGENCY_VIBRATION', 'INACTIVE');
    }

    // EMERGENCY RECOVERY RULE:
    // ANY EMERGENCY -> NORMAL (only when ALL conditions are false)
    const previousAnyEmergency = previousState.emergencyAlert;
    if (previousAnyEmergency && !anyEmergencyActive) {
        if (claimOperationalEvent('EMERGENCY', 'EMERGENCY|RECOVERY')) {
            addNotification(
                "SYSTEM_RECOVERY",
                "SYSTEM RECOVERY",
                "Emergency condition returned to normal.",
                "SUCCESS",
                deviceId,
                "SYSTEM"
            );
        }
    } else if (anyEmergencyActive) {
        claimOperationalEvent('EMERGENCY', 'ACTIVE');
    }

    // Update memory tracker
    previousState.flameAlert = flameActive;
    previousState.gasAlert = gasActive;
    previousState.motionAlert = motionActive;
    previousState.vibrationAlert = vibrationActive;
    previousState.emergencyAlert = anyEmergencyActive;
}

function addHistoryData(data) {
    if (!data) return;
    const tempNum = Number(data.temperature);
    const humNum = Number(data.humidity);
    const gasNum = Number(data.gas);

    if (!isNaN(tempNum) && !isNaN(humNum) && !isNaN(gasNum) &&
        data.temperature !== undefined && data.humidity !== undefined && data.gas !== undefined) {
        const now = Date.now();
        sensorHistory.push({
            timestamp: now,
            temperature: tempNum,
            humidity: humNum,
            gas: gasNum
        });

        // Enforce strict 24-hour retention window
        const cutoff24h = now - (24 * 60 * 60 * 1000);
        while (sensorHistory.length > 0 && sensorHistory[0].timestamp < cutoff24h) {
            sensorHistory.shift();
        }

        while (sensorHistory.length > MAX_HISTORY_POINTS) {
            sensorHistory.shift();
        }

        saveSensorHistory();
        updateHistoryChartData();
    }
}

/* -------------------------------------------------------------
 * 3. CENTRALIZED LIVE DATA PROCESSOR & UI APPLIER
 * ------------------------------------------------------------- */
function applyTelemetryToUI(data) {
    if (!data) return;

    if (data.temperature !== undefined) updateTemperature(data.temperature);
    if (data.humidity !== undefined) updateHumidity(data.humidity);
    if (data.gas !== undefined) updateGas(data.gas);

    if (data.flame !== undefined) updateFlameStatus(data.flame);
    if (data.gas_high !== undefined) updateGasStatus(data.gas_high);
    else if (data.gasStatus !== undefined) updateGasStatus(data.gasStatus);

    if (data.pir !== undefined) updateMotionStatus(data.pir);
    else if (data.motion !== undefined) updateMotionStatus(data.motion);

    if (data.vibration !== undefined) updateVibrationStatus(data.vibration);

    if (data.cooling_fan !== undefined) updateCoolingFanStatus(data.cooling_fan);
    else if (data.coolingFan !== undefined) updateCoolingFanStatus(data.coolingFan);

    if (data.exhaust_fan !== undefined) updateExhaustFanStatus(data.exhaust_fan);
    else if (data.exhaustFan !== undefined) updateExhaustFanStatus(data.exhaustFan);

    if (data.main_gate !== undefined) updateMainGateStatus(data.main_gate);
    else if (data.mainGate !== undefined) updateMainGateStatus(data.mainGate);

    if (data.emergency_gate !== undefined) updateEmergencyGateStatus(data.emergency_gate);
    else if (data.emergencyGate !== undefined) updateEmergencyGateStatus(data.emergencyGate);

    // Keep existing emergency popup
    updateEmergencyAlert(data);

    // Keep existing history functionality
    addHistoryData(data);
}

function processLiveData(data) {
    if (!data || data.type !== "industrial_sensor_data") {
        return;
    }

    lastDataReceivedAt = Date.now();

    if (typeof window !== 'undefined' && window.TelemetryManager) {
        window.TelemetryManager.processLiveData(data);
    } else {
        updateDeviceOnlineStatus(data);
        applyTelemetryToUI(data);
    }
}

// Expose processLiveData, addNotification, and emergency alert globally
window.processLiveData = processLiveData;
window.addNotification = addNotification;
window.updateEmergencyAlert = updateEmergencyAlert;
window.setDeviceStatusUI = setDeviceStatusUI;
window.setDeviceOnline = setDeviceOnline;
window.setDeviceOffline = setDeviceOffline;
window.addHistoryData = addHistoryData;
window.sensorData = sensorData;
window.sensorHistory = sensorHistory;
try {
    Object.defineProperty(window, 'notifications', {
        get: () => notifications,
        set: (val) => { notifications = val; },
        configurable: true
    });
} catch (e) {
    window.notifications = notifications;
}
window.loadNotifications = loadNotifications;
window.renderNotifications = renderNotifications;
window.markNotificationAsRead = markNotificationAsRead;
window.isAllowedNotification = isAllowedNotification;
window.convertLegacyNotification = convertLegacyNotification;
window.migrateNotificationHistory = migrateNotificationHistory;

/* -------------------------------------------------------------
 * 3. MODULAR SENSOR UPDATE FUNCTIONS
 * ------------------------------------------------------------- */
function updateTemperature(val) {
    if (val === undefined || val === null) return;
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (isNaN(num)) return;
    sensorData.temperature = num;

    const tempEl = document.getElementById('tempValue');
    const formattedTemp = Number.isInteger(num) ? num : num.toFixed(1);
    if (tempEl) {
        tempEl.innerText = formattedTemp;
    }
    const kpiTemp = document.getElementById('kpiTempValue');
    if (kpiTemp) {
        kpiTemp.innerText = formattedTemp;
    }
    if (tempChart) {
        tempChart.data.datasets[0].data = [num, Math.max(0, SENSOR_RANGES.temp.max - num)];
        tempChart.update();
    }

    const tempPill = document.getElementById('tempStatus');
    if (tempPill) {
        if (num > 40) {
            tempPill.innerText = 'HIGH WARNING';
            tempPill.className = 'status-pill status-alert';
        } else if (num > 32) {
            tempPill.innerText = 'ELEVATED';
            tempPill.className = 'status-pill status-warning';
        } else {
            tempPill.innerText = 'NORMAL';
            tempPill.className = 'status-pill status-normal';
        }
    }
}

function updateHumidity(val) {
    if (val === undefined || val === null) return;
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (isNaN(num)) return;
    sensorData.humidity = num;

    const humEl = document.getElementById('humidityValue');
    const formattedHum = Math.round(num);
    if (humEl) {
        humEl.innerText = formattedHum;
    }
    const kpiHum = document.getElementById('kpiHumidityValue');
    if (kpiHum) {
        kpiHum.innerText = formattedHum;
    }
    if (humidityChart) {
        humidityChart.data.datasets[0].data = [num, Math.max(0, SENSOR_RANGES.humidity.max - num)];
        humidityChart.update();
    }
}

function updateGas(val) {
    if (val === undefined || val === null) return;
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (isNaN(num)) return;
    sensorData.gas = num;

    const gasEl = document.getElementById('gasValue');
    const formattedGas = Math.round(num);
    if (gasEl) {
        gasEl.innerText = formattedGas;
    }
    const kpiGas = document.getElementById('kpiGasValue');
    if (kpiGas) {
        kpiGas.innerText = formattedGas;
    }
    if (gasChart) {
        const currentGas = Math.min(Math.max(num, 0), SENSOR_RANGES.gas.max);
        const remainingGas = SENSOR_RANGES.gas.max - currentGas;

        gasChart.data.datasets[0].data = [currentGas, remainingGas];

        gasChart.data.datasets[0].backgroundColor[0] = getGasArcColor(currentGas, '#6366F1');
        gasChart.update();
    }

    const gasPill = document.getElementById('gasStatusPill');
    if (gasPill) {
        if (num > 3500) {
            gasPill.innerText = 'CRITICAL LEVEL';
            gasPill.className = 'status-pill status-alert';
        } else if (num > 2500) {
            gasPill.innerText = 'WARNING';
            gasPill.className = 'status-pill status-warning';
        } else {
            gasPill.innerText = 'NORMAL';
            gasPill.className = 'status-pill status-normal';
        }
    }
}

/* -------------------------------------------------------------
 * 4. STATUS CARD & SYSTEM STATUS FUNCTIONS
 * ------------------------------------------------------------- */
function updateFlameStatus(val) {
    if (val === undefined || val === null) return;
    const isDanger = val === true || val === "DANGER" || val === "ALERT" || val === "DETECTED";
    const statusText = isDanger ? "DANGER" : "NORMAL";
    sensorData.flame = statusText;

    const flameText = document.getElementById('flameStatus');
    const flameDot = document.getElementById('flameDot');
    const flameCard = document.getElementById('cardFlame');
    const iconBox = flameCard ? flameCard.querySelector('.card-icon-box') : null;

    if (flameText) {
        flameText.innerText = statusText;
        flameText.className = isDanger ? 'indicator-text text-alert' : 'indicator-text text-normal';
    }
    if (flameDot) {
        flameDot.className = isDanger ? 'indicator-dot red-dot' : 'indicator-dot green-dot';
    }
    if (iconBox) {
        iconBox.className = isDanger ? 'card-icon-box alert-icon' : 'card-icon-box normal-icon';
    }

    if (previousState.flame !== statusText) {
        previousState.flame = statusText;
    }
}

function updateGasStatus(val) {
    if (val === undefined || val === null) return;
    const isDanger = val === true || val === "DANGER" || val === "ALERT" || val === "WARNING";
    const statusText = isDanger ? "DANGER" : "NORMAL";
    sensorData.gasStatus = statusText;

    const gasText = document.getElementById('gasStatusText');
    const gasDot = document.getElementById('gasStatusDot');
    const gasCard = document.getElementById('cardGasStatus');
    const iconBox = gasCard ? gasCard.querySelector('.card-icon-box') : null;

    if (gasText) {
        gasText.innerText = statusText;
        gasText.className = isDanger ? 'indicator-text text-alert' : 'indicator-text text-normal';
    }
    if (gasDot) {
        gasDot.className = isDanger ? 'indicator-dot red-dot' : 'indicator-dot green-dot';
    }
    if (iconBox) {
        iconBox.className = isDanger ? 'card-icon-box alert-icon' : 'card-icon-box normal-icon';
    }

    if (previousState.gasStatus !== statusText) {
        previousState.gasStatus = statusText;
    }
}

function updateMotionStatus(val) {
    if (val === undefined || val === null) return;
    const isDetected = val === true || val === "DETECTED";
    const statusText = isDetected ? "DETECTED" : "NORMAL";
    sensorData.motion = statusText;

    const motionText = document.getElementById('motionStatus');
    const motionDot = document.getElementById('motionDot');
    const motionCard = document.getElementById('cardMotion');
    const iconBox = motionCard ? motionCard.querySelector('.card-icon-box') : null;

    if (motionText) {
        motionText.innerText = statusText;
        motionText.className = isDetected ? 'indicator-text text-amber' : 'indicator-text text-normal';
    }
    if (motionDot) {
        motionDot.className = isDetected ? 'indicator-dot amber-dot' : 'indicator-dot green-dot';
    }
    if (iconBox) {
        iconBox.className = isDetected ? 'card-icon-box warning-icon' : 'card-icon-box normal-icon';
    }

    if (previousState.motion !== statusText) {
        previousState.motion = statusText;
    }
}

function updateVibrationStatus(val) {
    if (val === undefined || val === null) return;
    const isDanger = val === true || val === "DANGER" || val === "DETECTED" || val === "WARNING";
    const statusText = isDanger ? "DANGER" : "NORMAL";
    sensorData.vibration = statusText;

    const vibrationText = document.getElementById('vibrationStatus');
    const vibrationDot = document.getElementById('vibrationDot');
    const vibrationCard = document.getElementById('cardVibration');
    const iconBox = vibrationCard ? vibrationCard.querySelector('.card-icon-box') : null;

    if (vibrationText) {
        vibrationText.innerText = statusText;
        vibrationText.className = isDanger ? 'indicator-text text-alert' : 'indicator-text text-normal';
    }
    if (vibrationDot) {
        vibrationDot.className = isDanger ? 'indicator-dot red-dot' : 'indicator-dot green-dot';
    }
    if (iconBox) {
        iconBox.className = isDanger ? 'card-icon-box alert-icon' : 'card-icon-box normal-icon';
    }

    if (previousState.vibration !== statusText) {
        previousState.vibration = statusText;
    }
}

function updateCoolingFanStatus(val) {
    if (val === undefined || val === null) return;
    const isOn = val === true || val === "ON";
    const statusText = isOn ? "ON" : "OFF";
    sensorData.coolingFan = statusText;

    const coolingFanIconBox = document.getElementById('coolingFanIconBox');
    const coolingFanIcon = document.getElementById('coolingFanIcon');
    const statusCoolingFan = document.getElementById('statusCoolingFan');
    const labelCoolingFan = document.getElementById('labelCoolingFan');
    const cardCooling = document.getElementById('controlCoolingFan');

    if (labelCoolingFan) labelCoolingFan.innerText = statusText;
    if (statusCoolingFan) {
        statusCoolingFan.className = isOn ? 'status-display-pill status-pill-on' : 'status-display-pill status-pill-off';
    }
    if (coolingFanIconBox) {
        coolingFanIconBox.className = isOn ? 'control-icon fan-active' : 'control-icon';
    }
    if (coolingFanIcon) {
        coolingFanIcon.className = isOn ? 'fa-solid fa-fan spin-anim' : 'fa-solid fa-fan';
    }
    if (cardCooling) {
        cardCooling.className = isOn ? 'control-card active-control' : 'control-card inactive-control';
    }

    if (previousState.coolingFan !== statusText) {
        if (isOn) {
            if (claimOperationalEvent('FAN_COOLING', 'FAN|COOLING|ON')) {
                addNotification("FAN_STATUS", "FAN STATUS", "Cooling Fan turned ON.", "INFO", "ESP32-SAFETY-01", "EQUIPMENT");
            }
        } else if (previousState.coolingFan === "ON") {
            if (claimOperationalEvent('FAN_COOLING', 'FAN|COOLING|OFF')) {
                addNotification("FAN_STATUS", "FAN STATUS", "Cooling Fan turned OFF.", "INFO", "ESP32-SAFETY-01", "EQUIPMENT");
            }
        }
        previousState.coolingFan = statusText;
    }
}

function updateExhaustFanStatus(val) {
    if (val === undefined || val === null) return;
    const isOn = val === true || val === "ON";
    const statusText = isOn ? "ON" : "OFF";
    sensorData.exhaustFan = statusText;

    const exhaustFanIconBox = document.getElementById('exhaustFanIconBox');
    const exhaustFanIcon = document.getElementById('exhaustFanIcon');
    const statusExhaustFan = document.getElementById('statusExhaustFan');
    const labelExhaustFan = document.getElementById('labelExhaustFan');
    const cardExhaust = document.getElementById('controlExhaustFan');

    if (labelExhaustFan) labelExhaustFan.innerText = statusText;
    if (statusExhaustFan) {
        statusExhaustFan.className = isOn ? 'status-display-pill status-pill-on' : 'status-display-pill status-pill-off';
    }
    if (exhaustFanIconBox) {
        exhaustFanIconBox.className = isOn ? 'control-icon fan-active' : 'control-icon';
    }
    if (exhaustFanIcon) {
        exhaustFanIcon.className = isOn ? 'fa-solid fa-wind spin-anim' : 'fa-solid fa-wind';
    }
    if (cardExhaust) {
        cardExhaust.className = isOn ? 'control-card active-control' : 'control-card inactive-control';
    }

    if (previousState.exhaustFan !== statusText) {
        if (isOn) {
            if (claimOperationalEvent('FAN_EXHAUST', 'FAN|EXHAUST|ON')) {
                addNotification("FAN_STATUS", "FAN STATUS", "Exhaust Fan turned ON.", "INFO", "ESP32-SAFETY-01", "EQUIPMENT");
            }
        } else if (previousState.exhaustFan === "ON") {
            if (claimOperationalEvent('FAN_EXHAUST', 'FAN|EXHAUST|OFF')) {
                addNotification("FAN_STATUS", "FAN STATUS", "Exhaust Fan turned OFF.", "INFO", "ESP32-SAFETY-01", "EQUIPMENT");
            }
        }
        previousState.exhaustFan = statusText;
    }
}

function updateMainGateStatus(val) {
    if (val === undefined || val === null) return;
    const isOpen = val === true || val === "OPEN";
    const statusText = isOpen ? "OPEN" : "CLOSED";
    sensorData.mainGate = statusText;

    const mainGateIconBox = document.getElementById('mainGateIconBox');
    const mainGateIcon = document.getElementById('mainGateIcon');
    const statusMainGate = document.getElementById('statusMainGate');
    const labelMainGate = document.getElementById('labelMainGate');
    const cardMainGate = document.getElementById('controlMainGate');

    if (labelMainGate) labelMainGate.innerText = statusText;
    if (statusMainGate) {
        statusMainGate.className = isOpen ? 'status-display-pill status-pill-open' : 'status-display-pill status-pill-closed';
    }
    if (mainGateIconBox) {
        mainGateIconBox.className = isOpen ? 'control-icon gate-active-icon' : 'control-icon gate-closed-icon';
    }
    if (mainGateIcon) {
        mainGateIcon.className = isOpen ? 'fa-solid fa-door-open' : 'fa-solid fa-door-closed';
    }
    if (cardMainGate) {
        cardMainGate.className = isOpen ? 'control-card active-control' : 'control-card inactive-control';
    }

    if (previousState.mainGate !== statusText) {
        if (isOpen) {
            if (claimOperationalEvent('GATE_MAIN', 'GATE|MAIN|OPEN')) {
                addNotification("GATE_STATUS", "GATE STATUS", "Main Gate opened.", "WARNING", "ESP32-SAFETY-01", "EQUIPMENT");
            }
        } else if (previousState.mainGate === "OPEN") {
            if (claimOperationalEvent('GATE_MAIN', 'GATE|MAIN|CLOSED')) {
                addNotification("GATE_STATUS", "GATE STATUS", "Main Gate closed.", "SUCCESS", "ESP32-SAFETY-01", "EQUIPMENT");
            }
        }
        previousState.mainGate = statusText;
    }
}

function updateEmergencyGateStatus(val) {
    if (val === undefined || val === null) return;
    const isOpen = val === true || val === "OPEN";
    const statusText = isOpen ? "OPEN" : "CLOSED";
    sensorData.emergencyGate = statusText;

    const emergencyGateIconBox = document.getElementById('emergencyGateIconBox');
    const emergencyGateIcon = document.getElementById('emergencyGateIcon');
    const statusEmergencyGate = document.getElementById('statusEmergencyGate');
    const labelEmergencyGate = document.getElementById('labelEmergencyGate');
    const cardEmergencyGate = document.getElementById('controlEmergencyGate');

    if (labelEmergencyGate) labelEmergencyGate.innerText = statusText;
    if (statusEmergencyGate) {
        statusEmergencyGate.className = isOpen ? 'status-display-pill status-pill-open' : 'status-display-pill status-pill-closed';
    }
    if (emergencyGateIconBox) {
        emergencyGateIconBox.className = isOpen ? 'control-icon gate-active-icon' : 'control-icon gate-closed-icon';
    }
    if (emergencyGateIcon) {
        emergencyGateIcon.className = isOpen ? 'fa-solid fa-door-open' : 'fa-solid fa-triangle-exclamation';
    }
    if (cardEmergencyGate) {
        cardEmergencyGate.className = isOpen ? 'control-card active-control' : 'control-card inactive-control';
    }

    if (previousState.emergencyGate !== statusText) {
        if (isOpen) {
            if (claimOperationalEvent('GATE_EMERGENCY', 'GATE|EMERGENCY|OPEN')) {
                addNotification("GATE_STATUS", "GATE STATUS", "Emergency Gate opened.", "CRITICAL", "ESP32-SAFETY-01", "EQUIPMENT");
            }
        } else if (previousState.emergencyGate === "OPEN") {
            if (claimOperationalEvent('GATE_EMERGENCY', 'GATE|EMERGENCY|CLOSED')) {
                addNotification("GATE_STATUS", "GATE STATUS", "Emergency Gate closed.", "SUCCESS", "ESP32-SAFETY-01", "EQUIPMENT");
            }
        }
        previousState.emergencyGate = statusText;
    }
}

function updateStatusCards() {
    updateFlameStatus(sensorData.flame);
    updateGasStatus(sensorData.gasStatus);
    updateMotionStatus(sensorData.motion);
    updateVibrationStatus(sensorData.vibration);
}

function updateSystemStatus() {
    updateCoolingFanStatus(sensorData.coolingFan);
    updateExhaustFanStatus(sensorData.exhaustFan);
    updateMainGateStatus(sensorData.mainGate);
    updateEmergencyGateStatus(sensorData.emergencyGate);
}

function updateDashboard() {
    updateTemperature(sensorData.temperature);
    updateHumidity(sensorData.humidity);
    updateGas(sensorData.gas);
    updateStatusCards();
    updateSystemStatus();
}

function receiveSensorData(data) {
    if (!data) return;
    processLiveData(data);
}

window.receiveSensorData = receiveSensorData;
window.updateSensorData = receiveSensorData;
window.updateTemperature = updateTemperature;
window.updateHumidity = updateHumidity;
window.updateGas = updateGas;
window.updateFlameStatus = updateFlameStatus;
window.updateGasStatus = updateGasStatus;
window.updateMotionStatus = updateMotionStatus;
window.updateVibrationStatus = updateVibrationStatus;
window.updateCoolingFanStatus = updateCoolingFanStatus;
window.updateExhaustFanStatus = updateExhaustFanStatus;
window.updateMainGateStatus = updateMainGateStatus;
window.updateEmergencyGateStatus = updateEmergencyGateStatus;
window.updateDashboard = updateDashboard;
window.initWebSocket = initWebSocket;

/* -------------------------------------------------------------
 * EMPLOYEE ATTENDANCE LOGIC
 * ------------------------------------------------------------- */
function recordAttendance(empId, name = "Employee", role = "Operator") {
    if (!empId) return;
    
    const todayStr = new Date().toISOString().split('T')[0];
    const timeStr = new Date().toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' });

    let existingRecord = attendanceData.find(item => item.empId === empId && item.date === todayStr);

    if (!existingRecord) {
        attendanceData.unshift({
            empId: empId.toUpperCase(),
            name: name,
            role: role,
            date: todayStr,
            inTime: timeStr,
            outTime: "--"
        });
        if (claimOperationalEvent('EMPLOYEE', `EMPLOYEE|${empId.toUpperCase()}|IN|${todayStr}`)) {
            addNotification("EMPLOYEE_IN", "EMPLOYEE IN", `${empId.toUpperCase()} - ${name} entered the plant.`, "INFO", "RFID-GATE-01", "EMPLOYEE");
        }
    } else if (existingRecord.outTime === "--") {
        existingRecord.outTime = timeStr;
        if (claimOperationalEvent('EMPLOYEE', `EMPLOYEE|${empId.toUpperCase()}|OUT|${todayStr}`)) {
            addNotification("EMPLOYEE_OUT", "EMPLOYEE OUT", `${empId.toUpperCase()} - ${name} exited the plant.`, "INFO", "RFID-GATE-01", "EMPLOYEE");
        }
    } else {
        console.log(`[ATTENDANCE] EMP ID ${empId} already completed attendance for date ${todayStr}.`);
        return;
    }

    saveAttendanceData();
    renderAttendanceTable();
}

function renderAttendanceTable() {
    const tbody = document.getElementById('attendanceTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    let presentCount = 0;
    let completedCount = 0;

    attendanceData.forEach(item => {
        if (item.outTime === "--") {
            presentCount++;
        } else {
            completedCount++;
        }

        const tr = document.createElement('tr');
        tr.className = 'employee-present-row';
        tr.innerHTML = `
            <td><span class="employee-present-badge">${item.empId}</span></td>
            <td><span class="employee-present-name">${item.name}</span></td>
            <td><span class="employee-present-role">${item.role}</span></td>
            <td><span class="employee-present-time-in"><i class="fa-solid fa-right-to-bracket"></i> ${item.inTime}</span></td>
            <td>
                ${item.outTime !== '--' 
                    ? `<span class="employee-present-time-out"><i class="fa-solid fa-right-from-bracket"></i> ${item.outTime}</span>` 
                    : `<span class="employee-present-time-pending">--</span>`}
            </td>
        `;
        tbody.appendChild(tr);
    });

    const presentEl = document.getElementById('statPresentCount');
    const completedEl = document.getElementById('statCompletedCount');
    const totalEl = document.getElementById('statTotalScans');

    if (presentEl) presentEl.innerText = presentCount;
    if (completedEl) completedEl.innerText = completedCount;
    if (totalEl) totalEl.innerText = attendanceData.length;

    const quickPresentEl = document.getElementById('quickPresentCount');
    const quickCompletedEl = document.getElementById('quickCompletedCount');
    const quickTotalEl = document.getElementById('quickTotalScans');

    if (quickPresentEl) quickPresentEl.innerText = presentCount;
    if (quickCompletedEl) quickCompletedEl.innerText = completedCount;
    if (quickTotalEl) quickTotalEl.innerText = attendanceData.length;
}

function setupAttendanceScanSimulation() {
    const btnScan = document.getElementById('btnSimulateScan');
    if (!btnScan) return;

    btnScan.addEventListener('click', () => {
        const idInput = document.getElementById('scanEmpId');
        const nameInput = document.getElementById('scanEmpName');
        const roleInput = document.getElementById('scanEmpRole');

        const empId = idInput ? idInput.value.trim() : '';
        const empName = (nameInput && nameInput.value.trim()) || 'Employee User';
        const empRole = (roleInput && roleInput.value.trim()) || 'Operator';

        if (!empId) {
            alert('Please enter an EMP ID (e.g. EMP001)');
            return;
        }

        recordAttendance(empId, empName, empRole);
        
        if (idInput) idInput.value = '';
        if (nameInput) nameInput.value = '';
        if (roleInput) roleInput.value = '';
    });
}

window.recordAttendance = recordAttendance;
window.renderAttendanceTable = renderAttendanceTable;

/* -------------------------------------------------------------
 * LIVE GPS MAP & TELEMETRY MODULE (Leaflet.js)
 * ------------------------------------------------------------- */
function initLeafletMap() {
    const mapContainer = document.getElementById('leafletGpsMap');
    if (!mapContainer || typeof L === 'undefined') return;

    leafletMap = L.map('leafletGpsMap', {
        center: [20.0, 0.0],
        zoom: 2,
        zoomControl: false,
        attributionControl: false
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd'
    }).addTo(leafletMap);
}

function updateGPSData(gpsData) {
    if (!gpsData) return;

    const previousStatus = gpsState.status;

    if (gpsData.latitude !== undefined && gpsData.longitude !== undefined) {
        gpsState.latitude = parseFloat(gpsData.latitude);
        gpsState.longitude = parseFloat(gpsData.longitude);
        gpsState.status = gpsData.status || "ONLINE";
    }

    if (gpsData.altitude !== undefined) gpsState.altitude = gpsData.altitude;
    if (gpsData.speed !== undefined) gpsState.speed = gpsData.speed;
    if (gpsData.satellites !== undefined) gpsState.satellites = gpsData.satellites;

    renderGPSUI();
}

function updateGPSStatus(statusStr) {
    gpsState.status = statusStr;
    renderGPSUI();
}

function renderGPSUI() {
    const badgeEl = document.getElementById('gpsStatusBadge');
    const textEl = document.getElementById('gpsStatusText');

    if (textEl) textEl.innerText = `GPS ${gpsState.status}`;
    if (badgeEl) {
        if (gpsState.status === 'ONLINE') {
            badgeEl.className = 'gps-badge gps-badge-online';
        } else if (gpsState.status === 'SIGNAL WEAK') {
            badgeEl.className = 'gps-badge gps-badge-weak';
        } else if (gpsState.status === 'OFFLINE') {
            badgeEl.className = 'gps-badge gps-badge-offline';
        } else {
            badgeEl.className = 'gps-badge gps-badge-waiting';
            if (textEl) textEl.innerText = 'WAITING FOR GPS';
        }
    }

    const latEl = document.getElementById('gpsLatVal');
    if (latEl) latEl.innerText = gpsState.latitude !== null ? `${gpsState.latitude.toFixed(4)}°` : '--';
    const lonEl = document.getElementById('gpsLonVal');
    if (lonEl) lonEl.innerText = gpsState.longitude !== null ? `${gpsState.longitude.toFixed(4)}°` : '--';
    const altEl = document.getElementById('gpsAltVal');
    if (altEl) altEl.innerText = gpsState.altitude !== null ? `${gpsState.altitude} m` : '-- m';
    const speedEl = document.getElementById('gpsSpeedVal');
    if (speedEl) speedEl.innerText = gpsState.speed !== null ? `${gpsState.speed} km/h` : '-- km/h';
    const satEl = document.getElementById('gpsSatVal');
    if (satEl) satEl.innerText = gpsState.satellites !== null ? `${gpsState.satellites}` : '--';

    if (leafletMap && gpsState.latitude !== null && gpsState.longitude !== null) {
        const latLng = [gpsState.latitude, gpsState.longitude];
        
        if (!leafletMarker) {
            const liveMarkerIcon = L.divIcon({
                className: 'gps-live-marker-icon',
                html: '<div class="gps-marker-pin"></div><div class="gps-marker-pulse"></div>',
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            });

            leafletMarker = L.marker(latLng, { icon: liveMarkerIcon }).addTo(leafletMap);
            leafletMap.setView(latLng, 14, { animate: true });
        } else {
            leafletMarker.setLatLng(latLng);
            leafletMap.panTo(latLng, { animate: true, duration: 1.0 });
        }
    }
}

function receiveGPSData(data) {
    updateGPSData(data);
}

window.updateGPSData = updateGPSData;
window.receiveGPSData = receiveGPSData;
window.updateGPSStatus = updateGPSStatus;

function initBrowserGeolocationFallback() {
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                if (gpsState.status === 'WAITING') {
                    updateGPSData({
                        latitude: pos.coords.latitude,
                        longitude: pos.coords.longitude,
                        altitude: Math.round(pos.coords.altitude || 15),
                        speed: (pos.coords.speed || 0).toFixed(1),
                        satellites: 8,
                        status: 'ONLINE'
                    });
                }
            },
            (err) => {},
            { timeout: 10000, maximumAge: 60000 }
        );
    }
}

/* -------------------------------------------------------------
 * RESPONSIVE SIDEBAR DRAWER & HEADER CONTROLS
 * ------------------------------------------------------------- */
function initSidebarResponsive() {
    const sidebar = document.getElementById('appSidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    const toggleBtn = document.getElementById('sidebarToggleBtn');
    const closeBtn = document.getElementById('sidebarCloseBtn');
    const headerNotifBtn = document.getElementById('headerNotifBtn');
    const navNotifBtn = document.getElementById('navNotifications');

    function openSidebar() {
        if (sidebar) sidebar.classList.add('open');
        if (backdrop) backdrop.classList.add('active');
        document.body.style.overflow = window.innerWidth <= 1024 ? 'hidden' : '';
    }

    function closeSidebar() {
        if (sidebar) sidebar.classList.remove('open');
        if (backdrop) backdrop.classList.remove('active');
        document.body.style.overflow = '';
    }

    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (sidebar && sidebar.classList.contains('open')) {
                closeSidebar();
            } else {
                openSidebar();
            }
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', closeSidebar);
    }

    if (backdrop) {
        backdrop.addEventListener('click', closeSidebar);
    }

    if (headerNotifBtn && navNotifBtn) {
        headerNotifBtn.addEventListener('click', () => {
            navNotifBtn.click();
        });
    }

    // Auto-close drawer on navigation button click when on mobile/tablet
    document.querySelectorAll('#appSidebar .nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (window.innerWidth <= 1024) {
                closeSidebar();
            }
        });
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 1024) {
            closeSidebar();
        }
    });
}

window.initSidebarResponsive = initSidebarResponsive;

/* -------------------------------------------------------------
 * MODAL HANDLERS & NAVIGATION BUTTONS
 * ------------------------------------------------------------- */
function setupModalHandlers() {
    const navHome = document.getElementById('navHome');
    const navEmployee = document.getElementById('navEmployee');
    const navHistory = document.getElementById('navHistory');
    const navNotifications = document.getElementById('navNotifications');

    const employeeModal = document.getElementById('employeeModal');
    const historyModal = document.getElementById('historyModal');
    const notificationModal = document.getElementById('notificationModal');

    function setActiveNav(btn) {
        if (!btn) return;
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }

    // Determine current page
    const currentPath = (window.location.pathname || '').toLowerCase();
    const isEmployeePage = currentPath.includes('employee.html');
    const isHistoryPage = currentPath.includes('history.html');

    if (isEmployeePage) {
        setActiveNav(navEmployee);
    } else if (isHistoryPage) {
        setActiveNav(navHistory);
    } else {
        setActiveNav(navHome);
    }

    if (navHome) {
        navHome.addEventListener('click', () => {
            if (isEmployeePage || isHistoryPage) {
                window.location.href = 'index.html';
            } else {
                setActiveNav(navHome);
                closeAllModals();
            }
        });
    }

    if (navEmployee) {
        navEmployee.addEventListener('click', () => {
            if (!isEmployeePage) {
                window.location.href = 'employee.html';
            } else {
                setActiveNav(navEmployee);
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
    }

    if (navHistory) {
        navHistory.addEventListener('click', () => {
            if (!isHistoryPage) {
                window.location.href = 'history.html';
            } else {
                setActiveNav(navHistory);
                window.scrollTo({ top: 0, behavior: 'smooth' });
                if (historyChart) {
                    updateHistoryChartData();
                    setTimeout(() => {
                        historyChart.resize();
                        historyChart.update();
                    }, 50);
                }
            }
        });
    }

    if (navNotifications) {
        navNotifications.addEventListener('click', () => {
            setActiveNav(navNotifications);
            if (notificationModal) {
                currentNotifFilter = "ALL";
                document.querySelectorAll('.notif-filter-btn').forEach(btn => {
                    if (btn.dataset.filter === "ALL") {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }
                });
                openModal(notificationModal);
                renderNotifications();
            }
        });
    }

    const closeEmp = document.getElementById('closeEmployeeModal');
    if (closeEmp) {
        closeEmp.addEventListener('click', () => {
            closeAllModals();
            setActiveNav(navHome);
        });
    }

    const closeHist = document.getElementById('closeHistoryModal');
    if (closeHist) {
        closeHist.addEventListener('click', () => {
            closeAllModals();
            setActiveNav(navHome);
        });
    }

    const closeNotif = document.getElementById('closeNotificationModal');
    if (closeNotif) {
        closeNotif.addEventListener('click', () => {
            closeAllModals();
            if (isEmployeePage) {
                setActiveNav(navEmployee);
            } else if (isHistoryPage) {
                setActiveNav(navHistory);
            } else {
                setActiveNav(navHome);
            }
        });
    }

    [employeeModal, historyModal, notificationModal].forEach(m => {
        if (m) {
            m.addEventListener('click', (e) => {
                if (e.target === m) {
                    closeAllModals();
                    if (isEmployeePage) {
                        setActiveNav(navEmployee);
                    } else if (isHistoryPage) {
                        setActiveNav(navHistory);
                    } else {
                        setActiveNav(navHome);
                    }
                }
            });
        }
    });

    const btnFilter24H = document.getElementById('btnFilter24H');
    if (btnFilter24H) {
        btnFilter24H.addEventListener('click', () => {
            updateHistoryChartData();
            if (historyChart) {
                historyChart.resize();
                historyChart.update();
            }
        });
    }

    const btnExportCSV = document.getElementById('btnExportCSV');
    if (btnExportCSV) {
        btnExportCSV.addEventListener('click', () => {
            if (sensorHistory.length === 0) {
                alert("No real sensor telemetry recorded yet to export.");
                return;
            }
            const csvContent = "data:text/csv;charset=utf-8," 
                + "Timestamp,Time,Temperature (°C),Humidity (%),Gas (ppm)\n"
                + sensorHistory.map(e => `${e.timestamp},"${new Date(e.timestamp).toLocaleTimeString()}",${e.temperature},${e.humidity},${e.gas}`).join("\n");
            
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `Telemetry_History_Log_${new Date().toISOString().slice(0,10)}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    }
}

function openModal(modalEl) {
    if (!modalEl) return;
    closeAllModals();
    modalEl.classList.add('active');
}

function closeAllModals() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('active'));
}

/* -------------------------------------------------------------
 * HISTORY TREND CHART (Modal Line Chart with Real Live Data)
 * ------------------------------------------------------------- */
function initHistoryChart() {
    const canvas = document.getElementById('historyTrendCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    historyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Temperature (°C)',
                    data: [],
                    borderColor: '#FFB52E',
                    backgroundColor: 'rgba(255, 181, 46, 0.1)',
                    tension: 0.4,
                    fill: true,
                    yAxisID: 'y'
                },
                {
                    label: 'Humidity (%)',
                    data: [],
                    borderColor: '#22D3EE',
                    backgroundColor: 'rgba(34, 211, 238, 0.1)',
                    tension: 0.4,
                    fill: true,
                    yAxisID: 'y'
                },
                {
                    label: 'Gas Conc. (ppm)',
                    data: [],
                    borderColor: '#A855F7',
                    backgroundColor: 'rgba(168, 85, 247, 0.1)',
                    tension: 0.4,
                    fill: true,
                    yAxisID: 'yGas'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#94a3b8', font: { family: 'Space Grotesk' } }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8', font: { family: 'Space Grotesk' }, maxRotation: 45 }
                },
                y: {
                    type: 'linear',
                    position: 'left',
                    min: 0,
                    max: 100,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8', font: { family: 'Space Grotesk' } },
                    title: { display: true, text: 'Temp (°C) / Humidity (%)', color: '#94a3b8' }
                },
                yGas: {
                    type: 'linear',
                    position: 'right',
                    min: 0,
                    max: 4100,
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#a855f7', font: { family: 'Space Grotesk' } },
                    title: { display: true, text: 'Gas (ppm)', color: '#a855f7' }
                }
            }
        }
    });
}

function updateHistoryChartData() {
    if (!historyChart) return;

    // Filter strictly to last 24 hours
    const cutoff24h = Date.now() - (24 * 60 * 60 * 1000);
    const filteredHistory = sensorHistory.filter(record => record.timestamp >= cutoff24h);

    const labels = filteredHistory.map(record => 
        new Date(record.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        })
    );

    historyChart.data.labels = labels;
    historyChart.data.datasets[0].data = filteredHistory.map(r => r.temperature);
    historyChart.data.datasets[1].data = filteredHistory.map(r => r.humidity);
    historyChart.data.datasets[2].data = filteredHistory.map(r => r.gas);
    historyChart.update('none');
}

// Handle page visibility for chart resizing without modifying device status
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (historyChart) {
            updateHistoryChartData();
            historyChart.resize();
        }
    }
});

window.updateHistoryChartData = updateHistoryChartData;
window.checkDeviceConnectionStatus = checkDeviceConnectionStatus;
window.sensorHistory = sensorHistory;
