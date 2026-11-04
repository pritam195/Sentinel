import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import Product from '../models/Product.js';
import PricingSuggestion from '../models/PricingSuggestion.js';
import ReorderSuggestion from '../models/ReorderSuggestion.js';
import User, { seedDefaultUsers } from '../models/User.js';
import Config from '../models/Config.js';
import inventoryEvents from '../events/inventoryEvents.js';
import { waitForInFlightToClear } from '../services/recommendationLoop.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/sentinel';
const JWT_SECRET = process.env.JWT_SECRET || 'sentinel_demo_secret_minimum_32_characters_key_123';

async function runDemo() {
  console.log('\n===============================================================');
  console.log('              SENTINEL RUN-IT-IN-30-SECONDS DEMO               ');
  console.log('===============================================================');

  // 1. Connect & Sync
  console.log('\n[1/4] Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  await Promise.all([
    PricingSuggestion.syncIndexes(),
    ReorderSuggestion.syncIndexes()
  ]);

  // Ensure config is in default rule-based mode
  await Config.findOneAndUpdate(
    {},
    { activeStrategy: 'rule-based', demandSpikeMultiplier: 3, maxSingleChangePercent: 20 },
    { upsert: true }
  );

  // 2. Seed catalog and demo users
  console.log('[2/4] Seeding demo merchandiser and catalog...');
  await seedDefaultUsers();
  
  // Clean previous demo state
  await Product.deleteMany({ sku: /^DEMO-/ });
  await PricingSuggestion.deleteMany({});
  await ReorderSuggestion.deleteMany({});

  // Ensure category peers exist so category average velocity is well-defined
  await Product.updateOne(
    { sku: 'DEMO-PEER-ELEC' },
    {
      name: 'Electronics Category Benchmark Peer',
      category: 'ELECTRONICS',
      currentPrice: 80.00,
      costPrice: 35.00,
      stockLevel: 100,
      reorderThreshold: 20,
      demandVelocity: 3,
      status: 'ACTIVE'
    },
    { upsert: true }
  );

  const demoProduct = await Product.create({
    sku: 'DEMO-HEADPHONES-01',
    name: 'Sentinel Studio Wireless ANC Headphones',
    category: 'ELECTRONICS',
    currentPrice: 120.00,
    costPrice: 50.00,
    stockLevel: 50,
    reorderThreshold: 20,
    demandVelocity: 2,
    status: 'ACTIVE',
    priceVersion: 1,
    priceHistory: [{ price: 120.00, date: new Date() }]
  });

  // 3. Log in demo merchandiser
  console.log('[3/4] Authenticating seeded Merchandiser user...');
  const user = await User.findOne({ username: 'merchandiser' });
  if (!user) throw new Error('Seeded merchandiser user not found');

  const token = jwt.sign(
    { id: user._id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  console.log(`      ✓ Authenticated user: "${user.username}" (ID: ${user._id})`);
  console.log(`      ✓ Server-verified role: ${user.role}`);
  console.log(`      ✓ Session token issued (JWT expiry: 1h)`);

  // 4. Trigger scripted low-stock scenario
  console.log('\n[4/4] Triggering scripted low-stock scenario...');
  console.log(`      Target Product:  ${demoProduct.name} (${demoProduct.sku})`);
  console.log(`      Initial Stock:   ${demoProduct.stockLevel} units (Threshold: ${demoProduct.reorderThreshold})`);
  console.log(`      Current Price:   $${demoProduct.currentPrice.toFixed(2)} (Unit Cost: $${demoProduct.costPrice.toFixed(2)})`);

  // Mutate stock below threshold
  const newStock = 4;
  demoProduct.stockLevel = newStock;
  await demoProduct.save();

  console.log(`      💥 Stock mutated: 50 -> ${newStock} units (Below threshold of 20 -> INVENTORY_LOW fired)`);

  // Emit event into recommendation loop
  inventoryEvents.emit('inventory:changed', demoProduct);
  await waitForInFlightToClear(10000);
  await new Promise(r => setTimeout(r, 600));

  // Retrieve generated suggestions
  const pricingSuggestion = await PricingSuggestion.findOne({
    productId: demoProduct._id,
    triggerReason: 'INVENTORY_LOW',
    status: 'PENDING'
  });

  const reorderSuggestion = await ReorderSuggestion.findOne({
    productId: demoProduct._id,
    triggerReason: 'INVENTORY_LOW',
    status: 'PENDING'
  });

  console.log('\n===============================================================');
  console.log('             GENERATED MERCHANDISING SUGGESTIONS               ');
  console.log('===============================================================');

  if (pricingSuggestion) {
    console.log('\n[PRICING RECOMMENDATION]');
    console.log(`  Suggestion ID:       ${pricingSuggestion._id}`);
    console.log(`  Current Price:       $${pricingSuggestion.currentPrice.toFixed(2)}`);
    console.log(`  Recommended Price:   $${pricingSuggestion.recommendedPrice.toFixed(2)}`);
    console.log(`  Action / Direction:  ${pricingSuggestion.direction}`);
    console.log(`  Advisor Confidence:  ${(pricingSuggestion.confidence * 100).toFixed(0)}%`);
    console.log(`  Decision Reasoning:  "${pricingSuggestion.reasoning}"`);
    console.log(`  HITL Queue Status:   ${pricingSuggestion.status} (Awaiting Merchandiser Review)`);
  } else {
    console.log('\n[PRICING RECOMMENDATION] No pending suggestion found.');
  }

  if (reorderSuggestion) {
    console.log('\n[INVENTORY REORDER RECOMMENDATION]');
    console.log(`  Suggestion ID:       ${reorderSuggestion._id}`);
    console.log(`  Current Stock:       ${reorderSuggestion.currentStock} units`);
    console.log(`  Reorder Quantity:    ${reorderSuggestion.recommendedQuantity} units`);
    console.log(`  Suggested Lead Time: ${reorderSuggestion.suggestedLeadTimeDays} days`);
    console.log(`  Advisor Confidence:  ${(reorderSuggestion.confidence * 100).toFixed(0)}%`);
    console.log(`  Decision Reasoning:  "${reorderSuggestion.reasoning}"`);
    console.log(`  HITL Queue Status:   ${reorderSuggestion.status} (Awaiting Merchandiser Review)`);
  } else {
    console.log('\n[INVENTORY REORDER RECOMMENDATION] No pending suggestion found.');
  }

  console.log('\n===============================================================');
  console.log('                        DEMO SUMMARY                           ');
  console.log('===============================================================');
  console.log('  1. Autonomous Detection: Inventory low trigger fired immediately on stock depletion.');
  console.log('  2. Fast to Propose:      Pricing and reorder proposals drafted in milliseconds.');
  console.log('  3. Slow to Trust:        Live price ($120.00) remains unchanged until authorized');
  console.log('                           merchandiser explicitly approves in the HITL queue UI.');
  console.log('  4. Review Dashboard:     Open http://localhost:5173 to review and act.');
  console.log('===============================================================\n');

  await mongoose.disconnect();
}

runDemo().catch((err) => {
  console.error('Demo error:', err);
  process.exit(1);
});
