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
    tempCategory: "NORMAL", // NORMAL | WARNING | CRITICAL
    humCategory: "NORMAL",  // NORMAL | WARNING
    gasCategory: "NORMAL",  // NORMAL | WARNING | CRITICAL
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
    emergencyAlert: false
};

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

// Sensor Ranges
const SENSOR_RANGES = {
    temp: { min: 0, max: 60 },
    humidity: { min: 0, max: 100 },
    gas: { min: 0, max: 4100 }
};

// Real Live History Telemetry Buffer
const sensorHistory = [];
const MAX_HISTORY_POINTS = 100;

// Device Online/Offline Timeout Mechanism
let lastDataReceivedAt = 0;
let deviceOfflineTimer = null;
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
    loadNotifications();
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
    setDeviceStatusUI('OFFLINE');
    initWebSocket();
    ensureEmergencyOverlay();

    if (!deviceOfflineTimer) {
        deviceOfflineTimer = setInterval(checkDeviceConnectionStatus, 1000);
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
        
        clockEl.innerHTML = `
            <span class="clock-time">${timeStr}</span>
            <span class="clock-date">${dateStr}</span>
        `;
    }
    
    updateClock();
    setInterval(updateClock, 1000);
}

/* -------------------------------------------------------------
 * CHART.JS GAUGE INITIALIZATION (Start cleanly at 0)
 * ------------------------------------------------------------- */
function initGaugeCharts() {
    const getGaugeOptions = () => ({
        rotation: 270,
        circumference: 180,
        cutout: '80%',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            tooltip: { enabled: false },
            legend: { display: false }
        },
        animation: {
            duration: 800,
            easing: 'easeOutQuart'
        }
    });

    // 1. Temperature Gauge
    const ctxTemp = document.getElementById('tempGaugeCanvas').getContext('2d');
    const tempGrad = ctxTemp.createLinearGradient(0, 0, 200, 0);
    tempGrad.addColorStop(0, '#FFB52E');
    tempGrad.addColorStop(1, '#FF4D67');

    tempChart = new Chart(ctxTemp, {
        type: 'doughnut',
        data: {
            datasets: [{
                data: [0, SENSOR_RANGES.temp.max],
                backgroundColor: [tempGrad, 'rgba(15, 35, 65, 0.6)'],
                borderWidth: 0,
                borderRadius: [10, 0]
            }]
        },
        options: getGaugeOptions()
    });

    // 2. Humidity Gauge
    const ctxHum = document.getElementById('humidityGaugeCanvas').getContext('2d');
    const humGrad = ctxHum.createLinearGradient(0, 0, 200, 0);
    humGrad.addColorStop(0, '#22D3EE');
    humGrad.addColorStop(1, '#2196F3');

    humidityChart = new Chart(ctxHum, {
        type: 'doughnut',
        data: {
            datasets: [{
                data: [0, SENSOR_RANGES.humidity.max],
                backgroundColor: [humGrad, 'rgba(15, 35, 65, 0.6)'],
                borderWidth: 0,
                borderRadius: [10, 0]
            }]
        },
        options: getGaugeOptions()
    });

    // 3. Gas Concentration Gauge (Range 0-4100 ppm)
    const ctxGas = document.getElementById('gasGaugeCanvas').getContext('2d');
    const gasNormalGrad = ctxGas.createLinearGradient(0, 0, 200, 0);
    gasNormalGrad.addColorStop(0, '#A855F7');
    gasNormalGrad.addColorStop(1, '#22D3EE');

    gasChart = new Chart(ctxGas, {
        type: 'doughnut',
        data: {
            datasets: [
                {
                    data: [0, SENSOR_RANGES.gas.max],
                    backgroundColor: [gasNormalGrad, 'rgba(15, 35, 65, 0.6)'],
                    borderWidth: 0,
                    borderRadius: [10, 0]
                },
                {
                    data: [2500, 1000, 600],
                    backgroundColor: [
                        'rgba(168, 85, 247, 0.12)',
                        'rgba(255, 181, 46, 0.15)',
                        'rgba(255, 77, 103, 0.18)'
                    ],
                    borderWidth: 1,
                    borderColor: 'rgba(255, 255, 255, 0.05)',
                    weight: 0.35
                }
            ]
        },
        options: getGaugeOptions()
    });
}

function getGasArcColor(gasVal, defaultGrad) {
    if (gasVal > 3500) return '#FF4D67'; // Critical
    if (gasVal > 2500) return '#FFB52E'; // Warning
    return defaultGrad;                 // Normal
}

/* -------------------------------------------------------------
 * REAL-TIME NOTIFICATION SYSTEM FUNCTIONS
 * ------------------------------------------------------------- */
function loadNotifications() {
    try {
        const saved = localStorage.getItem('scada_notifications_v1');
        if (saved) {
            notifications = JSON.parse(saved);
        }
    } catch (e) {
        console.error('Failed to load notifications from localStorage:', e);
        notifications = [];
    }
    updateNotificationBadgeCount();
}

function saveNotifications() {
    try {
        localStorage.setItem('scada_notifications_v1', JSON.stringify(notifications));
    } catch (e) {
        console.error('Failed to save notifications to localStorage:', e);
    }
    updateNotificationBadgeCount();
}

function addNotification(type, title, message, severity = "INFO", device = "ESP32-SAFETY-01") {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    const newNotif = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        type: type,
        title: title,
        message: message,
        timestamp: timeStr,
        date: dateStr,
        severity: severity.toUpperCase(), // INFO | SUCCESS | WARNING | CRITICAL
        device: device,
        status: "NEW"
    };

    notifications.unshift(newNotif);
    saveNotifications();
    renderNotifications();
}

function updateNotificationBadgeCount() {
    const unreadCount = notifications.filter(n => n.status === "NEW").length;
    const badgeEl = document.getElementById('notifNavBadge');
    if (badgeEl) {
        badgeEl.innerText = unreadCount;
        badgeEl.style.display = unreadCount > 0 ? 'inline-block' : 'none';
    }
}

function renderNotifications() {
    const listWrapper = document.getElementById('notificationList');
    if (!listWrapper) return;

    listWrapper.innerHTML = '';

    const filtered = notifications.filter(n => {
        if (currentNotifFilter === "ALL") return true;
        return n.severity === currentNotifFilter;
    });

    if (filtered.length === 0) {
        listWrapper.innerHTML = `
            <div style="text-align:center; padding: 40px 20px; color: var(--text-muted); font-size: 13px;">
                <i class="fa-solid fa-bell-slash" style="font-size: 32px; margin-bottom: 10px; color: var(--text-dim); display:block;"></i>
                No notifications logged for filter "${currentNotifFilter}".
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
        itemEl.innerHTML = `
            <div class="notif-icon-box">
                <i class="${iconClass}"></i>
            </div>
            <div class="notif-content">
                <div class="notif-header-row">
                    <span class="notif-item-title">${item.title}</span>
                    <span class="severity-pill">${item.severity}</span>
                </div>
                <div class="notif-item-msg">${item.message}</div>
                <div class="notif-meta-row">
                    <span class="notif-device-tag"><i class="fa-solid fa-microchip"></i> ${item.device}</span>
                    <span class="notif-time-tag"><i class="fa-regular fa-clock"></i> ${item.timestamp} &bull; ${item.date}</span>
                </div>
            </div>
        `;
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
    if (type.includes("DEVICE")) return "fa-solid fa-server";
    
    if (severity === "CRITICAL") return "fa-solid fa-triangle-exclamation";
    if (severity === "WARNING") return "fa-solid fa-circle-exclamation";
    if (severity === "SUCCESS") return "fa-solid fa-circle-check";
    return "fa-solid fa-circle-info";
}

function setupNotificationHandlers() {
    // Filter Buttons
    document.querySelectorAll('.notif-filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.notif-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentNotifFilter = btn.dataset.filter;
            renderNotifications();
        });
    });

    // Mark All Read
    document.getElementById('btnMarkAllRead').addEventListener('click', () => {
        notifications.forEach(n => n.status = "READ");
        saveNotifications();
        renderNotifications();
    });

    // Clear History
    document.getElementById('btnClearNotifHistory').addEventListener('click', () => {
        if (confirm("Are you sure you want to clear all notification history?")) {
            notifications = [];
            saveNotifications();
            renderNotifications();
        }
    });

    // Manual Event Test Buttons
    document.getElementById('testEvFlame').addEventListener('click', () => {
        processLiveData({ type: "industrial_sensor_data", flame: true, gas_high: false, pir: false, vibration: false, device_status: "ONLINE" });
    });
    document.getElementById('testEvGas').addEventListener('click', () => {
        processLiveData({ type: "industrial_sensor_data", flame: false, gas: 2850, gas_high: true, pir: false, vibration: false, device_status: "ONLINE" });
    });
    document.getElementById('testEvGate').addEventListener('click', () => {
        processLiveData({ type: "industrial_sensor_data", flame: false, gas_high: false, pir: false, vibration: false, main_gate: true, device_status: "ONLINE" });
    });
    document.getElementById('testEvNormal').addEventListener('click', () => {
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

/* -------------------------------------------------------------
 * 1. NODE-RED WEBSOCKET LIVE DATA INTEGRATION
 * ------------------------------------------------------------- */
const NODE_RED_WS_URL = "ws://localhost:1880/ws/dashboard";
let socket = null;
let reconnectTimer = null;

function setDeviceStatusUI(status) {
    const devEl = document.getElementById('headerDeviceStatus');
    if (!devEl) return;
    const finalStatus = (status === 'ONLINE') ? 'ONLINE' : 'OFFLINE';
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
    if (currentDeviceStatus !== "ONLINE") {
        currentDeviceStatus = "ONLINE";
        previousState.deviceStatus = "ONLINE";
        setDeviceStatusUI("ONLINE");
        const devId = deviceName || previousState.deviceId || "ESP32-SAFETY-01";
        addNotification(
            "DEVICE_ONLINE",
            "Device Online",
            `${devId} connected`,
            "SUCCESS",
            devId
        );
    } else {
        setDeviceStatusUI("ONLINE");
    }
}

function setDeviceOffline() {
    if (currentDeviceStatus !== "OFFLINE") {
        currentDeviceStatus = "OFFLINE";
        previousState.deviceStatus = "OFFLINE";
        setDeviceStatusUI("OFFLINE");
        const devId = previousState.deviceId || "ESP32-SAFETY-01";
        addNotification(
            "DEVICE_OFFLINE",
            "Device Offline",
            `${devId} connection lost`,
            "CRITICAL",
            devId
        );
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

function scheduleWebSocketReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        initWebSocket();
    }, 3000);
}

function initWebSocket() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
    }
    try {
        socket = new WebSocket(NODE_RED_WS_URL);

        socket.onopen = () => {
            console.log("Connected to Node-RED WebSocket");
            // Do NOT set ESP32/device status to ONLINE here.
            // Wait for actual industrial_sensor_data.
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data && data.type === "industrial_sensor_data") {
                    processLiveData(data);
                }
            } catch (error) {
                console.error("Invalid WebSocket JSON:", error);
            }
        };

        socket.onerror = (error) => {
            console.error("WebSocket error:", error);
        };

        socket.onclose = () => {
            console.log("Node-RED WebSocket disconnected");
            socket = null;
            scheduleWebSocketReconnect();
        };
    } catch (error) {
        console.error("WebSocket initialization error:", error);
        socket = null;
        scheduleWebSocketReconnect();
    }
}

function checkDeviceConnectionStatus() {
    const now = Date.now();

    if (
        lastDataReceivedAt === 0 ||
        now - lastDataReceivedAt > DEVICE_OFFLINE_TIMEOUT
    ) {
        if (currentDeviceStatus !== "OFFLINE") {
            setDeviceOffline();
        }
    } else {
        if (currentDeviceStatus !== "ONLINE") {
            setDeviceOnline();
        }
    }
}

/* -------------------------------------------------------------
 * 2. EMERGENCY OVERLAY & ALERT CONTROLLER
 * ------------------------------------------------------------- */
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
        overlay.style.background = 'linear-gradient(145deg, rgba(32, 4, 8, 0.96) 0%, rgba(16, 2, 4, 0.98) 100%)';
        overlay.style.border = '2px solid #ef4444';
        overlay.style.borderRadius = '16px';
        overlay.style.boxShadow = '0 0 35px rgba(239, 68, 68, 0.5), 0 10px 40px rgba(0, 0, 0, 0.8)';
        overlay.style.padding = '20px 24px';
        overlay.style.color = '#ffffff';
        overlay.style.fontFamily = "'Space Grotesk', -apple-system, sans-serif";
        overlay.style.display = 'none';
        overlay.style.backdropFilter = 'blur(12px)';
        overlay.style.webkitBackdropFilter = 'blur(12px)';
        overlay.style.animation = 'emergencyPulseGlow 2s infinite ease-in-out';
        overlay.style.transition = 'all 0.3s ease';

        if (!document.getElementById('emergencyKeyframesStyle')) {
            const style = document.createElement('style');
            style.id = 'emergencyKeyframesStyle';
            style.textContent = `
                @keyframes emergencyPulseGlow {
                    0% { box-shadow: 0 0 20px rgba(239, 68, 68, 0.4), 0 10px 30px rgba(0, 0, 0, 0.8); border-color: #ef4444; }
                    50% { box-shadow: 0 0 45px rgba(239, 68, 68, 0.8), 0 10px 40px rgba(0, 0, 0, 0.9); border-color: #ff334b; }
                    100% { box-shadow: 0 0 20px rgba(239, 68, 68, 0.4), 0 10px 30px rgba(0, 0, 0, 0.8); border-color: #ef4444; }
                }
                .emergency-condition-pill {
                    background: rgba(239, 68, 68, 0.18);
                    border: 1px solid rgba(239, 68, 68, 0.5);
                    color: #fee2e2;
                    font-size: 13px;
                    font-weight: 700;
                    letter-spacing: 0.5px;
                    padding: 8px 14px;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
            `;
            document.head.appendChild(style);
        }

        overlay.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(239, 68, 68, 0.3); padding-bottom: 12px; margin-bottom: 14px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 26px; line-height: 1;">🚨</span>
                    <div>
                        <div style="font-size: 16px; font-weight: 800; letter-spacing: 1px; color: #ff334b; text-transform: uppercase;">EMERGENCY ALERT</div>
                        <div style="font-size: 11px; font-weight: 600; color: #fca5a5; letter-spacing: 0.6px; margin-top: 2px;">SAFETY CONDITION DETECTED</div>
                    </div>
                </div>
                <div style="background: rgba(239, 68, 68, 0.25); border: 1px solid #ef4444; color: #ff4d67; font-size: 10px; font-weight: 800; padding: 4px 8px; border-radius: 6px; letter-spacing: 0.5px;">LIVE CRITICAL</div>
            </div>
            <div id="emergencyConditionList" style="display: flex; flex-direction: column; gap: 8px;"></div>
        `;
        document.body.appendChild(overlay);
    }
    return overlay;
}

function updateEmergencyAlert(data) {
    if (!data) return;

    const flame = data.flame === true;
    const gasHigh = data.gas_high === true;
    const motion = data.pir === true;
    const vibration = data.vibration === true;

    const activeConditions = [];

    if (flame) {
        activeConditions.push("🔥 FLAME DETECTED");
    }

    if (gasHigh) {
        activeConditions.push("☣ HIGH GAS DETECTED");
    }

    if (motion) {
        activeConditions.push("👤 MOTION DETECTED");
    }

    if (vibration) {
        activeConditions.push("⚠ VIBRATION DETECTED");
    }

    const emergency = activeConditions.length > 0;
    const overlay = ensureEmergencyOverlay();
    const listEl = document.getElementById('emergencyConditionList');
    const deviceId = data.device_id || data.deviceId || "ESP32-SAFETY-01";

    if (emergency) {
        if (listEl) {
            listEl.innerHTML = activeConditions
                .map(cond => `<div class="emergency-condition-pill">${cond}</div>`)
                .join('');
        }
        overlay.style.display = 'block';

        // Emergency state transition false -> true (trigger ONE notification only)
        if (!previousState.emergencyAlert) {
            addNotification(
                "EMERGENCY_SAFETY",
                "Emergency Safety Alert",
                "Safety condition detected: " + activeConditions.join(", "),
                "CRITICAL",
                deviceId
            );
            previousState.emergencyAlert = true;
        }
    } else {
        // Hide popup only when ALL 4 conditions are false
        overlay.style.display = 'none';
        if (listEl) {
            listEl.innerHTML = '';
        }

        // Emergency state transition true -> false (recovery notification)
        if (previousState.emergencyAlert) {
            addNotification(
                "EMERGENCY_RECOVERED",
                "Emergency Cleared",
                "Safety conditions cleared",
                "SUCCESS",
                deviceId
            );
            previousState.emergencyAlert = false;
        }
    }
}

function addHistoryData(data) {
    if (!data) return;
    const tempNum = Number(data.temperature);
    const humNum = Number(data.humidity);
    const gasNum = Number(data.gas);

    if (!isNaN(tempNum) && !isNaN(humNum) && !isNaN(gasNum) &&
        data.temperature !== undefined && data.humidity !== undefined && data.gas !== undefined) {
        sensorHistory.push({
            timestamp: Date.now(),
            temperature: tempNum,
            humidity: humNum,
            gas: gasNum
        });

        if (sensorHistory.length > MAX_HISTORY_POINTS) {
            sensorHistory.shift();
        }

        updateHistoryChartData();
    }
}

/* -------------------------------------------------------------
 * 3. CENTRALIZED LIVE DATA PROCESSOR
 * ------------------------------------------------------------- */
function processLiveData(data) {
    if (!data || data.type !== "industrial_sensor_data") {
        return;
    }

    // 1. ESP32 is sending real data
    lastDataReceivedAt = Date.now();

    // 2. Device becomes ONLINE
    updateDeviceOnlineStatus(data);

    // 3. Update existing sensor UI (last known values)
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

    // 4. Keep existing emergency popup
    updateEmergencyAlert(data);

    // 5. Keep existing history functionality
    addHistoryData(data);
}

// Expose processLiveData, addNotification, and emergency alert globally
window.processLiveData = processLiveData;
window.addNotification = addNotification;
window.updateEmergencyAlert = updateEmergencyAlert;
window.setDeviceStatusUI = setDeviceStatusUI;
window.setDeviceOnline = setDeviceOnline;
window.setDeviceOffline = setDeviceOffline;
window.addHistoryData = addHistoryData;

/* -------------------------------------------------------------
 * 3. MODULAR SENSOR UPDATE FUNCTIONS
 * ------------------------------------------------------------- */
function updateTemperature(val) {
    if (val === undefined || val === null) return;
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (isNaN(num)) return;
    sensorData.temperature = num;

    const tempEl = document.getElementById('tempValue');
    if (tempEl) {
        tempEl.innerText = Number.isInteger(num) ? num : num.toFixed(1);
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

    // Temperature Category Notification Transition
    let tempCat = "NORMAL";
    if (num > 40) tempCat = "CRITICAL";
    else if (num > 32) tempCat = "WARNING";

    if (tempCat !== previousState.tempCategory) {
        if (tempCat === "CRITICAL") {
            addNotification("TEMP_CRITICAL", "Critical Temperature Alert", `Temperature reached ${num}°C`, "CRITICAL");
        } else if (tempCat === "WARNING") {
            addNotification("TEMP_WARNING", "Temperature Warning", `Temperature reached ${num}°C`, "WARNING");
        } else if (previousState.tempCategory !== "NORMAL") {
            addNotification("TEMP_NORMAL", "Temperature Normal", "Temperature returned to normal range", "SUCCESS");
        }
        previousState.tempCategory = tempCat;
    }
}

function updateHumidity(val) {
    if (val === undefined || val === null) return;
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (isNaN(num)) return;
    sensorData.humidity = num;

    const humEl = document.getElementById('humidityValue');
    if (humEl) {
        humEl.innerText = Math.round(num);
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
    if (gasEl) {
        gasEl.innerText = Math.round(num);
    }
    if (gasChart) {
        const currentGas = Math.min(Math.max(num, 0), SENSOR_RANGES.gas.max);
        const remainingGas = SENSOR_RANGES.gas.max - currentGas;

        gasChart.data.datasets[0].data = [currentGas, remainingGas];

        const ctxGas = document.getElementById('gasGaugeCanvas').getContext('2d');
        const defaultGrad = ctxGas.createLinearGradient(0, 0, 200, 0);
        defaultGrad.addColorStop(0, '#A855F7');
        defaultGrad.addColorStop(1, '#22D3EE');

        gasChart.data.datasets[0].backgroundColor[0] = getGasArcColor(currentGas, defaultGrad);
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

    // Gas Category Notification Transition
    let gasCat = "NORMAL";
    if (num > 3500) gasCat = "CRITICAL";
    else if (num > 2500) gasCat = "WARNING";

    if (gasCat !== previousState.gasCategory) {
        if (gasCat === "CRITICAL") {
            addNotification("GAS_CRITICAL", "Critical Gas Alert", `Gas concentration reached ${Math.round(num)} ppm`, "CRITICAL");
        } else if (gasCat === "WARNING") {
            addNotification("GAS_WARNING", "Gas Warning", `Gas concentration reached ${Math.round(num)} ppm`, "WARNING");
        } else if (previousState.gasCategory !== "NORMAL") {
            addNotification("GAS_NORMAL", "Gas Normal", "Gas concentration returned to normal levels", "SUCCESS");
        }
        previousState.gasCategory = gasCat;
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
        if (isDanger) {
            addNotification("FLAME_ALERT", "Flame Alert", "Flame danger detected by safety sensor", "CRITICAL");
        } else if (previousState.flame) {
            addNotification("FLAME_NORMAL", "Flame Normal", "Flame condition returned to normal", "SUCCESS");
        }
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
        if (isDanger) {
            addNotification("GAS_WARNING", "Gas Warning", "High gas level detected by sensor", "WARNING");
        } else if (previousState.gasStatus) {
            addNotification("GAS_NORMAL", "Gas Normal", "Gas condition returned to normal", "SUCCESS");
        }
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
        if (isDetected) {
            addNotification("MOTION_DETECTED", "Motion Detected", "Motion detected in monitored area", "WARNING");
        } else if (previousState.motion) {
            addNotification("MOTION_NORMAL", "Motion Normal", "Motion condition returned to normal", "INFO");
        }
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
        if (isDanger) {
            addNotification("VIBRATION_WARNING", "Vibration Warning", "Vibration activity detected", "WARNING");
        } else if (previousState.vibration) {
            addNotification("VIBRATION_NORMAL", "Vibration Normal", "Vibration returned to normal", "INFO");
        }
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
            addNotification("COOLING_FAN_ON", "Cooling Fan ON", "Cooling fan turned ON", "INFO");
        } else if (previousState.coolingFan) {
            addNotification("COOLING_FAN_OFF", "Cooling Fan OFF", "Cooling fan turned OFF", "INFO");
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
            addNotification("EXHAUST_FAN_ON", "Exhaust Fan ON", "Exhaust fan turned ON", "INFO");
        } else if (previousState.exhaustFan) {
            addNotification("EXHAUST_FAN_OFF", "Exhaust Fan OFF", "Exhaust fan turned OFF", "INFO");
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
            addNotification("MAIN_GATE_OPEN", "Main Gate OPEN", "Main gate changed to OPEN", "WARNING");
        } else if (previousState.mainGate) {
            addNotification("MAIN_GATE_CLOSED", "Main Gate CLOSED", "Main gate closed", "SUCCESS");
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
            addNotification("EMERGENCY_GATE_OPEN", "EMERGENCY GATE OPEN", "Emergency gate opened!", "CRITICAL");
        } else if (previousState.emergencyGate) {
            addNotification("EMERGENCY_GATE_CLOSED", "Emergency Gate CLOSED", "Emergency gate closed", "SUCCESS");
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
        addNotification("EMPLOYEE_IN", "Employee Check-In", `${empId.toUpperCase()} - ${name} entered plant`, "INFO", "RFID-GATE-01");
    } else if (existingRecord.outTime === "--") {
        existingRecord.outTime = timeStr;
        addNotification("EMPLOYEE_OUT", "Employee Check-Out", `${empId.toUpperCase()} - ${name} exited plant`, "INFO", "RFID-GATE-01");
    } else {
        console.log(`[ATTENDANCE] EMP ID ${empId} already completed attendance for date ${todayStr}.`);
        return;
    }

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
}

function setupAttendanceScanSimulation() {
    const btnScan = document.getElementById('btnSimulateScan');
    if (!btnScan) return;

    btnScan.addEventListener('click', () => {
        const empId = document.getElementById('scanEmpId').value.trim();
        const empName = document.getElementById('scanEmpName').value.trim() || 'Employee User';
        const empRole = document.getElementById('scanEmpRole').value.trim() || 'Operator';

        if (!empId) {
            alert('Please enter an EMP ID (e.g. EMP001)');
            return;
        }

        recordAttendance(empId, empName, empRole);
        
        document.getElementById('scanEmpId').value = '';
        document.getElementById('scanEmpName').value = '';
        document.getElementById('scanEmpRole').value = '';
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

    // GPS Status Transition Notification
    if (gpsState.status !== previousStatus) {
        if (gpsState.status === 'ONLINE') {
            addNotification("GPS_ONLINE", "GPS Online", "Live GPS signal received", "SUCCESS", "NEO-6M-GPS");
        } else if (gpsState.status === 'OFFLINE' || gpsState.status === 'WAITING') {
            addNotification("GPS_OFFLINE", "GPS Offline", "GPS signal unavailable", "WARNING", "NEO-6M-GPS");
        }
    }

    renderGPSUI();
}

function updateGPSStatus(statusStr) {
    gpsState.status = statusStr;
    renderGPSUI();
}

function renderGPSUI() {
    const badgeEl = document.getElementById('gpsStatusBadge');
    const textEl = document.getElementById('gpsStatusText');

    textEl.innerText = `GPS ${gpsState.status}`;
    if (gpsState.status === 'ONLINE') {
        badgeEl.className = 'gps-badge gps-badge-online';
    } else if (gpsState.status === 'SIGNAL WEAK') {
        badgeEl.className = 'gps-badge gps-badge-weak';
    } else if (gpsState.status === 'OFFLINE') {
        badgeEl.className = 'gps-badge gps-badge-offline';
    } else {
        badgeEl.className = 'gps-badge gps-badge-waiting';
        textEl.innerText = 'WAITING FOR GPS';
    }

    document.getElementById('gpsLatVal').innerText = gpsState.latitude !== null ? `${gpsState.latitude.toFixed(4)}°` : '--';
    document.getElementById('gpsLonVal').innerText = gpsState.longitude !== null ? `${gpsState.longitude.toFixed(4)}°` : '--';
    document.getElementById('gpsAltVal').innerText = gpsState.altitude !== null ? `${gpsState.altitude} m` : '-- m';
    document.getElementById('gpsSpeedVal').innerText = gpsState.speed !== null ? `${gpsState.speed} km/h` : '-- km/h';
    document.getElementById('gpsSatVal').innerText = gpsState.satellites !== null ? `${gpsState.satellites}` : '--';

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
    if ('geolocation' in navigator) {
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
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }

    navHome.addEventListener('click', () => {
        setActiveNav(navHome);
        closeAllModals();
    });

    navEmployee.addEventListener('click', () => {
        setActiveNav(navEmployee);
        openModal(employeeModal);
    });

    navHistory.addEventListener('click', () => {
        setActiveNav(navHistory);
        openModal(historyModal);
        if (historyChart) {
            updateHistoryChartData();
            setTimeout(() => {
                historyChart.resize();
                historyChart.update();
            }, 50);
        }
    });

    navNotifications.addEventListener('click', () => {
        setActiveNav(navNotifications);
        openModal(notificationModal);
        renderNotifications();
    });

    document.getElementById('closeEmployeeModal').addEventListener('click', () => {
        closeAllModals();
        setActiveNav(navHome);
    });

    document.getElementById('closeHistoryModal').addEventListener('click', () => {
        closeAllModals();
        setActiveNav(navHome);
    });

    document.getElementById('closeNotificationModal').addEventListener('click', () => {
        closeAllModals();
        setActiveNav(navHome);
    });

    [employeeModal, historyModal, notificationModal].forEach(m => {
        m.addEventListener('click', (e) => {
            if (e.target === m) {
                closeAllModals();
                setActiveNav(navHome);
            }
        });
    });

    document.getElementById('btnExportCSV').addEventListener('click', () => {
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

function openModal(modalEl) {
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

    const labels = sensorHistory.map(record => 
        new Date(record.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        })
    );

    historyChart.data.labels = labels;
    historyChart.data.datasets[0].data = sensorHistory.map(r => r.temperature);
    historyChart.data.datasets[1].data = sensorHistory.map(r => r.humidity);
    historyChart.data.datasets[2].data = sensorHistory.map(r => r.gas);
    historyChart.update('none');
}

// Handle page visibility / tab switching without reloading
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        checkDeviceConnectionStatus();
        if (historyChart) {
            updateHistoryChartData();
            historyChart.resize();
        }
        if (!socket || socket.readyState === WebSocket.CLOSED) {
            initWebSocket();
        }
    }
});

window.updateHistoryChartData = updateHistoryChartData;
window.checkDeviceConnectionStatus = checkDeviceConnectionStatus;
window.sensorHistory = sensorHistory;
