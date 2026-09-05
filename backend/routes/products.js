import express from 'express';
import Product from '../models/Product.js';
import PricingSuggestion from '../models/PricingSuggestion.js';
import ReorderSuggestion from '../models/ReorderSuggestion.js';
import AIAdvisor from '../strategies/AIAdvisor.js';
import inventoryEvents from '../events/inventoryEvents.js';
import { recordInventorySnapshot } from '../services/inventorySnapshots.js';
import { recordTrigger } from '../services/metrics.js';

const router = express.Router();

// Remove stub

// GET /products?status=&category=
router.get('/', async (req, res) => {
  try {
    const { status, category } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;

    const products = await Product.find(filter).sort({ createdAt: -1 });
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /products
router.post('/', async (req, res) => {
  try {
    const product = new Product(req.body);
    // set initial status correctly if stock is 0
    if (product.stockLevel === 0) product.status = 'OUT_OF_STOCK';
    await product.save();
    await recordInventorySnapshot(product, 'CREATED');
    res.status(201).json(product);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// PATCH /products/:id/stock
router.patch('/:id/stock', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const { stockLevel, delta } = req.body;
    
    if (typeof stockLevel === 'number' && Number.isFinite(stockLevel)) {
      product.stockLevel = stockLevel;
    } else if (typeof delta === 'number' && Number.isFinite(delta)) {
      product.stockLevel += delta;
    } else {
      return res.status(400).json({ error: 'Provide stockLevel or delta' });
    }

    if (product.stockLevel < 0) product.stockLevel = 0;

    if (product.stockLevel === 0) {
      product.status = 'OUT_OF_STOCK';
    } else if (product.stockLevel > 0 && product.status === 'OUT_OF_STOCK') {
      // Back to active if recovering and no suggestions pending
      // (Simplified logic for now)
      product.status = 'ACTIVE';
    }

    await product.save();
    await recordInventorySnapshot(product, 'STOCK_UPDATED');

    // The listener performs its work asynchronously; never await it in this request.
    inventoryEvents.emit('inventory:changed', product);

    res.json(product);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /products/:id/orders
router.post('/:id/orders', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const qty = Number(req.body.qty ?? 1);
    if (!Number.isInteger(qty) || qty < 1) {
      return res.status(400).json({ error: 'qty must be a positive integer' });
    }
    product.stockLevel -= qty;
    if (product.stockLevel < 0) product.stockLevel = 0;
    
    product.demandVelocity += qty;

    if (product.stockLevel === 0) {
      product.status = 'OUT_OF_STOCK';
    }

    await product.save();
    await recordInventorySnapshot(product, 'ORDER');

    inventoryEvents.emit('inventory:changed', product);

    res.json(product);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /products/:id/suggest-pricing
router.post('/:id/suggest-pricing', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    
    const categoryProducts = await Product.find({ category: product.category });
    const totalVelocity = categoryProducts.reduce((sum, p) => sum + p.demandVelocity, 0);
    const catAvg = categoryProducts.length > 0 ? totalVelocity / categoryProducts.length : 0;

    const strategy = new AIAdvisor();
    await recordTrigger({
      productId: product._id,
      sku: product.sku,
      category: product.category,
      triggerType: 'MANUAL',
      advisor: 'ai'
    });
    const suggestion = await strategy.suggestPricing(product, catAvg, 'MANUAL');

    const pricingSuggestion = new PricingSuggestion({
      productId: product._id,
      currentPrice: product.currentPrice,
      recommendedPrice: suggestion.recommendedPrice,
      direction: suggestion.direction,
      confidence: suggestion.confidence,
      reasoning: suggestion.reasoning,
      status: 'PENDING',
      triggerReason: 'MANUAL'
    });
    
    await pricingSuggestion.save();
    await Product.findByIdAndUpdate(product._id, { status: 'PRICE_REVIEW_PENDING' });
    res.json(pricingSuggestion);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /products/:id/suggest-pricing/stream
router.post('/:id/suggest-pricing/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      res.write('data: {"error": "Product not found"}\n\n');
      return res.end();
    }
    
    const categoryProducts = await Product.find({ category: product.category });
    const totalVelocity = categoryProducts.reduce((sum, p) => sum + p.demandVelocity, 0);
    const catAvg = categoryProducts.length > 0 ? totalVelocity / categoryProducts.length : 0;

    const strategy = new AIAdvisor();
    await recordTrigger({
      productId: product._id,
      sku: product.sku,
      category: product.category,
      triggerType: 'MANUAL',
      advisor: 'ai'
    });
    
    if (!strategy.suggestPricingStream) {
      res.write(`data: ${JSON.stringify({ chunk: "[Stream not supported by active strategy. Generating...]\n" })}\n\n`);
      const sug = await strategy.suggestPricing(product, catAvg, 'MANUAL');
      res.write(`data: ${JSON.stringify({ complete: true, suggestion: sug })}\n\n`);
      return res.end();
    }

    const onChunk = (textChunk) => {
      res.write(`data: ${JSON.stringify({ chunk: textChunk })}\n\n`);
    };

    const suggestion = await strategy.suggestPricingStream(product, catAvg, 'MANUAL', onChunk);

    const pricingSuggestion = new PricingSuggestion({
      productId: product._id,
      currentPrice: product.currentPrice,
      recommendedPrice: suggestion.recommendedPrice,
      direction: suggestion.direction,
      confidence: suggestion.confidence,
      reasoning: suggestion.reasoning,
      status: 'PENDING',
      triggerReason: 'MANUAL'
    });
    
    await pricingSuggestion.save();
    await Product.findByIdAndUpdate(product._id, { status: 'PRICE_REVIEW_PENDING' });
    res.write(`data: ${JSON.stringify({ complete: true, suggestion: pricingSuggestion })}\n\n`);
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
  } finally {
    res.end();
  }
});

// POST /products/:id/suggest-reorder
router.post('/:id/suggest-reorder', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const strategy = await getActiveStrategy();
    await recordTrigger({
      productId: product._id,
      sku: product.sku,
      category: product.category,
      triggerType: 'MANUAL',
      advisor: strategy instanceof AIAdvisor ? 'ai' : 'rule-based'
    });
    const suggestion = await strategy.suggestReorder(product, 'MANUAL');

    const reorderSuggestion = new ReorderSuggestion({
      productId: product._id,
      currentStock: product.stockLevel,
      recommendedQuantity: suggestion.recommendedQuantity,
      suggestedLeadTimeDays: suggestion.suggestedLeadTimeDays,
      confidence: suggestion.confidence,
      reasoning: suggestion.reasoning,
      status: 'PENDING',
      triggerReason: 'MANUAL'
    });

    await reorderSuggestion.save();
    await Product.findByIdAndUpdate(product._id, { status: 'PRICE_REVIEW_PENDING' });
    res.status(201).json(reorderSuggestion);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
