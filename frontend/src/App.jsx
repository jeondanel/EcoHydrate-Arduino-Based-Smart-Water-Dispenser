import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { Cpu, RefreshCw, Layers, Droplet, Trash2, Radio, BarChart3 } from 'lucide-react';

const SOCKET_URL = 'http://localhost:5000';

function App() {
  const [socket, setSocket] = useState(null);
  const [connection, setConnection] = useState({ connected: false, port: null });
  const [deviceStatus, setDeviceStatus] = useState({
    lcd0: 'SYSTEM OFF',
    lcd1: '',
    tokens: 0,
    water_low: false,
    bin_full: false,
    state: 0 // 0 = OFF
  });
  const [logs, setLogs] = useState([]);
  const [ports, setPorts] = useState([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [loadingPorts, setLoadingPorts] = useState(false);
  
  // Analytics state
  const [analytics, setAnalytics] = useState({
    today: { bottles_collected: 0, tokens_spent: 0 },
    week: { bottles_collected: 0, tokens_spent: 0 },
    month: { bottles_collected: 0, tokens_spent: 0 },
    year: { bottles_collected: 0, tokens_spent: 0 }
  });

  // Translate state code to text
  const getStateText = (stateCode) => {
    const states = ['OFF', 'STARTUP', 'IDLE', 'VERIFYING', 'DISPENSING', 'PAUSED'];
    return states[stateCode] || 'UNKNOWN';
  };

  // Fetch available serial ports from backend
  const fetchPorts = async () => {
    setLoadingPorts(true);
    try {
      const res = await fetch('/api/ports');
      const data = await res.json();
      setPorts(data);
      if (data.length > 0 && !selectedPort) {
        setSelectedPort(data[0].path);
      }
    } catch (err) {
      console.error('Failed to fetch serial ports:', err);
    } finally {
      setLoadingPorts(false);
    }
  };

  // Fetch initial event history from database
  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      setLogs(data);
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  };

  // Fetch aggregated statistics
  const fetchAnalytics = async () => {
    try {
      const res = await fetch('/api/analytics');
      const data = await res.json();
      setAnalytics(data);
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
    }
  };

  // Trigger manual port connection
  const connectPort = async () => {
    if (!selectedPort) return;
    try {
      await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedPort })
      });
    } catch (err) {
      console.error('Connection request failed:', err);
    }
  };

  useEffect(() => {
    // Connect WebSockets
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    // Initial database, analytics, & port fetch
    fetchPorts();
    fetchHistory();
    fetchAnalytics();

    // Listen to real-time events
    newSocket.on('connection_status', (status) => {
      setConnection(status);
    });

    newSocket.on('device_status', (status) => {
      setDeviceStatus(status);
    });

    newSocket.on('new_log', (newLog) => {
      setLogs((prevLogs) => [newLog, ...prevLogs.slice(0, 49)]);
      fetchAnalytics(); // Update analytics values in real-time
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Format liquid volume to display both ml and L
  const formatVolume = (tokensSpent) => {
    const ml = tokensSpent * 250;
    const l = (ml / 1000).toFixed(2);
    return `${ml.toLocaleString()} ml (${l} L)`;
  };

  return (
    <div className="dashboard-container">
      {/* Header */}
      <header className="header">
        <div className="brand-section">
          <h1>EcoHydrate <span>Live</span></h1>
          <p>IoT Plastic Bottle Recycler & Dispenser Monitoring System</p>
        </div>

        <div className="connection-bar">
          <div className="status-indicator">
            <span className={`status-dot ${connection.connected ? 'connected' : 'disconnected'}`}></span>
            <span>{connection.connected ? `Connected: ${connection.port}` : 'Disconnected'}</span>
          </div>

          <select
            className="port-selector"
            value={selectedPort}
            onChange={(e) => setSelectedPort(e.target.value)}
            disabled={connection.connected}
          >
            {ports.map((port) => (
              <option key={port.path} value={port.path}>
                {port.path} {port.friendlyName ? `(${port.friendlyName})` : ''}
              </option>
            ))}
            {ports.length === 0 && <option value="">No ports found</option>}
          </select>

          <button className="btn" onClick={connection.connected ? null : connectPort} disabled={connection.connected}>
            {connection.connected ? 'Active' : 'Connect'}
          </button>
          <button className="btn" style={{ background: '#1e293b', color: '#e2e8f0', marginLeft: '0.25rem' }} onClick={fetchPorts}>
            <RefreshCw size={14} />
          </button>
        </div>
      </header>

      {/* Grid */}
      <div className="grid">
        {/* Left Side: Real-time LCD & System Status */}
        <div className="card">
          <h2 className="card-title">
            <Cpu size={20} className="text-primary" /> Real-time LCD Mirror
          </h2>

          <div className="lcd-container">
            <div className={`lcd-screen ${deviceStatus.state === 0 ? 'lcd-backlight-dim' : ''}`}>
              <div className="lcd-row">
                {deviceStatus.lcd0.padEnd(16, ' ')}
              </div>
              <div className="lcd-row">
                {deviceStatus.lcd1.padEnd(16, ' ')}
              </div>
            </div>
          </div>

          <h2 className="card-title" style={{ marginTop: '1.5rem' }}>
            <Layers size={20} /> System Parameters
          </h2>

          <div className="status-grid">
            <div className="status-card">
              <span className="status-label">Operational State</span>
              <span className="status-value" style={{ color: deviceStatus.state === 4 ? '#10b981' : '#f2f5f3' }}>
                {getStateText(deviceStatus.state)}
              </span>
            </div>

            <div className="status-card">
              <span className="status-label">Stacked Tokens</span>
              <span className="status-value" style={{ color: '#10b981' }}>
                {deviceStatus.tokens}
              </span>
            </div>

            <div className="status-card">
              <span className="status-label">Water Reservoir</span>
              <span className={`status-value ${deviceStatus.water_low ? 'alert-danger' : 'alert-success'}`}>
                {deviceStatus.water_low ? (
                  <span className="status-indicator">
                    <Droplet size={18} /> Water low, please refill
                  </span>
                ) : (
                  <span className="status-indicator">
                    <Droplet size={18} /> Sufficient
                  </span>
                )}
              </span>
            </div>

            <div className="status-card">
              <span className="status-label">Collection Bin</span>
              <span className={`status-value ${deviceStatus.bin_full ? 'alert-danger' : 'alert-success'}`}>
                {deviceStatus.bin_full ? (
                  <span className="status-indicator">
                    <Trash2 size={18} /> Bin is full!
                  </span>
                ) : (
                  <span className="status-indicator">
                    <Trash2 size={18} /> Normal Space
                  </span>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Right Side: Event logs */}
        <div className="card">
          <h2 className="card-title">
            <Radio size={20} /> SQLite Event Log History
          </h2>

          <div className="logs-list">
            {logs.length === 0 ? (
              <div style={{ color: '#5e6f66', textAlign: 'center', padding: '2rem' }}>
                No events recorded. Power on the system to start tracking.
              </div>
            ) : (
              logs.map((log, idx) => (
                <div key={idx} className={`log-item ${log.event_type.toLowerCase()}`}>
                  <div className="log-header">
                    <span>{log.event_type}</span>
                    <span>{new Date(log.created_at).toLocaleTimeString()}</span>
                  </div>
                  <div className="log-desc">{log.details}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Analytics Section */}
      <div className="card" style={{ marginTop: '2rem' }}>
        <h2 className="card-title">
          <BarChart3 size={20} className="text-primary" /> Recycling & Dispensing Analytics
        </h2>
        
        <div className="analytics-grid">
          {/* Day */}
          <div className="analytics-card">
            <span className="analytics-timeframe">Today</span>
            <div className="analytics-metric" style={{ marginTop: '0.5rem' }}>
              <span className="analytics-metric-label">Bottles Collected</span>
              <span className="analytics-metric-value">{analytics.today.bottles_collected} pcs</span>
            </div>
            <div className="analytics-metric">
              <span className="analytics-metric-label">Water Dispensed</span>
              <span className="analytics-metric-value">{formatVolume(analytics.today.tokens_spent)}</span>
            </div>
          </div>

          {/* Week */}
          <div className="analytics-card">
            <span className="analytics-timeframe">This Week</span>
            <div className="analytics-metric" style={{ marginTop: '0.5rem' }}>
              <span className="analytics-metric-label">Bottles Collected</span>
              <span className="analytics-metric-value">{analytics.week.bottles_collected} pcs</span>
            </div>
            <div className="analytics-metric">
              <span className="analytics-metric-label">Water Dispensed</span>
              <span className="analytics-metric-value">{formatVolume(analytics.week.tokens_spent)}</span>
            </div>
          </div>

          {/* Month */}
          <div className="analytics-card">
            <span className="analytics-timeframe">This Month</span>
            <div className="analytics-metric" style={{ marginTop: '0.5rem' }}>
              <span className="analytics-metric-label">Bottles Collected</span>
              <span className="analytics-metric-value">{analytics.month.bottles_collected} pcs</span>
            </div>
            <div className="analytics-metric">
              <span className="analytics-metric-label">Water Dispensed</span>
              <span className="analytics-metric-value">{formatVolume(analytics.month.tokens_spent)}</span>
            </div>
          </div>

          {/* Year */}
          <div className="analytics-card">
            <span className="analytics-timeframe">This Year</span>
            <div className="analytics-metric" style={{ marginTop: '0.5rem' }}>
              <span className="analytics-metric-label">Bottles Collected</span>
              <span className="analytics-metric-value">{analytics.year.bottles_collected} pcs</span>
            </div>
            <div className="analytics-metric">
              <span className="analytics-metric-label">Water Dispensed</span>
              <span className="analytics-metric-value">{formatVolume(analytics.year.tokens_spent)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
