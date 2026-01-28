# Installation Guide

## Quick Start

### 1. Install Dependencies

```bash
cd subtronic-backend
npm install
```

This will install:
- `socket.io` - WebSocket server
- `mqtt` - MQTT client
- `express` - HTTP server
- All other dependencies

### 2. Configure Environment

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Edit `.env`:
```bash
MQTT_BROKER=mqtt://broker.zeptac.com:1883
MQTT_USERNAME=zeptac_iot
MQTT_PASSWORD=ZepIOT@123
HTTP_PORT=3002
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
```

### 3. Start Server

```bash
npm start
```

You should see:
```
🚀 Subtronic MQTT Backend running on port 3002
📡 MQTT Broker: mqtt://broker.zeptac.com:1883
🔗 API Base: http://localhost:3002
🔌 WebSocket: ws://localhost:3002
🔌 Connected to MQTT broker
📡 Subscribed to: SubTronics/data
```

### 4. Test WebSocket

Open browser console and run:
```javascript
const socket = io('http://localhost:3002');
socket.on('connect', () => console.log('✅ Connected!'));
socket.emit('subscribe:device', 'OTSM-0114');
socket.on('device:data', (data) => console.log('📨 Data:', data));
```

### 5. Test with Simulator

In another terminal:
```bash
cd "device sim"
python gas_sensor_simulator.py
```

You should see real-time data in the browser console!

## Troubleshooting

### Port Already in Use
```bash
# Kill process on port 3002
# Windows:
netstat -ano | findstr :3002
taskkill /PID <PID> /F

# Linux/Mac:
lsof -ti:3002 | xargs kill -9
```

### MQTT Connection Failed
- Check broker URL and credentials
- Verify network connectivity
- Check firewall settings

### WebSocket Not Working
- Verify `socket.io` is installed: `npm list socket.io`
- Check CORS configuration
- Test with polling transport

## Verification Checklist

- [ ] `npm install` completed successfully
- [ ] `.env` file configured
- [ ] Server starts without errors
- [ ] MQTT connection established
- [ ] WebSocket server running
- [ ] Health endpoint responds: `curl http://localhost:3002/health`
- [ ] Frontend can connect to WebSocket

## Next Steps

1. Start frontend: `cd ZEPTAC-IOT-PLATFORM && npm run dev`
2. Open browser: `http://localhost:3000`
3. Navigate to Subtronics device page
4. Watch real-time updates!
