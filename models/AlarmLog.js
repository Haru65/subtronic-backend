import mongoose from 'mongoose';

const alarmLogSchema = new mongoose.Schema({
  device_id: {
    type: String,
    required: true,
    index: true
  },
  device_name: {
    type: String,
    required: true
  },
  serial_number: {
    type: String,
    required: true,
    index: true
  },
  alarm_type: {
    type: String,
    required: true,
    enum: ['alarm_level_1', 'alarm_level_2', 'alarm_level_3', 'sensor_fault'],
    index: true
  },
  severity: {
    type: String,
    required: true,
    enum: ['warning', 'high', 'critical'],
    index: true
  },
  message: {
    type: String,
    required: true
  },
  threshold: {
    type: Number
  },
  current_value: {
    type: Number
  },
  unit: {
    type: String,
    default: 'ppm'
  },
  gas_type: {
    type: String
  },
  timestamp: {
    type: Date,
    required: true,
    index: true,
    default: Date.now
  },
  acknowledged: {
    type: Boolean,
    default: false,
    index: true
  },
  acknowledged_at: {
    type: Date
  },
  acknowledged_by: {
    type: String
  },
  location: {
    latitude: String,
    longitude: String
  }
}, {
  timestamps: true, // Adds createdAt and updatedAt
  collection: 'alarm_logs' // Explicit collection name
});

// Indexes for efficient querying
alarmLogSchema.index({ device_id: 1, timestamp: -1 });
alarmLogSchema.index({ timestamp: -1 });
alarmLogSchema.index({ alarm_type: 1, severity: 1 });
alarmLogSchema.index({ acknowledged: 1, timestamp: -1 });

const AlarmLog = mongoose.model('AlarmLog', alarmLogSchema);

export default AlarmLog;
