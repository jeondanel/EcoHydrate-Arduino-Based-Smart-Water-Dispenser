const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Express REST Endpoints
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await db.getRecentLogs();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/status-history', async (req, res) => {
  try {
    const history = await db.getStatusHistory();
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ports', async (req, res) => {
  try {
    const ports = await SerialPort.list();
    res.json(ports);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analytics', async (req, res) => {
  try {
    const analytics = await db.getAnalytics();
    res.json(analytics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serial Connection Manager
let serialPort = null;
let parser = null;
let lastKnownState = null;
let lastKnownTokens = 0;

function connectToPort(path) {
  if (serialPort && serialPort.isOpen) {
    serialPort.close();
  }

  console.log(`Connecting to serial port: ${path}`);
  serialPort = new SerialPort({ path, baudRate: 9600 });
  parser = serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));

  serialPort.on('open', () => {
    console.log(`Serial port ${path} opened successfully.`);
    io.emit('connection_status', { connected: true, port: path });
    db.logEvent('SYSTEM', `Connected to serial port: ${path}`);
  });

  serialPort.on('error', (err) => {
    console.error('Serial port error:', err.message);
    io.emit('connection_status', { connected: false, error: err.message });
    db.logEvent('SYSTEM_ERROR', `Serial error: ${err.message}`);
  });

  serialPort.on('close', () => {
    console.log('Serial port closed.');
    io.emit('connection_status', { connected: false });
    db.logEvent('SYSTEM', 'Serial port connection closed.');
  });

  // Handle incoming data from Arduino
  parser.on('data', (dataStr) => {
    try {
      const data = JSON.parse(dataStr);
      
      // Mirror real-time status to WebClients
      io.emit('device_status', data);

      // Detect status/event changes to save to database
      handleDeviceEventLogs(data);

    } catch (e) {
      // Log raw string if parsing fails
      console.log('Raw Serial Output:', dataStr);
    }
  });
}

// Logic to determine when to log entries in SQLite
function handleDeviceEventLogs(data) {
  // Translate numeric state to readable states
  const stateNames = ["OFF", "STARTUP", "IDLE", "VERIFYING", "DISPENSING", "PAUSED"];
  const currentStateName = stateNames[data.state] || `UNKNOWN (${data.state})`;

  const broadcastAndLog = async (type, desc) => {
    try {
      await db.logEvent(type, desc);
      io.emit('new_log', {
        event_type: type,
        details: desc,
        created_at: new Date().toISOString()
      });
    } catch (err) {
      console.error('Error logging to database:', err);
    }
  };

  // Log on State Transitions
  if (data.state !== lastKnownState) {
    broadcastAndLog('STATE_CHANGE', `System state changed to: ${currentStateName}`);
    db.logStatus(data.water_low, data.bin_full, data.tokens, data.state);
    lastKnownState = data.state;
  }

  // Log on Token Changes
  if (data.tokens !== lastKnownTokens) {
    if (data.tokens > lastKnownTokens) {
      broadcastAndLog('TOKEN_ADDED', `Tokens increased: ${lastKnownTokens} -> ${data.tokens}`);
    } else {
      broadcastAndLog('TOKEN_SPENT', `Tokens spent: ${lastKnownTokens} -> ${data.tokens}`);
    }
    lastKnownTokens = data.tokens;
  }
}

// REST Route to manually initiate a connection
app.post('/api/connect', (req, res) => {
  const { path } = req.body;
  if (!path) {
    return res.status(400).json({ error: 'Port path is required.' });
  }
  try {
    connectToPort(path);
    res.json({ message: `Connection attempt to ${path} initiated.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Socket.io connection logic
io.on('connection', (socket) => {
  console.log('Web dashboard client connected.');
  
  // Send current connection status to the newly connected client
  socket.emit('connection_status', {
    connected: serialPort ? serialPort.isOpen : false,
    port: serialPort ? serialPort.path : null
  });

  socket.on('disconnect', () => {
    console.log('Web dashboard client disconnected.');
  });
});

// Auto-detect and connect to Arduino Uno/Nano if possible
async function autoConnect() {
  try {
    const ports = await SerialPort.list();
    // Search for common Arduino identifiers
    const arduinoPort = ports.find(p => 
      p.manufacturer && (p.manufacturer.includes('Arduino') || p.manufacturer.includes('CH340') || p.manufacturer.includes('FTDI'))
    );

    if (arduinoPort) {
      connectToPort(arduinoPort.path);
    } else {
      console.log('No Arduino found on boot. Waiting for manual dashboard selection.');
    }
  } catch (err) {
    console.error('Error auto-detecting serial ports:', err);
  }
}

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  autoConnect();
});
