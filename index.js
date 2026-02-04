import mqtt from 'mqtt';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import AlarmLog from './models/AlarmLog.js';

// Load environment variables
dotenv.config();

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/subtronics_alarms';
let mongoConnected = false;

mongoose.connect(MONGODB_URI)
.then(() => {
  console.log('✅ Connected to MongoDB Atlas');
  mongoConnected = true;
})
.catch((err) => {
  console.error('❌ MongoDB connection error:', err.message);
  console.log('⚠️  Running without database - alarms will be stored in memory only');
});

// Configuration
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://broker.zeptac.com:1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME || 'zeptac_iot';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || 'ZepIOT@123';
const HTTP_PORT = process.env.HTTP_PORT || 3002;
const MQTT_TOPICS = {
  DATA: process.env.MQTT_TOPIC_SUBTRONIC_DATA || 'subtronic/devices/+/data',
  COMMAND: process.env.MQTT_TOPIC_SUBTRONIC_COMMAND || 'subtronic/devices/+/command',
  SUBTRONICS: process.env.MQTT_TOPIC_SUBTRONICS || 'SubTronics/data'
};

// Initialize Express app
const app = express();
const httpServer = createServer(app);

// Initialize Socket.IO with CORS
const io = new Server(httpServer, {
  cors: {
    origin: function (origin, callback) {
      // Allow all Vercel preview deployments
      if (!origin || origin.includes('vercel.app')) {
        return callback(null, true);
      }
      
      // List of allowed local origins
      const allowedOrigins = [
        'http://localhost:3001',
        'http://localhost:3000',
        'http://localhost:5173',
        'http://localhost:5174',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174'
      ];
      
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling']
});

// CORS configuration to allow both local and Vercel frontend
const corsOptions = {
  origin: function (origin, callback) {
    // List of allowed origins
    const allowedOrigins = [
      'http://localhost:3001',
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
      'https://subtronic-frontend.vercel.app'
    ];
    
    // Allow from environment variable if set
    if (process.env.ALLOWED_ORIGINS) {
      allowedOrigins.push(...process.env.ALLOWED_ORIGINS.split(','));
    }
    
    // Allow all Vercel preview deployments
    if (!origin || origin.includes('vercel.app')) {
      return callback(null, true);
    }
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Log blocked origins for debugging
    console.log('⚠️ CORS blocked origin:', origin);
    return callback(new Error('CORS not allowed'), false);
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
};

app.use(cors(corsOptions));
app.use(express.json());

// Device data storage (in-memory for simplicity)
const deviceData = new Map();
const pendingCommands = new Map();
const subtronicsData = new Map(); // Store Subtronics Gas Monitor data
const alarmLogs = new Map(); // Store alarm history logs

// WebSocket connection tracking
let connectedClients = 0;

// Socket.IO connection handler
io.on('connection', (socket) => {
  connectedClients++;
  console.log(`🔌 Client connected (ID: ${socket.id}) - Total clients: ${connectedClients}`);
  
  // Send current data to newly connected client
  socket.on('subscribe:device', (deviceId) => {
    console.log(`📡 Client ${socket.id} subscribed to device ${deviceId}`);
    socket.join(`device:${deviceId}`);
    
    // Send current data immediately
    if (subtronicsData.has(deviceId)) {
      socket.emit('device:data', {
        deviceId,
        data: subtronicsData.get(deviceId)
      });
    }
  });
  
  socket.on('unsubscribe:device', (deviceId) => {
    console.log(`📡 Client ${socket.id} unsubscribed from device ${deviceId}`);
    socket.leave(`device:${deviceId}`);
  });
  
  socket.on('disconnect', () => {
    connectedClients--;
    console.log(`🔌 Client disconnected (ID: ${socket.id}) - Total clients: ${connectedClients}`);
  });
});

// Initialize MQTT client (optional - will work without MQTT broker)
let mqttClient = null;
let mqttConnected = false;

try {
  mqttClient = mqtt.connect(MQTT_BROKER, {
    clientId: process.env.MQTT_CLIENT_ID || `subtronic-backend-${Date.now()}`,
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    keepalive: 60,
    reconnectPeriod: 1000,
    connectTimeout: 10000,
    clean: true
  });
  
  console.log(`🔗 Attempting to connect to MQTT broker: ${MQTT_BROKER}`);
  console.log(`👤 Using username: ${MQTT_USERNAME}`);
} catch (error) {
  console.log('⚠️  MQTT broker not available, running in standalone mode');
  console.error('MQTT Error:', error);
}

/**
 * Parse Subtronics Gas Monitor payload
 * Converts nested JSON to normalized flat structure
 */
function parseSubtronicsPayload(rawJson) {
  try {
    const data = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
    
    // Extract device info - handle both "Device Alias Name" and "Device Alise Name"
    const deviceName = data["Device Alias Name"] || data["Device Alise Name"] || "Unknown Device";
    const serialNumber = data["OTSM-2 Serial Number"] || "Unknown";
    const gasType = data["Gas"] || "Unknown Gas";
    
    // Handle timestamp - use "Date Time At Reading" or "timestamp"
    const timestamp = data["Date Time At Reading"] || data["timestamp"] || new Date().toISOString();
    
    const messageType = data["Message Type"] || "LOG DATA";
    const sender = data["Sender"] || "Device";
    
    // Extract parameters
    const params = data["Parameters"] || {};
    
    // Handle unit - can be in Parameters or root level
    let unit = "ppm";
    if (params["Unit of Measurement "] !== undefined) {
      // Map numeric unit codes to text
      const unitCode = parseInt(params["Unit of Measurement "]);
      unit = unitCode === 1 ? "ppm" : "ppm"; // Add more mappings as needed
    } else if (params["Unit of Measurement"] !== undefined) {
      unit = params["Unit of Measurement"];
    } else if (data["Unit of Measurement "] !== undefined) {
      unit = data["Unit of Measurement "];
    } else if (data["Unit of Measurement"] !== undefined) {
      unit = data["Unit of Measurement"];
    }
    
    // Handle sensor reading - MAP "Live Sensor Readings " to offset for frontend compatibility
    // Priority: Live Sensor Readings (with/without space) > Sensor Reading > Offset
    let gasConcentration = 0;
    if (params["Live Sensor Readings "] !== undefined) {
      gasConcentration = parseFloat(params["Live Sensor Readings "]);
    } else if (params["Live Sensor Readings"] !== undefined) {
      gasConcentration = parseFloat(params["Live Sensor Readings"]);
    } else if (data["Sensor Reading"] !== undefined) {
      gasConcentration = parseFloat(data["Sensor Reading"]);
    } else if (params["Offset"] !== undefined) {
      gasConcentration = parseFloat(params["Offset"]);
    }
    
    // Handle alarm status - derive from LED status
    const alarm1Led = parseInt(params["Alarm 1 LED Status"]) || 0;
    const alarm2Led = parseInt(params["Alarm 2 LED Status"]) || 0;
    const alarm3Led = parseInt(params["Alarm 3 LED Status"]) || 0;
    const sensorFault = parseInt(params["Sensor Fault"]) || parseInt(params["SensorFault"]) || 0;
    
    let alarmStatus = "NORMAL";
    if (sensorFault === 1 || alarm3Led === 1 || alarm2Led === 1 || alarm1Led === 1) {
      alarmStatus = "ALARM";
    }
    
    // Handle location - can be in Parameters or root level
    const latitude = data["lat"] || params["lat"] || "0.00";
    const longitude = data["long"] || params["long"] || "0.00";
    
    // Create normalized payload - MAP Live Sensor Readings to "offset" field
    const normalized = {
      // Device Info
      device_name: deviceName,
      serial_number: serialNumber,
      gas_type: gasType,
      timestamp: timestamp,
      unit: unit.toString().trim(),
      message_type: messageType,
      sender: sender,
      
      // Core Readings - IMPORTANT: offset is the gas concentration for frontend
      sensor_reading: gasConcentration,
      offset: gasConcentration, // Map Live Sensor Readings to offset for frontend compatibility
      alarm_status: alarmStatus,
      
      // Span and Alarm Levels
      span_high: parseInt(params["Span High"]) || 2000,
      span_low: parseInt(params["Span Low"]) || 0,
      a1_level: parseInt(params["Alarm Level A1"]) || 250,
      a2_level: parseInt(params["Alarm Level A2"]) || 500,
      a3_level: parseInt(params["Alarm Level A3"]) || 1000,
      decimal_point: parseInt(params["Decimal Point"]) || 0,
      
      // Alarm Configuration
      a1_type: params["A1Type"] || "High",
      a1_hysteresis: parseInt(params["A1Hysterysis"]) || 0,
      a1_latching: parseInt(params["A1Latching"]) || 0,
      a1_siren: parseInt(params["A1Siren"]) || 0,
      a1_buzzer: parseInt(params["A1Buzzer"]) || 0,
      
      // Alarm LED Status
      alarm1_led: alarm1Led,
      alarm2_led: alarm2Led,
      alarm3_led: alarm3Led,
      sensor_fault: sensorFault,
      
      // Location
      latitude: latitude,
      longitude: longitude,
      
      // Metadata
      raw_message: data,
      processed_at: new Date().toISOString(),
      data_quality: 'good'
    };
    
    console.log(`📊 Parsed data - Gas Concentration: ${gasConcentration} ${unit} (mapped to offset field)`);
    console.log(`   sensor_reading: ${normalized.sensor_reading}, offset: ${normalized.offset}`);
    console.log(`   Alarm LEDs - A1: ${alarm1Led}, A2: ${alarm2Led}, A3: ${alarm3Led}, Fault: ${sensorFault}`);
    
    return normalized;
  } catch (error) {
    console.error('❌ Error parsing Subtronics payload:', error);
    return null;
  }
}

/**
 * Log alarm event to persistent storage (MongoDB)
 */
async function logAlarmEvent(deviceId, alarmData) {
  const logEntry = {
    device_id: deviceId,
    device_name: alarmData.device_name,
    serial_number: alarmData.serial_number,
    alarm_type: alarmData.type,
    severity: alarmData.severity,
    message: alarmData.message,
    threshold: alarmData.threshold,
    current_value: alarmData.current_value,
    unit: alarmData.unit,
    gas_type: alarmData.gas_type,
    timestamp: new Date(alarmData.timestamp),
    acknowledged: false,
    acknowledged_at: null,
    acknowledged_by: null
  };
  
  try {
    // Save to MongoDB if connected
    if (mongoConnected) {
      const savedLog = await AlarmLog.create(logEntry);
      console.log(`📝 Logged alarm to MongoDB: ${alarmData.type} for device ${deviceId} (ID: ${savedLog._id})`);
      return savedLog;
    } else {
      // Fallback to in-memory storage
      const deviceLogs = alarmLogs.get(deviceId) || [];
      logEntry.id = `log_${deviceId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      deviceLogs.push(logEntry);
      
      // Keep only last 1000 logs per device to prevent memory issues
      if (deviceLogs.length > 1000) {
        deviceLogs.shift();
      }
      
      alarmLogs.set(deviceId, deviceLogs);
      console.log(`📝 Logged alarm to memory: ${alarmData.type} for device ${deviceId}`);
      return logEntry;
    }
  } catch (error) {
    console.error('❌ Error logging alarm:', error);
    // Fallback to in-memory on error
    const deviceLogs = alarmLogs.get(deviceId) || [];
    logEntry.id = `log_${deviceId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    deviceLogs.push(logEntry);
    alarmLogs.set(deviceId, deviceLogs);
    return logEntry;
  }
}

/**
 * Generate alerts based on Subtronics data
 * Checks both LED status AND actual sensor readings vs thresholds
 */
function generateSubtronicsAlerts(data) {
  const alerts = [];
  
  // Check sensor fault
  if (data.sensor_fault === 1) {
    const alert = {
      id: `fault_${data.serial_number}_${Date.now()}`,
      type: 'sensor_fault',
      severity: 'critical',
      message: 'Sensor fault detected',
      timestamp: new Date().toISOString(),
      device_name: data.device_name,
      serial_number: data.serial_number,
      current_value: data.sensor_reading,
      unit: data.unit,
      gas_type: data.gas_type
    };
    alerts.push(alert);
    
    // Log the alarm event
    logAlarmEvent(data.serial_number, alert);
  }
  
  // Check if sensor reading exceeds thresholds (regardless of LED status)
  const sensorReading = parseFloat(data.sensor_reading) || 0;
  const a1Level = parseFloat(data.a1_level) || 250;
  const a2Level = parseFloat(data.a2_level) || 500;
  const a3Level = parseFloat(data.a3_level) || 1000;
  
  console.log(`🔍 Checking thresholds: Reading=${sensorReading}, A1=${a1Level}, A2=${a2Level}, A3=${a3Level}`);
  
  // Check A3 first (highest priority)
  if (sensorReading >= a3Level) {
    const alert = {
      id: `alarm3_${data.serial_number}_${Date.now()}`,
      type: 'alarm_level_3',
      severity: 'critical',
      message: `Gas concentration above A3 threshold (${a3Level} ${data.unit})`,
      timestamp: new Date().toISOString(),
      device_name: data.device_name,
      serial_number: data.serial_number,
      threshold: a3Level,
      current_value: sensorReading,
      unit: data.unit,
      gas_type: data.gas_type
    };
    alerts.push(alert);
    console.log(`🚨 A3 Alarm: ${sensorReading} ${data.unit} >= ${a3Level} ${data.unit}`);
    logAlarmEvent(data.serial_number, alert);
  }
  // Check A2 (medium priority)
  else if (sensorReading >= a2Level) {
    const alert = {
      id: `alarm2_${data.serial_number}_${Date.now()}`,
      type: 'alarm_level_2',
      severity: 'high',
      message: `Gas concentration above A2 threshold (${a2Level} ${data.unit})`,
      timestamp: new Date().toISOString(),
      device_name: data.device_name,
      serial_number: data.serial_number,
      threshold: a2Level,
      current_value: sensorReading,
      unit: data.unit,
      gas_type: data.gas_type
    };
    alerts.push(alert);
    console.log(`🚨 A2 Alarm: ${sensorReading} ${data.unit} >= ${a2Level} ${data.unit}`);
    logAlarmEvent(data.serial_number, alert);
  }
  // Check A1 (low priority)
  else if (sensorReading >= a1Level) {
    const alert = {
      id: `alarm1_${data.serial_number}_${Date.now()}`,
      type: 'alarm_level_1',
      severity: 'warning',
      message: `Gas concentration above A1 threshold (${a1Level} ${data.unit})`,
      timestamp: new Date().toISOString(),
      device_name: data.device_name,
      serial_number: data.serial_number,
      threshold: a1Level,
      current_value: sensorReading,
      unit: data.unit,
      gas_type: data.gas_type
    };
    alerts.push(alert);
    console.log(`🚨 A1 Alarm: ${sensorReading} ${data.unit} >= ${a1Level} ${data.unit}`);
    logAlarmEvent(data.serial_number, alert);
  } else {
    console.log(`✅ No alarm: ${sensorReading} ${data.unit} is below A1 threshold (${a1Level} ${data.unit})`);
  }
  
  return alerts;
}

// MQTT Connection Events (if MQTT client exists)
if (mqttClient) {
  mqttClient.on('connect', () => {
    console.log('🔌 Connected to MQTT broker');
    mqttConnected = true;
    
    // Subscribe to device data and command topics
    mqttClient.subscribe(MQTT_TOPICS.DATA, (err) => {
      if (err) console.error('❌ Failed to subscribe to data topic:', err);
      else console.log('📡 Subscribed to:', MQTT_TOPICS.DATA);
    });
    
    mqttClient.subscribe(MQTT_TOPICS.COMMAND, (err) => {
      if (err) console.error('❌ Failed to subscribe to command topic:', err);
      else console.log('📡 Subscribed to:', MQTT_TOPICS.COMMAND);
    });
    
    // Subscribe to Subtronics Gas Monitor topic
    mqttClient.subscribe(MQTT_TOPICS.SUBTRONICS, (err) => {
      if (err) console.error('❌ Failed to subscribe to Subtronics topic:', err);
      else console.log('📡 Subscribed to:', MQTT_TOPICS.SUBTRONICS);
    });
  });

  mqttClient.on('error', (err) => {
    console.error('🚨 MQTT Error:', err);
    mqttConnected = false;
  });

  mqttClient.on('offline', () => {
    console.log('📴 MQTT client offline');
    mqttConnected = false;
  });

  mqttClient.on('reconnect', () => {
    console.log('🔄 MQTT client reconnecting...');
  });

  // MQTT Message Handler
  mqttClient.on('message', (topic, message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log(`📨 Received on ${topic}:`, data);
      
      // Handle Subtronics Gas Monitor data
      if (topic === 'SubTronics/data') {
        const normalized = parseSubtronicsPayload(data);
        
        if (normalized) {
          // Use serial number as device ID
          const deviceId = normalized.serial_number;
          
          // Store normalized data
          subtronicsData.set(deviceId, normalized);
          
          // Broadcast to all connected WebSocket clients subscribed to this device
          io.to(`device:${deviceId}`).emit('device:data', {
            deviceId,
            data: normalized,
            timestamp: new Date().toISOString()
          });
          
          console.log(`💾 Stored and broadcasted Subtronics data for device ${deviceId} to ${connectedClients} clients`);
          
          // Generate alerts
          const alerts = generateSubtronicsAlerts(normalized);
          if (alerts.length > 0) {
            console.log(`🚨 Generated ${alerts.length} alerts for device ${deviceId}`);
            // Store alerts (in production, this would go to a database)
            const existingAlerts = subtronicsData.get(`${deviceId}_alerts`) || [];
            subtronicsData.set(`${deviceId}_alerts`, [...existingAlerts, ...alerts]);
            
            // Broadcast alerts
            io.to(`device:${deviceId}`).emit('device:alerts', {
              deviceId,
              alerts
            });
          }
        }
        return;
      }
      
      // Extract device ID from topic
      const deviceId = topic.split('/')[2];
      
      if (topic.includes('/data')) {
        // Store device data
        deviceData.set(deviceId, {
          ...data,
          deviceId,
          timestamp: new Date().toISOString(),
          lastSeen: new Date().toISOString()
        });
        console.log(`💾 Stored data for device ${deviceId}`);
      }
      
      if (topic.includes('/command')) {
        // Handle command response
        if (data.command_id && pendingCommands.has(data.command_id)) {
          const command = pendingCommands.get(data.command_id);
          command.status = data.status || 'completed';
          command.result = data.result;
          command.completed_at = new Date().toISOString();
          console.log(`✅ Command ${data.command_id} completed`);
        }
      }
      
    } catch (err) {
      console.error('❌ Error parsing MQTT message:', err);
    }
  });
}

// REST API Endpoints

// Get Subtronics device telemetry
app.get('/devices/:deviceId/subtronics/telemetry/latest', (req, res) => {
  const { deviceId } = req.params;
  
  if (subtronicsData.has(deviceId)) {
    const data = subtronicsData.get(deviceId);
    res.json(data);
    console.log(`📤 Sent Subtronics telemetry for device ${deviceId}`);
  } else {
    // Return mock data for demo purposes
    const mockData = {
      device_name: "Gas Sensor Block1",
      serial_number: "OTSM-0114",
      gas_type: "Carbon Monoxide (CO)",
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      unit: "ppm",
      message_type: "LOG DATA",
      sender: "Device",
      
      // Core Readings
      sensor_reading: 0, // Will be updated when real data arrives
      alarm_status: "NORMAL",
      offset: 0,
      span_high: 2000,
      span_low: 0,
      a1_level: 250,
      a2_level: 500,
      a3_level: 1000,
      decimal_point: 0,
      
      // Alarm Configuration
      a1_type: "High",
      a1_hysteresis: 0,
      a1_latching: 0,
      a1_siren: 0,
      a1_buzzer: 0,
      
      // Alarm LED Status
      alarm1_led: 0,
      alarm2_led: 0,
      alarm3_led: 0,
      sensor_fault: 0,
      
      // Location
      latitude: "19.0760",
      longitude: "72.8777",
      
      // Metadata
      processed_at: new Date().toISOString(),
      data_quality: 'good'
    };
    
    subtronicsData.set(deviceId, mockData);
    res.json(mockData);
    console.log(`📤 Sent mock Subtronics telemetry for device ${deviceId}`);
  }
});

// Get Subtronics device alerts
app.get('/devices/:deviceId/subtronics/alerts', (req, res) => {
  const { deviceId } = req.params;
  const alerts = subtronicsData.get(`${deviceId}_alerts`) || [];
  
  res.json(alerts);
  console.log(`📤 Sent ${alerts.length} alerts for device ${deviceId}`);
});

// Get alarm logs (history) for a device
app.get('/devices/:deviceId/alarm-logs', async (req, res) => {
  const { deviceId } = req.params;
  const { start_date, end_date, alarm_type, severity, limit = 100 } = req.query;
  
  try {
    if (mongoConnected) {
      // Query MongoDB
      const query = { device_id: deviceId };
      
      // Filter by date range
      if (start_date || end_date) {
        query.timestamp = {};
        if (start_date) query.timestamp.$gte = new Date(start_date);
        if (end_date) query.timestamp.$lte = new Date(end_date);
      }
      
      // Filter by alarm type
      if (alarm_type) query.alarm_type = alarm_type;
      
      // Filter by severity
      if (severity) query.severity = severity;
      
      const logs = await AlarmLog.find(query)
        .sort({ timestamp: -1 })
        .limit(parseInt(limit))
        .lean();
      
      res.json({
        device_id: deviceId,
        total_count: logs.length,
        logs: logs
      });
      
      console.log(`📤 Sent ${logs.length} alarm logs for device ${deviceId} from MongoDB`);
    } else {
      // Fallback to in-memory
      let logs = alarmLogs.get(deviceId) || [];
      
      // Apply filters (same as before)
      if (start_date) {
        const startTime = new Date(start_date).getTime();
        logs = logs.filter(log => new Date(log.timestamp).getTime() >= startTime);
      }
      
      if (end_date) {
        const endTime = new Date(end_date).getTime();
        logs = logs.filter(log => new Date(log.timestamp).getTime() <= endTime);
      }
      
      if (alarm_type) logs = logs.filter(log => log.alarm_type === alarm_type);
      if (severity) logs = logs.filter(log => log.severity === severity);
      
      logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      logs = logs.slice(0, parseInt(limit));
      
      res.json({
        device_id: deviceId,
        total_count: logs.length,
        logs: logs
      });
      
      console.log(`📤 Sent ${logs.length} alarm logs for device ${deviceId} from memory`);
    }
  } catch (error) {
    console.error('❌ Error fetching alarm logs:', error);
    res.status(500).json({ error: 'Failed to fetch alarm logs', details: error.message });
  }
});

// Get alarm logs for all devices
app.get('/alarm-logs', async (req, res) => {
  const { start_date, end_date, alarm_type, severity, device_id, limit = 100 } = req.query;
  
  try {
    if (mongoConnected) {
      // Query MongoDB
      const query = {};
      
      // Filter by device
      if (device_id) query.device_id = device_id;
      
      // Filter by date range
      if (start_date || end_date) {
        query.timestamp = {};
        if (start_date) query.timestamp.$gte = new Date(start_date);
        if (end_date) query.timestamp.$lte = new Date(end_date);
      }
      
      // Filter by alarm type
      if (alarm_type) query.alarm_type = alarm_type;
      
      // Filter by severity
      if (severity) query.severity = severity;
      
      const logs = await AlarmLog.find(query)
        .sort({ timestamp: -1 })
        .limit(parseInt(limit))
        .lean();
      
      res.json({
        total_count: logs.length,
        logs: logs
      });
      
      console.log(`📤 Sent ${logs.length} alarm logs from MongoDB`);
    } else {
      // Fallback to in-memory
      let allLogs = [];
      for (const [deviceId, logs] of alarmLogs.entries()) {
        allLogs = allLogs.concat(logs);
      }
      
      // Apply filters
      if (device_id) allLogs = allLogs.filter(log => log.device_id === device_id);
      
      if (start_date) {
        const startTime = new Date(start_date).getTime();
        allLogs = allLogs.filter(log => new Date(log.timestamp).getTime() >= startTime);
      }
      
      if (end_date) {
        const endTime = new Date(end_date).getTime();
        allLogs = allLogs.filter(log => new Date(log.timestamp).getTime() <= endTime);
      }
      
      if (alarm_type) allLogs = allLogs.filter(log => log.alarm_type === alarm_type);
      if (severity) allLogs = allLogs.filter(log => log.severity === severity);
      
      allLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      allLogs = allLogs.slice(0, parseInt(limit));
      
      res.json({
        total_count: allLogs.length,
        logs: allLogs
      });
      
      console.log(`📤 Sent ${allLogs.length} alarm logs from memory`);
    }
  } catch (error) {
    console.error('❌ Error fetching alarm logs:', error);
    res.status(500).json({ error: 'Failed to fetch alarm logs', details: error.message });
  }
});

// Get alarm statistics
app.get('/alarm-logs/statistics', async (req, res) => {
  const { start_date, end_date, device_id } = req.query;
  
  try {
    if (mongoConnected) {
      // Query MongoDB
      const query = {};
      
      if (device_id) query.device_id = device_id;
      
      if (start_date || end_date) {
        query.timestamp = {};
        if (start_date) query.timestamp.$gte = new Date(start_date);
        if (end_date) query.timestamp.$lte = new Date(end_date);
      }
      
      const logs = await AlarmLog.find(query).lean();
      
      // Calculate statistics
      const stats = {
        total_alarms: logs.length,
        by_type: {},
        by_severity: {},
        by_device: {},
        acknowledged_count: logs.filter(log => log.acknowledged).length,
        unacknowledged_count: logs.filter(log => !log.acknowledged).length
      };
      
      logs.forEach(log => {
        stats.by_type[log.alarm_type] = (stats.by_type[log.alarm_type] || 0) + 1;
        stats.by_severity[log.severity] = (stats.by_severity[log.severity] || 0) + 1;
        stats.by_device[log.device_id] = (stats.by_device[log.device_id] || 0) + 1;
      });
      
      res.json(stats);
      console.log(`📤 Sent alarm statistics from MongoDB`);
    } else {
      // Fallback to in-memory
      let allLogs = [];
      
      if (device_id) {
        allLogs = alarmLogs.get(device_id) || [];
      } else {
        for (const [deviceId, logs] of alarmLogs.entries()) {
          allLogs = allLogs.concat(logs);
        }
      }
      
      // Filter by date range
      if (start_date) {
        const startTime = new Date(start_date).getTime();
        allLogs = allLogs.filter(log => new Date(log.timestamp).getTime() >= startTime);
      }
      
      if (end_date) {
        const endTime = new Date(end_date).getTime();
        allLogs = allLogs.filter(log => new Date(log.timestamp).getTime() <= endTime);
      }
      
      // Calculate statistics
      const stats = {
        total_alarms: allLogs.length,
        by_type: {},
        by_severity: {},
        by_device: {},
        acknowledged_count: allLogs.filter(log => log.acknowledged).length,
        unacknowledged_count: allLogs.filter(log => !log.acknowledged).length
      };
      
      allLogs.forEach(log => {
        stats.by_type[log.alarm_type] = (stats.by_type[log.alarm_type] || 0) + 1;
        stats.by_severity[log.severity] = (stats.by_severity[log.severity] || 0) + 1;
        stats.by_device[log.device_id] = (stats.by_device[log.device_id] || 0) + 1;
      });
      
      res.json(stats);
      console.log(`📤 Sent alarm statistics from memory`);
    }
  } catch (error) {
    console.error('❌ Error fetching alarm statistics:', error);
    res.status(500).json({ error: 'Failed to fetch statistics', details: error.message });
  }
});

// Acknowledge Subtronics alert
app.post('/devices/:deviceId/subtronics/alerts/:alertId/acknowledge', (req, res) => {
  const { deviceId, alertId } = req.params;
  const { acknowledged_by } = req.body;
  
  const alerts = subtronicsData.get(`${deviceId}_alerts`) || [];
  const alertIndex = alerts.findIndex(alert => alert.id === alertId);
  
  if (alertIndex !== -1) {
    alerts[alertIndex].acknowledged_at = new Date().toISOString();
    alerts[alertIndex].acknowledged_by = acknowledged_by;
    subtronicsData.set(`${deviceId}_alerts`, alerts);
    
    console.log(`✅ Alert ${alertId} acknowledged by ${acknowledged_by} for device ${deviceId}`);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Alert not found' });
  }
});

// Get device data (existing Subtronic functionality)
app.get('/subtronic/devices/:deviceId/data', (req, res) => {
  const { deviceId } = req.params;
  
  if (deviceData.has(deviceId)) {
    const data = deviceData.get(deviceId);
    res.json(data);
    console.log(`📤 Sent data for device ${deviceId}`);
  } else {
    // Return mock data if device not found
    const mockData = {
      deviceId,
      timestamp: new Date().toISOString(),
      quality: 'good',
      measurements: {
        potential_on: -950 + Math.random() * 100,
        potential_off: -1200 + Math.random() * 100,
        current_protection: 25 + Math.random() * 10,
        resistance_structure: 1250 + Math.random() * 200,
        temperature: 23 + Math.random() * 5,
        battery_voltage: 12.5 + Math.random() * 0.5,
        signal_strength: -65 + Math.random() * 10
      },
      configuration: {
        electrode_type: 'cu_cuso4',
        measurement_mode: 'normal',
        logging_interval: 300,
        thresholds: {
          potential_high: -800,
          potential_low: -1500,
          current_high: 100,
          current_low: 5
        }
      },
      status: {
        operational_state: 'normal',
        last_communication: new Date().toISOString(),
        uptime: 86400,
        firmware_version: 'v3.2.1',
        hardware_revision: 'Rev-B'
      },
      location: {
        site_name: `Site ${deviceId}`,
        latitude: 40.7128 + Math.random() * 0.01,
        longitude: -74.0060 + Math.random() * 0.01,
        installation_date: '2024-01-15'
      }
    };
    
    deviceData.set(deviceId, mockData);
    res.json(mockData);
    console.log(`📤 Sent mock data for device ${deviceId}`);
  }
});

// Send command to device (existing functionality)
app.post('/subtronic/devices/:deviceId/commands', (req, res) => {
  const { deviceId } = req.params;
  const commandData = req.body;
  
  // Generate command ID if not provided
  const commandId = commandData.command_id || uuidv4();
  
  const command = {
    command_id: commandId,
    device_id: deviceId,
    command_type: commandData.command_type,
    parameters: commandData.parameters || {},
    priority: commandData.priority || 'normal',
    timeout: commandData.timeout || 30,
    status: 'pending',
    submitted_at: new Date().toISOString()
  };
  
  // Store pending command
  pendingCommands.set(commandId, command);
  
  // Publish command to MQTT
  const topic = `subtronic/devices/${deviceId}/command`;
  if (mqttClient && mqttConnected) {
    mqttClient.publish(topic, JSON.stringify(command), (err) => {
      if (err) {
        console.error(`❌ Failed to publish command to ${topic}:`, err);
        res.status(500).json({ error: 'Failed to send command' });
      } else {
        console.log(`📤 Published command ${commandId} to device ${deviceId}`);
        res.json(command);
      }
    });
  } else {
    console.log(`📤 MQTT not connected, storing command ${commandId} for device ${deviceId}`);
    res.json(command);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    mqtt_connected: mqttConnected,
    mongodb_connected: mongoConnected,
    devices_count: deviceData.size,
    subtronics_devices: subtronicsData.size,
    pending_commands: pendingCommands.size,
    allowed_origins: allowedOrigins,
    timestamp: new Date().toISOString()
  });
});

// Frontend configuration endpoint
app.get('/config', (req, res) => {
  res.json({
    api_base_url: `http://localhost:${HTTP_PORT}`,
    mqtt_broker: MQTT_BROKER,
    mqtt_topics: MQTT_TOPICS,
    frontend_urls: [
      'http://localhost:3000',
      'https://subtronic-frontend.vercel.app'
    ],
    endpoints: {
      health: '/health',
      subtronics_telemetry: '/devices/{deviceId}/subtronics/telemetry/latest',
      subtronics_alerts: '/devices/{deviceId}/subtronics/alerts',
      test_publish: '/test/subtronics/{deviceId}'
    }
  });
});

// Test endpoint to publish mock Subtronics data
app.post('/test/subtronics/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  
  // Use provided data or generate mock data
  const mockPayload = req.body || {
    "Device Alise Name": "Gas Sensor Block1",
    "OTSM-2 Serial Number": deviceId,
    "Gas": "Carbon Monoxide (CO)",
    "timestamp": new Date().toISOString(),
    "Sender": "Device",
    "Message Type": "LOG DATA",
    "Unit of Measurement ": " ppm",
    "Parameters": {
      "Live Sensor Readings ": Math.floor(Math.random() * 1500),
      "Span High": 2000,
      "Span Low": 0,
      "Alarm Level A1": 250,
      "Alarm Level A2": 500,
      "Alarm Level A3": 1000,
      "Decimal Point": 0,
      "A1Type": "High",
      "A1Hysterysis": 0,
      "A1Latching": 0,
      "A1Siren": 0,
      "A1Buzzer": 0,
      "Alarm 1 LED Status": Math.random() > 0.8 ? 1 : 0,
      "Alarm 2 LED Status": Math.random() > 0.9 ? 1 : 0,
      "Alarm 3 LED Status": Math.random() > 0.95 ? 1 : 0,
      "SensorFault": Math.random() > 0.98 ? 1 : 0,
      "lat": "19.0760",
      "long": "72.8777"
    }
  };
  
  const topic = `SubTronics/data`;
  
  // Process data directly (simulate MQTT message handling)
  try {
    const normalized = parseSubtronicsPayload(mockPayload);
    
    if (normalized) {
      // Use serial number as device ID
      const processedDeviceId = normalized.serial_number;
      
      // Store normalized data
      subtronicsData.set(processedDeviceId, normalized);
      
      // Broadcast to all connected WebSocket clients subscribed to this device
      io.to(`device:${processedDeviceId}`).emit('device:data', {
        deviceId: processedDeviceId,
        data: normalized,
        timestamp: new Date().toISOString()
      });
      
      console.log(`💾 Processed test data for device ${processedDeviceId}`);
      
      // Generate alerts
      const alerts = generateSubtronicsAlerts(normalized);
      if (alerts.length > 0) {
        console.log(`🚨 Generated ${alerts.length} alerts for device ${processedDeviceId}`);
        // Store alerts
        const existingAlerts = subtronicsData.get(`${processedDeviceId}_alerts`) || [];
        subtronicsData.set(`${processedDeviceId}_alerts`, [...existingAlerts, ...alerts]);
        
        // Broadcast alerts
        io.to(`device:${processedDeviceId}`).emit('device:alerts', {
          deviceId: processedDeviceId,
          alerts
        });
      }
      
      res.json({ 
        message: 'Test Subtronics data processed successfully', 
        deviceId: processedDeviceId,
        data: normalized,
        alerts: alerts,
        mqtt_published: false
      });
    } else {
      res.status(400).json({ error: 'Failed to parse payload' });
    }
  } catch (error) {
    console.error('❌ Error processing test data:', error);
    res.status(500).json({ error: 'Failed to process test data', details: error.message });
  }
  
  // Also try to publish via MQTT if connected
  if (mqttClient && mqttConnected) {
    mqttClient.publish(topic, JSON.stringify(mockPayload), (err) => {
      if (err) {
        console.error('❌ Failed to publish to MQTT:', err);
      } else {
        console.log(`📤 Also published to MQTT topic: ${topic}`);
      }
    });
  }
});

// Start HTTP server
httpServer.listen(HTTP_PORT, () => {
  console.log(`🚀 Subtronic MQTT Backend running on port ${HTTP_PORT}`);
  console.log(`📡 MQTT Broker: ${MQTT_BROKER}`);
  console.log(`🔗 API Base: http://localhost:${HTTP_PORT}`);
  console.log(`🔌 WebSocket: ws://localhost:${HTTP_PORT}`);
  console.log(`🧪 Test Subtronics: POST http://localhost:${HTTP_PORT}/test/subtronics/123`);
  console.log(`📊 Subtronics API: GET http://localhost:${HTTP_PORT}/devices/123/subtronics/telemetry/latest`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  io.close(() => {
    console.log('🔌 WebSocket server closed');
  });
  if (mqttClient) {
    mqttClient.end();
  }
  if (mongoConnected) {
    await mongoose.connection.close();
    console.log('🗄️  MongoDB connection closed');
  }
  httpServer.close(() => {
    console.log('🚪 HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down...');
  io.close(() => {
    console.log('🔌 WebSocket server closed');
  });
  if (mqttClient) {
    mqttClient.end();
  }
  if (mongoConnected) {
    await mongoose.connection.close();
    console.log('🗄️  MongoDB connection closed');
  }
  httpServer.close(() => {
    console.log('🚪 HTTP server closed');
    process.exit(0);
  });
});