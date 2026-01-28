import mqtt from 'mqtt';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';

// Load environment variables
dotenv.config();

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
    origin: process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',')
      : [
          'http://localhost:3001',
          'http://localhost:3000',
          'http://localhost:5173',
          'http://localhost:5174',
          'http://127.0.0.1:5173',
          'http://127.0.0.1:5174',
          'https://subtronic-frontend.vercel.app',
          'https://*.vercel.app'
        ],
    credentials: true,
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling']
});

// CORS configuration to allow both local and Vercel frontend
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',')
  : [
      'http://localhost:3001',
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
      'https://subtronic-frontend.vercel.app'
    ];

const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());

// Device data storage (in-memory for simplicity)
const deviceData = new Map();
const pendingCommands = new Map();
const subtronicsData = new Map(); // Store Subtronics Gas Monitor data

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
    const timestamp = data["timestamp"] || new Date().toISOString();
    const unit = data["Unit of Measurement"] || "ppm";
    const messageType = data["Message Type"] || "LOG DATA";
    const sender = data["Sender"] || "Device";
    
    // Handle sensor reading - use "Sensor Reading" if available, otherwise use Offset as fallback
    const sensorReading = data["Sensor Reading"] !== undefined 
      ? parseFloat(data["Sensor Reading"]) 
      : parseFloat(data["Parameters"]?.["Offset"]) || 0;
    
    // Handle alarm status - use "Alarm Status" if available, otherwise derive from LED status
    let alarmStatus = data["Alarm Status"] || "NORMAL";
    if (!data["Alarm Status"]) {
      // Derive alarm status from LED indicators
      const params = data["Parameters"] || {};
      const alarm1Led = parseInt(params["Alarm 1 LED Status"]) || 0;
      const alarm2Led = parseInt(params["Alarm 2 LED Status"]) || 0;
      const alarm3Led = parseInt(params["Alarm 3 LED Status"]) || 0;
      const sensorFault = parseInt(params["SensorFault"]) || 0;
      
      if (sensorFault === 1 || alarm3Led === 1 || alarm2Led === 1 || alarm1Led === 1) {
        alarmStatus = "ALARM";
      } else {
        alarmStatus = "NORMAL";
      }
    }
    
    // Extract parameters
    const params = data["Parameters"] || {};
    
    // Create normalized payload
    const normalized = {
      // Device Info
      device_name: deviceName,
      serial_number: serialNumber,
      gas_type: gasType,
      timestamp: timestamp,
      unit: unit.trim(),
      message_type: messageType,
      sender: sender,
      
      // Core Readings
      sensor_reading: sensorReading, // Current gas concentration
      alarm_status: alarmStatus,
      offset: parseInt(params["Offset"]) || 0,
      span_high: parseInt(params["Span High"]) || 0,
      span_low: parseInt(params["Span Low"]) || 0,
      a1_level: parseInt(params["Alarm Level A1"]) || 0,
      a2_level: parseInt(params["Alarm Level A2"]) || 0,
      a3_level: parseInt(params["Alarm Level A3"]) || 0,
      decimal_point: parseInt(params["Decimal Point"]) || 0,
      
      // Alarm Configuration
      a1_type: params["A1Type"] || "High",
      a1_hysteresis: parseInt(params["A1Hysterysis"]) || 0,
      a1_latching: parseInt(params["A1Latching"]) || 0,
      a1_siren: parseInt(params["A1Siren"]) || 0,
      a1_buzzer: parseInt(params["A1Buzzer"]) || 0,
      
      // Alarm LED Status
      alarm1_led: parseInt(params["Alarm 1 LED Status"]) || 0,
      alarm2_led: parseInt(params["Alarm 2 LED Status"]) || 0,
      alarm3_led: parseInt(params["Alarm 3 LED Status"]) || 0,
      sensor_fault: parseInt(params["SensorFault"]) || 0,
      
      // Location
      latitude: params["lat"] || "0.00",
      longitude: params["long"] || "0.00",
      
      // Metadata
      raw_message: data,
      processed_at: new Date().toISOString(),
      data_quality: 'good'
    };
    
    return normalized;
  } catch (error) {
    console.error('❌ Error parsing Subtronics payload:', error);
    return null;
  }
}

/**
 * Generate alerts based on Subtronics data
 */
function generateSubtronicsAlerts(data) {
  const alerts = [];
  
  // Check sensor fault
  if (data.sensor_fault === 1) {
    alerts.push({
      id: `fault_${data.serial_number}_${Date.now()}`,
      type: 'sensor_fault',
      severity: 'critical',
      message: 'Sensor fault detected',
      timestamp: new Date().toISOString(),
      device_name: data.device_name,
      serial_number: data.serial_number
    });
  }
  
  // Check alarm LED status
  if (data.alarm1_led === 1) {
    alerts.push({
      id: `alarm1_${data.serial_number}_${Date.now()}`,
      type: 'alarm_level_1',
      severity: 'warning',
      message: `Gas concentration above A1 threshold (${data.a1_level} ${data.unit})`,
      timestamp: new Date().toISOString(),
      device_name: data.device_name,
      serial_number: data.serial_number,
      threshold: data.a1_level
    });
  }
  
  if (data.alarm2_led === 1) {
    alerts.push({
      id: `alarm2_${data.serial_number}_${Date.now()}`,
      type: 'alarm_level_2',
      severity: 'high',
      message: `Gas concentration above A2 threshold (${data.a2_level} ${data.unit})`,
      timestamp: new Date().toISOString(),
      device_name: data.device_name,
      serial_number: data.serial_number,
      threshold: data.a2_level
    });
  }
  
  if (data.alarm3_led === 1) {
    alerts.push({
      id: `alarm3_${data.serial_number}_${Date.now()}`,
      type: 'alarm_level_3',
      severity: 'critical',
      message: `Gas concentration above A3 threshold (${data.a3_level} ${data.unit})`,
      timestamp: new Date().toISOString(),
      device_name: data.device_name,
      serial_number: data.serial_number,
      threshold: data.a3_level
    });
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
      'http://localhost:3001',
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
  
  const mockPayload = {
    "Device Alise Name": "Gas Sensor Block1",
    "OTSM-2 Serial Number": "OTSM-0114",
    "Gas": "Carbon Monoxide (CO)",
    "timestamp": new Date().toISOString(),
    "Sender": "Device",
    "Message Type": "LOG DATA",
    "Unit of Measurement ": " ppm",
    "Parameters": {
      "Offset": 0,
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
      "lat": "40.7128",
      "long": "-74.0060"
    }
  };
  
  const topic = `SubTronics/data`;
  if (mqttClient && mqttConnected) {
    mqttClient.publish(topic, JSON.stringify(mockPayload), (err) => {
      if (err) {
        res.status(500).json({ error: 'Failed to publish test data' });
      } else {
        res.json({ 
          message: 'Test Subtronics data published', 
          topic, 
          data: mockPayload 
        });
      }
    });
  } else {
    res.status(503).json({ 
      error: 'MQTT not connected', 
      message: 'Cannot publish test data without MQTT connection' 
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
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  io.close(() => {
    console.log('🔌 WebSocket server closed');
  });
  if (mqttClient) {
    mqttClient.end();
  }
  httpServer.close(() => {
    console.log('🚪 HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down...');
  io.close(() => {
    console.log('🔌 WebSocket server closed');
  });
  if (mqttClient) {
    mqttClient.end();
  }
  httpServer.close(() => {
    console.log('🚪 HTTP server closed');
    process.exit(0);
  });
});