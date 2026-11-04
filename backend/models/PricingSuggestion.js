import mongoose from 'mongoose';

const pricingSuggestionSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  currentPrice: { type: Number, required: true, min: 0.01 },
  recommendedPrice: { type: Number, required: true, min: 0.01 },
  direction: { type: String, enum: ['INCREASE', 'DECREASE', 'HOLD'], required: true },
  confidence: { type: Number, min: 0, max: 1, required: true },
  reasoning: { type: String, required: true },
  status: { type: String, enum: ['PENDING', 'ACCEPTED', 'REJECTED'], default: 'PENDING' },
  triggerReason: { type: String, enum: ['INITIAL', 'INVENTORY_LOW', 'DEMAND_SPIKE', 'MANUAL'], required: true },
  isFallback: { type: Boolean, default: false },
  fallbackReason: { type: String, default: null }
}, { timestamps: true });

pricingSuggestionSchema.index(
  { productId: 1, triggerReason: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } }
);

export default mongoose.model('PricingSuggestion', pricingSuggestionSchema);
