/**
 * Test script for new data format with "Live Sensor Readings"
 * Run: node test-new-format.js
 */

// Sample new data format
const newDataFormat = {
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
};

// Parse function (same as in index.js)
function parseSubtronicsPayload(rawJson) {
  try {
    const data = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
    
    const deviceName = data["Device Alias Name"] || data["Device Alise Name"] || "Unknown Device";
    const serialNumber = data["OTSM-2 Serial Number"] || "Unknown";
    const gasType = data["Gas"] || "Unknown Gas";
    const timestamp = data["Date Time At Reading"] || data["timestamp"] || new Date().toISOString();
    const messageType = data["Message Type"] || "LOG DATA";
    const sender = data["Sender"] || "Device";
    
    const params = data["Parameters"] || {};
    
    // Handle unit
    let unit = "ppm";
    if (params["Unit of Measurement "] !== undefined) {
      const unitCode = parseInt(params["Unit of Measurement "]);
      unit = unitCode === 1 ? "ppm" : "ppm";
    }
    
    // Handle sensor reading - MAP "Live Sensor Readings " to offset
    let gasConcentration = 0;
    if (params["Live Sensor Readings "] !== undefined) {
      gasConcentration = parseFloat(params["Live Sensor Readings "]);
    } else if (params["Live Sensor Readings"] !== undefined) {
      gasConcentration = parseFloat(params["Live Sensor Readings"]);
    } else if (params["Offset"] !== undefined) {
      gasConcentration = parseFloat(params["Offset"]);
    }
    
    const alarm1Led = parseInt(params["Alarm 1 LED Status"]) || 0;
    const alarm2Led = parseInt(params["Alarm 2 LED Status"]) || 0;
    const alarm3Led = parseInt(params["Alarm 3 LED Status"]) || 0;
    const sensorFault = parseInt(params["Sensor Fault"]) || 0;
    
    let alarmStatus = "NORMAL";
    if (sensorFault === 1 || alarm3Led === 1 || alarm2Led === 1 || alarm1Led === 1) {
      alarmStatus = "ALARM";
    }
    
    const latitude = data["lat"] || params["lat"] || "0.00";
    const longitude = data["long"] || params["long"] || "0.00";
    
    const normalized = {
      device_name: deviceName,
      serial_number: serialNumber,
      gas_type: gasType,
      timestamp: timestamp,
      unit: unit.toString().trim(),
      message_type: messageType,
      sender: sender,
      
      sensor_reading: gasConcentration,
      offset: gasConcentration, // MAPPED from Live Sensor Readings
      alarm_status: alarmStatus,
      
      span_high: parseInt(params["Span High"]) || 2000,
      span_low: parseInt(params["Span Low"]) || 0,
      a1_level: parseInt(params["Alarm Level A1"]) || 250,
      a2_level: parseInt(params["Alarm Level A2"]) || 500,
      a3_level: parseInt(params["Alarm Level A3"]) || 1000,
      decimal_point: parseInt(params["Decimal Point"]) || 0,
      
      a1_type: params["A1Type"] || "High",
      a1_hysteresis: parseInt(params["A1Hysterysis"]) || 0,
      a1_latching: parseInt(params["A1Latching"]) || 0,
      a1_siren: parseInt(params["A1Siren"]) || 0,
      a1_buzzer: parseInt(params["A1Buzzer"]) || 0,
      
      alarm1_led: alarm1Led,
      alarm2_led: alarm2Led,
      alarm3_led: alarm3Led,
      sensor_fault: sensorFault,
      
      latitude: latitude,
      longitude: longitude,
      
      raw_message: data,
      processed_at: new Date().toISOString(),
      data_quality: 'good'
    };
    
    return normalized;
  } catch (error) {
    console.error('❌ Error parsing:', error);
    return null;
  }
}

// Test the parsing
console.log('🧪 Testing New Data Format Parser\n');
console.log('📥 Input Data:');
console.log(JSON.stringify(newDataFormat, null, 2));
console.log('\n' + '='.repeat(80) + '\n');

const result = parseSubtronicsPayload(newDataFormat);

if (result) {
  console.log('✅ Parsing Successful!\n');
  console.log('📤 Normalized Output:');
  console.log(JSON.stringify(result, null, 2));
  console.log('\n' + '='.repeat(80) + '\n');
  
  console.log('🎯 Key Mappings:');
  console.log(`   Live Sensor Readings: ${newDataFormat.Parameters["Live Sensor Readings "]} → offset: ${result.offset}`);
  console.log(`   Unit Code: ${newDataFormat.Parameters["Unit of Measurement "]} → unit: ${result.unit}`);
  console.log(`   Date Time At Reading: ${newDataFormat["Date Time At Reading"]} → timestamp: ${result.timestamp}`);
  console.log(`   Alarm Status: ${result.alarm_status} (LED1: ${result.alarm1_led})`);
  console.log(`   Location: lat=${result.latitude}, long=${result.longitude}`);
  
  console.log('\n✅ Frontend will receive "offset" field with gas concentration value!');
  console.log('✅ No frontend changes needed!');
} else {
  console.log('❌ Parsing Failed!');
}
