import mongoose from 'mongoose';

const advisorLogSchema = new mongoose.Schema({
  logType: { 
    type: String, 
    enum: ['TRIGGER_FIRED', 'AI_CALL'], 
    required: true,
    index: true
  },
  timestamp: { 
    type: Date, 
    default: Date.now,
    index: true 
  },
  productId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Product', 
    required: false,
    index: true 
  },
  sku: { type: String, required: false },
  category: { type: String, required: false },
  triggerType: { 
    type: String, 
    enum: ['INVENTORY_LOW', 'DEMAND_SPIKE', 'MANUAL'], 
    required: false 
  },
  advisor: { 
    type: String, 
    enum: ['rule-based', 'ai'], 
    required: false 
  },
  // Fields specific to AI calls
  callType: { 
    type: String, 
    enum: ['pricing', 'reorder'], 
    required: false 
  },
  outcome: { 
    type: String, 
    enum: [
      'success',
      'timeout', 'malformed_json', 'out_of_bounds_clamped', 'api_error',
      'TIMEOUT', 'MALFORMED_JSON', 'OUT_OF_BOUNDS', 'RATE_LIMITED', 'CIRCUIT_OPEN', 'UPSTREAM_ERROR'
    ], 
    required: false,
    index: true
  },
  latencyMs: { type: Number, required: false },
  fellBack: { type: Boolean, required: false, default: false },
  fallbackReason: { 
    type: String, 
    enum: ['TIMEOUT', 'MALFORMED_JSON', 'OUT_OF_BOUNDS', 'RATE_LIMITED', 'CIRCUIT_OPEN', 'UPSTREAM_ERROR', null],
    required: false,
    index: true
  },
  inputDetails: { type: mongoose.Schema.Types.Mixed, required: false },
  outputDetails: { type: mongoose.Schema.Types.Mixed, required: false }
}, { timestamps: true });

export default mongoose.model('AdvisorLog', advisorLogSchema);
