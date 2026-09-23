/**
 * telemetry.js
 * Central Shared Frontend Telemetry Manager for Industrial IoT Smart Monitoring Dashboard.
 * 
 * SOLE OWNER OF:
 * - WebSocket connection and auto-reconnect
 * - WebSocket message parsing
 * - latestTelemetry state
 * - lastDataReceivedAt timestamp
 * - currentDeviceStatus ('ONLINE' | 'OFFLINE')
 * - 10-second watchdog timer
 * - Cross-tab synchronization via BroadcastChannel & localStorage
 */

(function (root, factory) {
    const manager = factory();
    if (typeof root !== 'undefined') {
        root.TelemetryManager = manager;
    }
    if (typeof window !== 'undefined') {
        window.TelemetryManager = manager;
    }
    if (typeof global !== 'undefined') {
        global.TelemetryManager = manager;
    }
    if (typeof module === 'object' && module.exports) {
        module.exports = manager;
    }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function () {
    'use strict';

    const WEBSOCKET_URL = "wss://headed-spooky-snowstorm.ngrok-free.dev/ws/dashboard";
    const OFFLINE_TIMEOUT_MS = 10000;
    const RECONNECT_DELAY_MS = 3000;

    // Storage Keys for persistence & cross-tab sync
    const STORAGE_KEY_TELEMETRY = 'scada_latest_telemetry_v1';
    const STORAGE_KEY_LAST_RECEIVED = 'scada_last_received_at_v1';
    const STORAGE_KEY_DEVICE_STATUS = 'scada_device_status_v1';
    const STORAGE_KEY_LAST_TRANSITION = 'scada_last_status_transition_v1';
    const BROADCAST_CHANNEL_NAME = 'scada_telemetry_channel';

    let socket = null;
    let reconnectTimer = null;
    let watchdogTimer = null;

    let latestTelemetry = null;
    let lastDataReceivedAt = 0;
    let currentDeviceStatus = 'OFFLINE';

    const telemetryListeners = new Set();
    const statusListeners = new Set();

    let broadcastChannel = null;
    if (typeof BroadcastChannel !== 'undefined') {
        try {
            broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
            broadcastChannel.onmessage = handleBroadcastMessage;
        } catch (e) {
            console.warn('[TelemetryManager] BroadcastChannel unavailable, falling back to storage events:', e);
            broadcastChannel = null;
        }
    }

    // Fallback cross-tab synchronization via window storage events
    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('storage', (event) => {
            if (event.key === STORAGE_KEY_TELEMETRY && event.newValue) {
                try {
                    const parsed = JSON.parse(event.newValue);
                    if (parsed && parsed.data && parsed.timestamp) {
                        applyIncomingTelemetry(parsed.data, parsed.timestamp, false);
                    }
                } catch (err) {
                    console.error('[TelemetryManager] Error reading storage event:', err);
                }
            } else if (event.key === STORAGE_KEY_LAST_RECEIVED && event.newValue) {
                const ts = Number(event.newValue);
                if (!isNaN(ts) && ts > lastDataReceivedAt) {
                    lastDataReceivedAt = ts;
                    evaluateWatchdog();
                }
            }
        });
    }

    /**
     * Broadcast message handler (receives updates from other open tabs)
     */
    function handleBroadcastMessage(event) {
        if (!event || !event.data) return;
        const msg = event.data;
        if (msg.type === 'LIVE_TELEMETRY' && msg.payload && msg.timestamp) {
            applyIncomingTelemetry(msg.payload, msg.timestamp, false);
        } else if (msg.type === 'DEVICE_STATUS' && msg.status) {
            updateDeviceStatus(msg.status, msg.deviceId, false);
        }
    }

    /**
     * Load initial state from localStorage if available.
     * Restores last known sensor values. Only marked ONLINE if still within 10s freshness window.
     */
    function loadCachedState() {
        try {
            if (typeof localStorage === 'undefined') return;

            const storedLastReceived = localStorage.getItem(STORAGE_KEY_LAST_RECEIVED);
            if (storedLastReceived) {
                const ts = Number(storedLastReceived);
                if (!isNaN(ts)) {
                    lastDataReceivedAt = ts;
                }
            }

            const storedTelemetry = localStorage.getItem(STORAGE_KEY_TELEMETRY);
            if (storedTelemetry) {
                const parsed = JSON.parse(storedTelemetry);
                if (parsed && parsed.data) {
                    latestTelemetry = parsed.data;
                    if (parsed.timestamp && parsed.timestamp > lastDataReceivedAt) {
                        lastDataReceivedAt = parsed.timestamp;
                    }
                }
            }

            // Freshness test
            const now = Date.now();
            const isFresh = (lastDataReceivedAt > 0) && (now - lastDataReceivedAt <= OFFLINE_TIMEOUT_MS);
            currentDeviceStatus = isFresh ? 'ONLINE' : 'OFFLINE';

        } catch (e) {
            console.error('[TelemetryManager] Failed to load cached telemetry:', e);
        }
    }

    /**
     * Save the latest valid snapshot to localStorage and broadcast to other tabs
     */
    function persistAndBroadcast(data, timestamp) {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(STORAGE_KEY_TELEMETRY, JSON.stringify({ data, timestamp }));
                localStorage.setItem(STORAGE_KEY_LAST_RECEIVED, String(timestamp));
                localStorage.setItem(STORAGE_KEY_DEVICE_STATUS, currentDeviceStatus);
            }
        } catch (e) {
            console.error('[TelemetryManager] Failed to save telemetry to localStorage:', e);
        }

        if (broadcastChannel) {
            try {
                broadcastChannel.postMessage({
                    type: 'LIVE_TELEMETRY',
                    payload: data,
                    timestamp: timestamp
                });
            } catch (e) {
                console.error('[TelemetryManager] Failed to broadcast telemetry:', e);
            }
        }
    }

    /**
     * Apply incoming real telemetry (from WebSocket or BroadcastChannel)
     */
    function applyIncomingTelemetry(data, timestamp, shouldBroadcast = true) {
        if (!data || data.type !== 'industrial_sensor_data') {
            return;
        }

        const validTimestamp = timestamp || Date.now();
        if (validTimestamp >= lastDataReceivedAt) {
            lastDataReceivedAt = validTimestamp;
        }

        latestTelemetry = Object.assign({}, latestTelemetry || {}, data);

        // Valid industrial_sensor_data makes device ONLINE
        updateDeviceStatus('ONLINE', data.device_id || data.deviceId || 'ESP32-SAFETY-01', shouldBroadcast);

        if (shouldBroadcast) {
            persistAndBroadcast(data, validTimestamp);
        }

        // Notify all registered UI listeners
        telemetryListeners.forEach(listener => {
            try {
                listener(data, latestTelemetry);
            } catch (err) {
                console.error('[TelemetryManager] Error in telemetry listener:', err);
            }
        });
    }

    /**
     * Update device status ('ONLINE' | 'OFFLINE') with cross-tab deduplication
     */
    function updateDeviceStatus(newStatus, deviceId = 'ESP32-SAFETY-01', shouldBroadcast = true) {
        const normalizedStatus = (newStatus === 'ONLINE') ? 'ONLINE' : 'OFFLINE';
        const changed = (currentDeviceStatus !== normalizedStatus);

        currentDeviceStatus = normalizedStatus;

        if (typeof localStorage !== 'undefined') {
            try {
                localStorage.setItem(STORAGE_KEY_DEVICE_STATUS, currentDeviceStatus);
            } catch (e) {}
        }

        if (changed) {
            // Check cross-tab notification deduplication token
            let isNewTransition = true;
            try {
                if (typeof localStorage !== 'undefined') {
                    const lastTransRaw = localStorage.getItem(STORAGE_KEY_LAST_TRANSITION);
                    if (lastTransRaw) {
                        const lastTrans = JSON.parse(lastTransRaw);
                        if (lastTrans.status === normalizedStatus && (Date.now() - lastTrans.timestamp < 4000)) {
                            isNewTransition = false;
                        }
                    }
                    if (isNewTransition) {
                        localStorage.setItem(STORAGE_KEY_LAST_TRANSITION, JSON.stringify({
                            status: normalizedStatus,
                            timestamp: Date.now(),
                            deviceId: deviceId
                        }));
                    }
                }
            } catch (e) {}

            // Notify UI listeners
            statusListeners.forEach(listener => {
                try {
                    listener(normalizedStatus, deviceId, isNewTransition);
                } catch (err) {
                    console.error('[TelemetryManager] Error in status listener:', err);
                }
            });

            if (shouldBroadcast && broadcastChannel) {
                try {
                    broadcastChannel.postMessage({
                        type: 'DEVICE_STATUS',
                        status: normalizedStatus,
                        deviceId: deviceId
                    });
                } catch (e) {}
            }
        }
    }

    /**
     * 10-Second Watchdog Timer.
     * Evaluates real timestamp staleness (Date.now() - lastDataReceivedAt > 10000).
     * Protected against background-tab timer throttling because it uses real clock diff.
     */
    function evaluateWatchdog() {
        const now = Date.now();
        if (lastDataReceivedAt === 0 || (now - lastDataReceivedAt > OFFLINE_TIMEOUT_MS)) {
            if (currentDeviceStatus !== 'OFFLINE') {
                const devId = latestTelemetry ? (latestTelemetry.device_id || latestTelemetry.deviceId || 'ESP32-SAFETY-01') : 'ESP32-SAFETY-01';
                updateDeviceStatus('OFFLINE', devId, true);
            }
        } else {
            if (currentDeviceStatus !== 'ONLINE') {
                const devId = latestTelemetry ? (latestTelemetry.device_id || latestTelemetry.deviceId || 'ESP32-SAFETY-01') : 'ESP32-SAFETY-01';
                updateDeviceStatus('ONLINE', devId, true);
            }
        }
    }

    function startWatchdog() {
        if (!watchdogTimer) {
            watchdogTimer = setInterval(evaluateWatchdog, 1000);
        }
    }

    /**
     * WebSocket Connection & Auto-Reconnect
     */
    function scheduleReconnect() {
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connectWebSocket();
        }, RECONNECT_DELAY_MS);
    }

    function connectWebSocket() {
        if (typeof WebSocket === 'undefined') return;

        if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
            return;
        }

        try {
            socket = new WebSocket(WEBSOCKET_URL);

            socket.onopen = () => {
                console.log('[TelemetryManager] WebSocket connection established.');
                // IMPORTANT: WebSocket onopen DOES NOT mean the device is ONLINE!
                // Device becomes ONLINE only when real industrial_sensor_data packet is received.
            };

            socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data && data.type === 'industrial_sensor_data') {
                        applyIncomingTelemetry(data, Date.now(), true);
                    }
                } catch (parseError) {
                    console.error('[TelemetryManager] JSON parse error:', parseError);
                }
            };

            socket.onerror = (error) => {
                console.warn('[TelemetryManager] WebSocket error:', error);
            };

            socket.onclose = () => {
                console.log('[TelemetryManager] WebSocket disconnected. Scheduling reconnect...');
                socket = null;
                scheduleReconnect();
            };

        } catch (initError) {
            console.error('[TelemetryManager] WebSocket initialization error:', initError);
            socket = null;
            scheduleReconnect();
        }
    }

    /**
     * Public API
     */
    const manager = {
        /**
         * Initialize telemetry layer (invoked on page boot)
         */
        init: function () {
            loadCachedState();
            startWatchdog();
            connectWebSocket();
            evaluateWatchdog();
            return this;
        },

        /**
         * Subscribe to live telemetry packets
         */
        subscribe: function (callback) {
            if (typeof callback === 'function') {
                telemetryListeners.add(callback);
                // If we already have cached/live telemetry, deliver it immediately
                if (latestTelemetry) {
                    try {
                        callback(latestTelemetry, latestTelemetry);
                    } catch (e) {
                        console.error('[TelemetryManager] Error delivering initial telemetry:', e);
                    }
                }
            }
            return () => telemetryListeners.delete(callback);
        },

        /**
         * Subscribe to device status transitions ('ONLINE' | 'OFFLINE')
         */
        onStatusChange: function (callback) {
            if (typeof callback === 'function') {
                statusListeners.add(callback);
                // Deliver current status immediately
                try {
                    const devId = latestTelemetry ? (latestTelemetry.device_id || latestTelemetry.deviceId || 'ESP32-SAFETY-01') : 'ESP32-SAFETY-01';
                    callback(currentDeviceStatus, devId, false);
                } catch (e) {
                    console.error('[TelemetryManager] Error delivering initial status:', e);
                }
            }
            return () => statusListeners.delete(callback);
        },

        /**
         * Process a live telemetry packet manually (used by tests or custom injectors)
         */
        processLiveData: function (data) {
            applyIncomingTelemetry(data, Date.now(), true);
        },

        getLatestTelemetry: function () {
            return latestTelemetry ? Object.assign({}, latestTelemetry) : null;
        },

        getLastDataReceivedAt: function () {
            return lastDataReceivedAt;
        },

        getDeviceStatus: function () {
            return currentDeviceStatus;
        },

        checkDeviceConnectionStatus: function () {
            evaluateWatchdog();
            return currentDeviceStatus;
        },

        getWebSocketUrl: function () {
            return WEBSOCKET_URL;
        },

        _setLastDataReceivedAt: function (ts) {
            lastDataReceivedAt = ts;
            if (typeof localStorage !== 'undefined') {
                try {
                    localStorage.setItem(STORAGE_KEY_LAST_RECEIVED, String(ts));
                } catch (e) {}
            }
        },

        _setCurrentDeviceStatus: function (status) {
            currentDeviceStatus = status;
            if (typeof localStorage !== 'undefined') {
                try {
                    localStorage.setItem(STORAGE_KEY_DEVICE_STATUS, status);
                } catch (e) {}
            }
        }
    };

    // Auto-initialize on browser execution
    if (typeof window !== 'undefined') {
        manager.init();
    }

    return manager;
}));
