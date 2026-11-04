import mongoose from 'mongoose';

const configSchema = new mongoose.Schema({
  activeStrategy: { type: String, enum: ['rule-based', 'ai'], default: 'rule-based' },
  demandSpikeMultiplier: { type: Number, min: 1, default: 3 },
  maxSingleChangePercent: { type: Number, min: 1, max: 100, default: 20 },
  maxChangesPer24h: { type: Number, min: 1, default: 5 },
  suggestionTtlHours: { type: Number, min: 1, default: 24 },
  reorderStalenessThresholdPercent: { type: Number, min: 1, max: 100, default: 25 }
});

export default mongoose.model('Config', configSchema);
