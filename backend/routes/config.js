import express from 'express';
import Config from '../models/Config.js';

const router = express.Router();

// GET /config/strategy
router.get('/strategy', async (req, res) => {
  try {
    let config = await Config.findOne();
    if (!config) {
      config = await Config.create({ activeStrategy: 'rule-based' });
    }
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /config/strategy
router.patch('/strategy', async (req, res) => {
  try {
    const { strategy, demandSpikeMultiplier } = req.body;
    if (strategy !== undefined && !['rule-based', 'ai'].includes(strategy)) {
      return res.status(400).json({ error: 'Invalid strategy' });
    }
    if (demandSpikeMultiplier !== undefined &&
      (!Number.isFinite(demandSpikeMultiplier) || demandSpikeMultiplier < 1)) {
      return res.status(400).json({ error: 'demandSpikeMultiplier must be a number of at least 1' });
    }

    let config = await Config.findOne();
    if (!config) {
      config = new Config({ activeStrategy: strategy ?? 'rule-based', demandSpikeMultiplier });
    } else {
      if (strategy !== undefined) config.activeStrategy = strategy;
      if (demandSpikeMultiplier !== undefined) config.demandSpikeMultiplier = demandSpikeMultiplier;
    }
    
    await config.save();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
