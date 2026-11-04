import express from 'express';
import PricingSuggestion from '../models/PricingSuggestion.js';
import ReorderSuggestion from '../models/ReorderSuggestion.js';
import Product from '../models/Product.js';
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

      // Optimistic Concurrency Check: Verify product price or version hasn't changed since generation
      const versionChanged = suggestion.productVersion !== undefined && product.__v !== suggestion.productVersion;
      const priceChanged = product.currentPrice !== suggestion.currentPrice;
      const dateChanged = suggestion.productUpdatedAt && product.updatedAt && new Date(product.updatedAt).getTime() > new Date(suggestion.productUpdatedAt).getTime();

      if (versionChanged || priceChanged || dateChanged) {
        suggestion.status = 'STALE';
        suggestion.actedBy = actingUserId;
        await suggestion.save();
        await restoreProductStatusWhenResolved(product);
        await product.save();
        return res.status(409).json({
          error: 'Conflict: Product has changed since suggestion was generated. Marked as STALE.',
          suggestion
        });
      }

      suggestion.status = status;
      suggestion.actedBy = actingUserId;
      await suggestion.save();

      product.currentPrice = suggestion.recommendedPrice;
      product.priceHistory.push({ price: suggestion.recommendedPrice, changedBy: actingUserId });
      await restoreProductStatusWhenResolved(product);
      await product.save();
    } else {
      suggestion.status = status;
      suggestion.actedBy = actingUserId;
      await suggestion.save();

      const product = await Product.findById(suggestion.productId);
      if (product) {
        await restoreProductStatusWhenResolved(product);
        await product.save();
      }
    }

    res.json(suggestion);
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

      // Optimistic Concurrency Check: Verify product stock or version hasn't changed since generation
      const versionChanged = suggestion.productVersion !== undefined && product.__v !== suggestion.productVersion;
      const stockChanged = product.stockLevel !== suggestion.currentStock;
      const dateChanged = suggestion.productUpdatedAt && product.updatedAt && new Date(product.updatedAt).getTime() > new Date(suggestion.productUpdatedAt).getTime();

      if (versionChanged || stockChanged || dateChanged) {
        suggestion.status = 'STALE';
        suggestion.actedBy = actingUserId;
        await suggestion.save();
        await restoreProductStatusWhenResolved(product);
        await product.save();
        return res.status(409).json({
          error: 'Conflict: Product stock state has changed since suggestion was generated. Marked as STALE.',
          suggestion
        });
      }

      suggestion.status = status;
      suggestion.actedBy = actingUserId;
      await suggestion.save();

      product.stockLevel += suggestion.recommendedQuantity;
      await restoreProductStatusWhenResolved(product);
      await product.save();
      await recordInventorySnapshot(product, 'REORDER_ACCEPTED', actingUserId);
    } else {
      suggestion.status = status;
      suggestion.actedBy = actingUserId;
      await suggestion.save();

      const product = await Product.findById(suggestion.productId);
      if (product) {
        await restoreProductStatusWhenResolved(product);
        await product.save();
      }
    }

    res.json(suggestion);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
