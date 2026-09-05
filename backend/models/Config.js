import mongoose from 'mongoose';

const configSchema = new mongoose.Schema({
  activeStrategy: { type: String, enum: ['rule-based', 'ai'], default: 'rule-based' },
  demandSpikeMultiplier: { type: Number, min: 1, default: 3 }
});

export default mongoose.model('Config', configSchema);
