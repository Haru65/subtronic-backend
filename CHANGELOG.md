# Changelog

## [2.0.0] - 2026-01-28

### Added
- **WebSocket Support** - Real-time data streaming using Socket.IO
- **Smart Field Mapping** - Automatic mapping of "Live Sensor Readings" to "offset"
- **New Data Format Support** - Handles updated device payload structure
- **Backward Compatibility** - Supports both old and new data formats
- **Test Scripts** - Added test-new-format.js for validation
- **Comprehensive Documentation** - Added multiple documentation files

### Changed
- **Data Parser** - Updated `parseSubtronicsPayload()` to handle new fields:
  - `"Live Sensor Readings "` → `offset`
  - `"Date Time At Reading"` → `timestamp`
  - `"Unit of Measurement "` (numeric) → `unit` (text)
  - Location fields from root or Parameters
- **MQTT Broadcasting** - Now broadcasts to WebSocket clients immediately
- **Package.json** - Added socket.io dependency, fixed entry point

### Fixed
- Trailing space handling in field names
- Location field extraction from multiple sources
- Unit code to text mapping
- Alarm status derivation from LED indicators

## [1.0.0] - 2026-01-27

### Initial Release
- MQTT client integration
- REST API endpoints
- Device data storage
- Alert generation
- Basic CORS support

---

## Migration Guide

### From 1.x to 2.x

**Backend Changes:**
1. Install new dependencies: `npm install`
2. No configuration changes needed
3. Restart server

**Device Changes:**
- Update firmware to send new data format with "Live Sensor Readings"
- Old format still supported during transition

**Frontend Changes:**
- **None required!** Backend handles the mapping automatically

### New Data Format

**Old:**
```json
{
  "Parameters": {
    "Offset": 350
  }
}
```

**New:**
```json
{
  "Parameters": {
    "Live Sensor Readings ": 350
  }
}
```

**Both map to:**
```json
{
  "offset": 350
}
```

---

## Breaking Changes

None - fully backward compatible!

---

## Upgrade Instructions

1. **Pull latest code:**
   ```bash
   git pull origin main
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Test the changes:**
   ```bash
   node test-new-format.js
   ```

4. **Restart server:**
   ```bash
   npm start
   ```

5. **Verify WebSocket:**
   - Open test-websocket.html
   - Connect and subscribe
   - Check real-time updates

---

## Documentation

- [README.md](./README.md) - Main documentation
- [WEBSOCKET_IMPLEMENTATION.md](./WEBSOCKET_IMPLEMENTATION.md) - WebSocket details
- [DATA_FORMAT_MAPPING.md](./DATA_FORMAT_MAPPING.md) - Field mapping guide
- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) - Deployment instructions
- [INSTALL.md](./INSTALL.md) - Installation guide

---

**Maintained by:** Zeptac IoT Team  
**Last Updated:** January 28, 2026
