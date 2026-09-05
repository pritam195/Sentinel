import express from 'express';
import PricingSuggestion from '../models/PricingSuggestion.js';
import ReorderSuggestion from '../models/ReorderSuggestion.js';
import Product from '../models/Product.js';
import { recordInventorySnapshot } from '../services/inventorySnapshots.js';

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
    const { status } = req.query;
    const filter = status ? { status } : {};
    const suggestions = await PricingSuggestion.find(filter).sort({ createdAt: -1 }).populate('productId');
    res.json(suggestions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /pricing-suggestions/:id
router.patch('/pricing-suggestions/:id', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['ACCEPTED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'Status must be ACCEPTED or REJECTED' });
    }

    const suggestion = await PricingSuggestion.findById(req.params.id);
    if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });
    if (suggestion.status !== 'PENDING') return res.status(400).json({ error: 'Suggestion already processed' });

    suggestion.status = status;
    await suggestion.save();

    if (status === 'ACCEPTED') {
      const product = await Product.findById(suggestion.productId);
      if (product) {
        product.currentPrice = suggestion.recommendedPrice;
        product.priceHistory.push({ price: suggestion.recommendedPrice });
        await restoreProductStatusWhenResolved(product);
        await product.save();
      }
    } else {
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
    const { status } = req.query;
    const filter = status ? { status } : {};
    const suggestions = await ReorderSuggestion.find(filter).sort({ createdAt: -1 }).populate('productId');
    res.json(suggestions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /reorder-suggestions/:id
router.patch('/reorder-suggestions/:id', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['ACCEPTED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'Status must be ACCEPTED or REJECTED' });
    }

    const suggestion = await ReorderSuggestion.findById(req.params.id);
    if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });
    if (suggestion.status !== 'PENDING') return res.status(400).json({ error: 'Suggestion already processed' });

    suggestion.status = status;
    await suggestion.save();

    if (status === 'ACCEPTED') {
      const product = await Product.findById(suggestion.productId);
      if (product) {
        product.stockLevel += suggestion.recommendedQuantity;
        await restoreProductStatusWhenResolved(product);
        await product.save();
        await recordInventorySnapshot(product, 'REORDER_ACCEPTED');
      }
    } else {
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
