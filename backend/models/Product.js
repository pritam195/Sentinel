import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  sku: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  category: { type: String, enum: ['ELECTRONICS', 'APPAREL', 'HOME', 'BEAUTY', 'GROCERY'], required: true },
  currentPrice: { type: Number, required: true, min: 0.01 },
  stockLevel: { type: Number, required: true, min: 0 },
  reorderThreshold: { type: Number, required: true, min: 0 },
  demandVelocity: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['ACTIVE', 'PRICE_REVIEW_PENDING', 'OUT_OF_STOCK'], default: 'ACTIVE' },
  costPrice: { type: Number, required: false, min: 0 },
  minMarginPercent: { type: Number, required: false, min: 0, default: 0 },
  priceVersion: { type: Number, required: true, default: 1, min: 1 },
  priceHistory: [{ 
    price: Number, 
    date: { type: Date, default: Date.now },
    changedBy: { type: String, required: false, default: null }
  }]
}, { timestamps: true });

productSchema.pre('save', function () {
  if (!this.isNew) {
    if (this.isModified('currentPrice') || this.isModified('costPrice')) {
      if (!this.isModified('priceVersion')) {
        this.priceVersion = (this.priceVersion || 1) + 1;
      }
    }
  }
});

export default mongoose.model('Product', productSchema);
