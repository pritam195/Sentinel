import mongoose from 'mongoose';

const reorderSuggestionSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  currentStock: { type: Number, required: true, min: 0 },
  recommendedQuantity: { type: Number, required: true, min: 1 },
  suggestedLeadTimeDays: { type: Number, required: true, min: 1 },
  confidence: { type: Number, min: 0, max: 1, required: true },
  reasoning: { type: String, required: true },
  status: { type: String, enum: ['PENDING', 'ACCEPTED', 'REJECTED'], default: 'PENDING' },
  triggerReason: { type: String, enum: ['INITIAL', 'INVENTORY_LOW', 'DEMAND_SPIKE', 'MANUAL'], required: true }
}, { timestamps: true });

export default mongoose.model('ReorderSuggestion', reorderSuggestionSchema);
