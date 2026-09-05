import mongoose from 'mongoose';

// Immutable audit trail for inventory signals that feed the advisor loop.
const inventorySnapshotSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  stockLevel: { type: Number, required: true, min: 0 },
  demandVelocity: { type: Number, required: true, min: 0 },
  source: { type: String, enum: ['CREATED', 'STOCK_UPDATED', 'ORDER', 'REORDER_ACCEPTED'], required: true }
}, { timestamps: true });

export default mongoose.model('InventorySnapshot', inventorySnapshotSchema);
