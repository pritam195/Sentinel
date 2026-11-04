import mongoose from 'mongoose';
import dotenv from 'dotenv';
import inventoryEvents from '../../events/inventoryEvents.js';
import '../../services/recommendationLoop.js';
import Product from '../../models/Product.js';
import PricingSuggestion from '../../models/PricingSuggestion.js';
import ReorderSuggestion from '../../models/ReorderSuggestion.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/sentinel';

async function run() {
  await mongoose.connect(MONGO_URI);
  await Promise.all([
    PricingSuggestion.syncIndexes(),
    ReorderSuggestion.syncIndexes()
  ]);

  const productId = process.argv[2];
  const numEvents = parseInt(process.argv[3] || '100', 10);
  const delayBetweenMs = parseInt(process.argv[4] || '0', 10);

  const product = await Product.findById(productId);
  if (!product) {
    console.error(`Worker: Product not found: ${productId}`);
    process.exit(1);
  }

  // Signal ready to parent if IPC is open
  if (process.send) {
    process.send({ status: 'READY' });
  }

  for (let i = 0; i < numEvents; i++) {
    inventoryEvents.emit('inventory:changed', product);
    if (delayBetweenMs > 0) {
      await new Promise(r => setTimeout(r, delayBetweenMs));
    }
  }

  // Allow async tasks on the event loop to settle
  await new Promise(r => setTimeout(r, 3500));
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('Worker failed:', err);
  process.exit(1);
});
