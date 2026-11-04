import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../../models/Product.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/sentinel';

async function run() {
  await mongoose.connect(MONGO_URI);
  const productId = process.argv[2];
  const newStock = parseInt(process.argv[3] || '5', 10);

  // Mutate stock in DB directly
  await Product.findByIdAndUpdate(productId, { stockLevel: newStock });

  // Send IPC message to parent that mutation occurred, then abruptly exit before any suggestion generation
  if (process.send) {
    process.send({ status: 'STOCK_MUTATED', productId, newStock });
  }

  // Terminate immediately simulating an abrupt mid-flight crash / power loss
  process.exit(137);
}

run().catch((err) => {
  console.error('CrashWorker error:', err);
  process.exit(1);
});
