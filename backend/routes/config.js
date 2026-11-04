import express from 'express';
import Config from '../models/Config.js';
import AdvisorLog from '../models/AdvisorLog.js';
import {
  globalCircuitBreaker,
  globalSemaphore,
  globalRetryHandler
} from '../services/resilience.js';

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

// GET /config/advisor-health
router.get('/advisor-health', async (req, res) => {
  try {
    const breakerDetails = globalCircuitBreaker.getDetails();
    const limiterStats = globalSemaphore.getStats();
    const retryStats = globalRetryHandler.getStats();

    // Query fallback counts grouped by reason from AdvisorLog
    const fallbackAggregation = await AdvisorLog.aggregate([
      { $match: { fellBack: true, fallbackReason: { $ne: null } } },
      { $group: { _id: '$fallbackReason', count: { $sum: 1 } } }
    ]);

    const fallbackCountsByReason = {
      TIMEOUT: 0,
      MALFORMED_JSON: 0,
      OUT_OF_BOUNDS: 0,
      RATE_LIMITED: 0,
      CIRCUIT_OPEN: 0,
      UPSTREAM_ERROR: 0
    };

    for (const item of fallbackAggregation) {
      if (item._id && Object.prototype.hasOwnProperty.call(fallbackCountsByReason, item._id)) {
        fallbackCountsByReason[item._id] = item.count;
      }
    }

    res.json({
      breakerState: breakerDetails.state,
      circuitBreaker: breakerDetails,
      concurrencyLimiter: limiterStats,
      retryStats,
      fallbackCountsByReason
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
