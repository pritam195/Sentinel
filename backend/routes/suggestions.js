import express from 'express';
import PricingSuggestion from '../models/PricingSuggestion.js';
import ReorderSuggestion from '../models/ReorderSuggestion.js';
import Product from '../models/Product.js';
import Config from '../models/Config.js';
import { recordInventorySnapshot } from '../services/inventorySnapshots.js';
import { expirePendingSuggestions } from '../services/recommendationLoop.js';
import { authenticateJWT, requireRole, ROLES } from '../middleware/auth.js';

const router = express.Router();

async function restoreProductStatusWhenResolved(product) {
  if (product.stockLevel === 0) {
    product.status = 'OUT_OF_STOCK';
    return;
  }
  const [pendingPricing, pendingReorder] = await Promise.all([
    PricingSuggestion.exists({ productId: product._id, status: 'PENDING' }),
    ReorderSuggestion.exists({ productId: product._id, status: 'PENDING' })
  ]);
  product.status = pendingPricing || pendingReorder ? 'PRICE_REVIEW_PENDING' : 'ACTIVE';
}

// GET /pricing-suggestions
router.get('/pricing-suggestions', async (req, res) => {
  try {
    await expirePendingSuggestions();
    const { status } = req.query;
    const filter = status ? { status } : {};
    const suggestions = await PricingSuggestion.find(filter).sort({ createdAt: -1 }).populate('productId');
    res.json(suggestions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /pricing-suggestions/:id
// Requires MERCHANDISER or ADMIN role; records acting user ID
router.patch('/pricing-suggestions/:id', authenticateJWT, requireRole(ROLES.MERCHANDISER, ROLES.ADMIN), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['ACCEPTED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'Status must be ACCEPTED or REJECTED' });
    }

    const suggestion = await PricingSuggestion.findById(req.params.id);
    if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });
    
    // Check if expired
    if (suggestion.status === 'EXPIRED' || (suggestion.expiresAt && new Date(suggestion.expiresAt) <= new Date())) {
      suggestion.status = 'EXPIRED';
      await PricingSuggestion.updateOne({ _id: suggestion._id, status: 'PENDING' }, { $set: { status: 'EXPIRED' } });
      const product = await Product.findById(suggestion.productId);
      if (product) {
        await restoreProductStatusWhenResolved(product);
        await product.save();
      }
      return res.status(410).json({ error: 'Suggestion has expired', suggestion });
    }

    if (suggestion.status !== 'PENDING') {
      return res.status(400).json({ error: `Suggestion already processed with status: ${suggestion.status}` });
    }

    const actingUserId = req.user?.userId || 'unknown';

    if (status === 'ACCEPTED') {
      const product = await Product.findById(suggestion.productId);
      if (!product) return res.status(404).json({ error: 'Product not found' });

      // Optimistic Concurrency Check: Verify product priceVersion hasn't changed since generation
      const versionChanged = suggestion.priceVersion !== undefined && product.priceVersion !== suggestion.priceVersion;

      if (versionChanged) {
        await PricingSuggestion.updateOne(
          { _id: suggestion._id, status: 'PENDING' },
          { $set: { status: 'STALE', actedBy: actingUserId } }
        );
        suggestion.status = 'STALE';
        suggestion.actedBy = actingUserId;
        await restoreProductStatusWhenResolved(product);
        await product.save();
        return res.status(409).json({
          error: 'Conflict: Product price has changed since suggestion was generated. Marked as STALE.',
          suggestion
        });
      }

      // Atomically claim transition to ACCEPTED
      const updatedSuggestion = await PricingSuggestion.findOneAndUpdate(
        { _id: suggestion._id, status: 'PENDING' },
        { $set: { status: 'ACCEPTED', actedBy: actingUserId } },
        { returnDocument: 'after' }
      );

      if (!updatedSuggestion) {
        const latest = await PricingSuggestion.findById(suggestion._id);
        return res.status(400).json({ error: `Suggestion already processed with status: ${latest?.status || 'PROCESSED'}` });
      }

      product.currentPrice = updatedSuggestion.recommendedPrice;
      product.priceVersion = (product.priceVersion || 1) + 1;
      product.priceHistory.push({ price: updatedSuggestion.recommendedPrice, changedBy: actingUserId });
      await restoreProductStatusWhenResolved(product);
      await product.save();
      return res.json(updatedSuggestion);
    } else {
      // Atomically claim transition to REJECTED
      const updatedSuggestion = await PricingSuggestion.findOneAndUpdate(
        { _id: suggestion._id, status: 'PENDING' },
        { $set: { status: 'REJECTED', actedBy: actingUserId } },
        { returnDocument: 'after' }
      );

      if (!updatedSuggestion) {
        const latest = await PricingSuggestion.findById(suggestion._id);
        return res.status(400).json({ error: `Suggestion already processed with status: ${latest?.status || 'PROCESSED'}` });
      }

      const product = await Product.findById(suggestion.productId);
      if (product) {
        await restoreProductStatusWhenResolved(product);
        await product.save();
      }
      return res.json(updatedSuggestion);
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// GET /reorder-suggestions
router.get('/reorder-suggestions', async (req, res) => {
  try {
    await expirePendingSuggestions();
    const { status } = req.query;
    const filter = status ? { status } : {};
    const suggestions = await ReorderSuggestion.find(filter).sort({ createdAt: -1 }).populate('productId');
    res.json(suggestions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /reorder-suggestions/:id
// Requires MERCHANDISER or ADMIN role; records acting user ID
router.patch('/reorder-suggestions/:id', authenticateJWT, requireRole(ROLES.MERCHANDISER, ROLES.ADMIN), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['ACCEPTED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'Status must be ACCEPTED or REJECTED' });
    }

    const suggestion = await ReorderSuggestion.findById(req.params.id);
    if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });

    // Check if expired
    if (suggestion.status === 'EXPIRED' || (suggestion.expiresAt && new Date(suggestion.expiresAt) <= new Date())) {
      suggestion.status = 'EXPIRED';
      await suggestion.save();
      const product = await Product.findById(suggestion.productId);
      if (product) {
        await restoreProductStatusWhenResolved(product);
        await product.save();
      }
      return res.status(410).json({ error: 'Suggestion has expired', suggestion });
    }

    if (suggestion.status !== 'PENDING') {
      return res.status(400).json({ error: `Suggestion already processed with status: ${suggestion.status}` });
    }

    const actingUserId = req.user?.userId || 'unknown';

    if (status === 'ACCEPTED') {
      const product = await Product.findById(suggestion.productId);
      if (!product) return res.status(404).json({ error: 'Product not found' });

      // Optimistic Concurrency Check: Verify current stock has not drifted beyond configurable threshold
      const config = await Config.findOne();
      const thresholdPct = config?.reorderStalenessThresholdPercent ?? 25;
      const thresholdRatio = thresholdPct / 100;
      const baseStock = suggestion.stockAtGeneration !== undefined
        ? suggestion.stockAtGeneration
        : (suggestion.currentStock ?? 0);

      let drifted = false;
      if (baseStock === 0) {
        drifted = product.stockLevel > 0;
      } else {
        const drift = Math.abs(product.stockLevel - baseStock) / baseStock;
        drifted = drift > thresholdRatio;
      }

      if (drifted) {
        await ReorderSuggestion.updateOne(
          { _id: suggestion._id, status: 'PENDING' },
          { $set: { status: 'STALE', actedBy: actingUserId } }
        );
        suggestion.status = 'STALE';
        suggestion.actedBy = actingUserId;
        await restoreProductStatusWhenResolved(product);
        await product.save();
        return res.status(409).json({
          error: `Conflict: Product stock state has drifted beyond allowed ${thresholdPct}% threshold since suggestion was generated. Marked as STALE.`,
          suggestion
        });
      }

      // Atomically claim transition to ACCEPTED
      const updatedSuggestion = await ReorderSuggestion.findOneAndUpdate(
        { _id: suggestion._id, status: 'PENDING' },
        { $set: { status: 'ACCEPTED', actedBy: actingUserId } },
        { returnDocument: 'after' }
      );

      if (!updatedSuggestion) {
        const latest = await ReorderSuggestion.findById(suggestion._id);
        return res.status(400).json({ error: `Suggestion already processed with status: ${latest?.status || 'PROCESSED'}` });
      }

      product.stockLevel += updatedSuggestion.recommendedQuantity;
      await restoreProductStatusWhenResolved(product);
      await product.save();
      await recordInventorySnapshot(product, 'REORDER_ACCEPTED', actingUserId);
      return res.json(updatedSuggestion);
    } else {
      // Atomically claim transition to REJECTED
      const updatedSuggestion = await ReorderSuggestion.findOneAndUpdate(
        { _id: suggestion._id, status: 'PENDING' },
        { $set: { status: 'REJECTED', actedBy: actingUserId } },
        { returnDocument: 'after' }
      );

      if (!updatedSuggestion) {
        const latest = await ReorderSuggestion.findById(suggestion._id);
        return res.status(400).json({ error: `Suggestion already processed with status: ${latest?.status || 'PROCESSED'}` });
      }

      const product = await Product.findById(suggestion.productId);
      if (product) {
        await restoreProductStatusWhenResolved(product);
        await product.save();
      }
      return res.json(updatedSuggestion);
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
