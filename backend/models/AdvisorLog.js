import mongoose from 'mongoose';

/**
 * AUDIT INTEGRITY SPECIFICATION:
 * AdvisorLog provides an append-only audit trail for advisor triggers, AI calls, and fallback events.
 *
 * ENFORCEMENT LEVEL:
 * This constraint is enforced at the APPLICATION LEVEL via Mongoose pre-hooks below.
 * It is NOT database-enforced by MongoDB itself; direct database drivers, administrative scripts,
 * or raw shell commands with write privileges can bypass these application hooks.
 *
 * TO ENFORCE AT THE DATABASE LEVEL IN PRODUCTION MONGODB:
 * Configure a custom MongoDB role granting only 'find' and 'insert' privileges on this collection:
 * ```javascript
 * db.createRole({
 *   role: "appendOnlyAuditRole",
 *   privileges: [
 *     { resource: { db: "sentinel", collection: "advisorlogs" }, actions: [ "find", "insert" ] }
 *   ],
 *   roles: []
 * });
 * db.grantRolesToUser("sentinel_app_user", ["appendOnlyAuditRole"]);
 * ```
 */

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
  actedBy: { type: String, required: false, default: null },
  inputDetails: { type: mongoose.Schema.Types.Mixed, required: false },
  outputDetails: { type: mongoose.Schema.Types.Mixed, required: false }
}, { timestamps: true });

const disallowAdvisorLogMutation = function () {
  const options = this.getOptions ? this.getOptions() : {};
  if (options && options.bypassAuditGuard === true) return;
  throw new Error('AdvisorLog is append-only: updates and deletes are disallowed at the application level.');
};

// Query middleware disallowing update and delete operations
advisorLogSchema.pre('updateOne', disallowAdvisorLogMutation);
advisorLogSchema.pre('updateMany', disallowAdvisorLogMutation);
advisorLogSchema.pre('deleteOne', disallowAdvisorLogMutation);
advisorLogSchema.pre('deleteMany', disallowAdvisorLogMutation);
advisorLogSchema.pre('findOneAndUpdate', disallowAdvisorLogMutation);
advisorLogSchema.pre('findOneAndDelete', disallowAdvisorLogMutation);
advisorLogSchema.pre('findOneAndReplace', disallowAdvisorLogMutation);
advisorLogSchema.pre('replaceOne', disallowAdvisorLogMutation);

// Document middleware disallowing update on existing documents
advisorLogSchema.pre('save', function () {
  if (!this.isNew) {
    throw new Error('AdvisorLog is append-only: document updates are disallowed at the application level.');
  }
});

export default mongoose.model('AdvisorLog', advisorLogSchema);
