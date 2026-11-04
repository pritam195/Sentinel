import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  sku: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  category: { type: String, enum: ['ELECTRONICS', 'APPAREL', 'HOME'], required: true },
  currentPrice: { type: Number, required: true, min: 0.01 },
  stockLevel: { type: Number, required: true, min: 0 },
  reorderThreshold: { type: Number, required: true, min: 0 },
  demandVelocity: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['ACTIVE', 'PRICE_REVIEW_PENDING', 'OUT_OF_STOCK'], default: 'ACTIVE' },
  costPrice: { type: Number, required: false, min: 0 },
  minMarginPercent: { type: Number, required: false, min: 0, default: 0 },
  priceHistory: [{ 
    price: Number, 
    date: { type: Date, default: Date.now } 
  }]
}, { timestamps: true });

export default mongoose.model('Product', productSchema);
