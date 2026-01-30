# Data Format Mapping - Live Sensor Readings

## Overview

The backend automatically maps the new "Live Sensor Readings" field to the "offset" field for frontend compatibility. This ensures the frontend doesn't need any code changes.

## New Data Format

```json
{
  "Device Alise Name": "Gas Sensor Block1",
  "OTSM-2 Serial Number": "OTSM-0114",
  "Date Time At Reading": "2026-01-28 11:37:12",
  "Message Type": "LOG DATA",
  "lat": "19.011545",
  "long": "72.823872",
  "Parameters": {
    "Live Sensor Readings ": 350,
    "Unit of Measurement ": 1,
    "Decimal Point": 0,
    "Alarm Level A1": 250,
    "Alarm Level A2": 500,
    "Alarm Level A3": 1000,
    "Alarm 1 LED Status": 1,
    "Alarm 2 LED Status": 0,
    "Alarm 3 LED Status": 0,
    "Sensor Fault": 0
  }
}
```

## Field Mappings

### Gas Concentration
**Input:** `Parameters["Live Sensor Readings "]` (note the trailing space)  
**Output:** `offset` field  
**Value:** 350 ppm

The backend checks for:
1. `Parameters["Live Sensor Readings "]` (with space)
2. `Parameters["Live Sensor Readings"]` (without space)
3. `Parameters["Offset"]` (legacy fallback)

### Timestamp
**Input:** `"Date Time At Reading"` or `"timestamp"`  
**Output:** `timestamp` field  
**Value:** "2026-01-28 11:37:12"

### Unit of Measurement
**Input:** `Parameters["Unit of Measurement "]` (numeric code)  
**Output:** `unit` field (text)  
**Mapping:**
- `1` → `"ppm"`
- Add more mappings as needed

### Location
**Input:** Root level `"lat"` and `"long"` OR `Parameters["lat"]` and `Parameters["long"]`  
**Output:** `latitude` and `longitude` fields  
**Values:** "19.011545", "72.823872"

### Alarm Status
**Derived from:** LED status indicators  
**Logic:**
- If any LED (1, 2, 3) is ON OR Sensor Fault = 1 → `"ALARM"`
- Otherwise → `"NORMAL"`

## Normalized Output

```json
{
  "device_name": "Gas Sensor Block1",
  "serial_number": "OTSM-0114",
  "gas_type": "Unknown Gas",
  "timestamp": "2026-01-28 11:37:12",
  "unit": "ppm",
  "message_type": "LOG DATA",
  "sender": "Device",
  
  "sensor_reading": 350,
  "offset": 350,           // ← MAPPED from Live Sensor Readings
  "alarm_status": "ALARM",
  
  "span_high": 2000,
  "span_low": 0,
  "a1_level": 250,
  "a2_level": 500,
  "a3_level": 1000,
  "decimal_point": 0,
  
  "a1_type": "High",
  "a1_hysteresis": 0,
  "a1_latching": 0,
  "a1_siren": 0,
  "a1_buzzer": 0,
  
  "alarm1_led": 1,
  "alarm2_led": 0,
  "alarm3_led": 0,
  "sensor_fault": 0,
  
  "latitude": "19.011545",
  "longitude": "72.823872",
  
  "raw_message": { ... },
  "processed_at": "2026-01-28T09:23:25.704Z",
  "data_quality": "good"
}
```

## Frontend Compatibility

The frontend continues to use `deviceData.offset` without any changes:

```typescript
const currentGasReading = computed(() => {
  return deviceData.value?.offset ?? 0;
});
```

This works because the backend maps:
- **Old format:** `Parameters["Offset"]` → `offset`
- **New format:** `Parameters["Live Sensor Readings "]` → `offset`

## Testing

Run the test script to verify the mapping:

```bash
node test-new-format.js
```

Expected output:
```
✅ Parsing Successful!
🎯 Key Mappings:
   Live Sensor Readings: 350 → offset: 350
   Unit Code: 1 → unit: ppm
   Date Time At Reading: 2026-01-28 11:37:12 → timestamp: 2026-01-28 11:37:12
   Alarm Status: ALARM (LED1: 1)
   Location: lat=19.011545, long=72.823872

✅ Frontend will receive "offset" field with gas concentration value!
✅ No frontend changes needed!
```

## Backward Compatibility

The parser supports both old and new formats:

### Old Format (Still Supported)
```json
{
  "Parameters": {
    "Offset": 350,
    ...
  }
}
```

### New Format (Primary)
```json
{
  "Parameters": {
    "Live Sensor Readings ": 350,
    ...
  }
}
```

Both map to the same `offset` field in the output.

## Implementation Details

The mapping is handled in the `parseSubtronicsPayload()` function in `index.js`:

```javascript
// Handle sensor reading - MAP "Live Sensor Readings " to offset
let gasConcentration = 0;
if (params["Live Sensor Readings "] !== undefined) {
  gasConcentration = parseFloat(params["Live Sensor Readings "]);
} else if (params["Live Sensor Readings"] !== undefined) {
  gasConcentration = parseFloat(params["Live Sensor Readings"]);
} else if (params["Offset"] !== undefined) {
  gasConcentration = parseFloat(params["Offset"]);
}

// Map to offset field for frontend compatibility
const normalized = {
  ...
  offset: gasConcentration,
  ...
};
```

## Benefits

1. **No Frontend Changes** - Existing code continues to work
2. **Backward Compatible** - Supports both old and new formats
3. **Flexible** - Handles field name variations (with/without spaces)
4. **Maintainable** - Single point of transformation in backend
5. **Testable** - Dedicated test script for verification

## Migration Path

1. ✅ Backend updated to handle new format
2. ✅ Mapping to `offset` field implemented
3. ✅ Testing script created
4. ✅ Documentation updated
5. ⏳ Deploy backend to production
6. ⏳ Update device firmware to send new format
7. ✅ Frontend continues working without changes

## Notes

- The field name has a **trailing space**: `"Live Sensor Readings "` (note the space after "Readings")
- The backend handles both with and without the space for robustness
- Unit codes are mapped to text (currently only `1` → `"ppm"`)
- Location can be at root level or in Parameters
- Alarm status is always derived from LED indicators

---

**Last Updated:** January 28, 2026  
**Version:** 2.0.0
