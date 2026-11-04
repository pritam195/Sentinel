import mongoose from 'mongoose';

const reorderSuggestionSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  currentStock: { type: Number, required: true, min: 0 },
  stockAtGeneration: { type: Number, required: true, min: 0 },
  recommendedQuantity: { type: Number, required: true, min: 0 },
  rawRecommendedQuantity: { type: Number, required: false },
  rawQuantity: { type: Number, required: false },
  wasClamped: { type: Boolean, default: false },
  clampReason: { type: String, default: null },
  outcome: { type: String, default: 'success' },
  suggestedLeadTimeDays: { type: Number, required: true, min: 1 },
  confidence: { type: Number, min: 0, max: 1, required: true },
  reasoning: { type: String, required: true },
  status: { type: String, enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'STALE', 'EXPIRED'], default: 'PENDING' },
  triggerReason: { type: String, enum: ['INITIAL', 'INVENTORY_LOW', 'DEMAND_SPIKE', 'MANUAL'], required: true },
  isFallback: { type: Boolean, default: false },
  fallbackReason: { 
    type: String, 
    enum: [
      'SCHEMA_INVALID',
      'IMPLAUSIBLE_OUTPUT',
      'MALFORMED_JSON',
      'TIMEOUT',
      'RATE_LIMITED',
      'CIRCUIT_OPEN',
      'UPSTREAM_ERROR',
      'OUT_OF_BOUNDS',
      null
    ], 
    default: null 
  },
  productVersion: { type: Number, default: 0 },
  productUpdatedAt: { type: Date, required: false },
  expiresAt: { type: Date, required: true, index: true },
  actedBy: { type: String, required: false, default: null }
}, { timestamps: true });

reorderSuggestionSchema.index(
  { productId: 1, triggerReason: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } }
);

export default mongoose.model('ReorderSuggestion', reorderSuggestionSchema);
