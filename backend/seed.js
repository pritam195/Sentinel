import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from './models/Product.js';
import PricingSuggestion from './models/PricingSuggestion.js';
import ReorderSuggestion from './models/ReorderSuggestion.js';
import InventorySnapshot from './models/InventorySnapshot.js';
import AdvisorLog from './models/AdvisorLog.js';
import { seedDefaultUsers } from './models/User.js';

dotenv.config();

const seedProducts = [
  { sku: 'SKU-ELEC-001', name: 'Wireless Earbuds Pro', category: 'ELECTRONICS', currentPrice: 79.99, costPrice: 40.00, stockLevel: 45, reorderThreshold: 20, demandVelocity: 3, status: 'ACTIVE', priceHistory: [{ price: 79.99 }] },
  { sku: 'SKU-ELEC-002', name: 'USB-C Hub 7-Port', category: 'ELECTRONICS', currentPrice: 34.99, costPrice: 15.00, stockLevel: 120, reorderThreshold: 30, demandVelocity: 1, status: 'ACTIVE', priceHistory: [{ price: 34.99 }] },
  { sku: 'SKU-APP-001', name: 'Organic Cotton T-Shirt', category: 'APPAREL', currentPrice: 24.99, costPrice: 10.00, stockLevel: 8, reorderThreshold: 15, demandVelocity: 12, status: 'ACTIVE', priceHistory: [{ price: 24.99 }] },
  { sku: 'SKU-APP-002', name: 'Running Shorts — Navy', category: 'APPAREL', currentPrice: 39.99, costPrice: 18.00, stockLevel: 55, reorderThreshold: 20, demandVelocity: 2, status: 'ACTIVE', priceHistory: [{ price: 39.99 }] },
  { sku: 'SKU-HOME-001', name: 'Ceramic Pour-Over Set', category: 'HOME', currentPrice: 49.99, costPrice: 20.00, stockLevel: 22, reorderThreshold: 10, demandVelocity: 4, status: 'ACTIVE', priceHistory: [{ price: 49.99 }] },
  { sku: 'SKU-HOME-002', name: 'LED Desk Lamp — Dimmable', category: 'HOME', currentPrice: 59.99, costPrice: 25.00, stockLevel: 0, reorderThreshold: 15, demandVelocity: 0, status: 'OUT_OF_STOCK', priceHistory: [{ price: 59.99 }] },
  { sku: 'SKU-ELEC-003', name: 'Portable Charger 20K', category: 'ELECTRONICS', currentPrice: 44.99, costPrice: 22.00, stockLevel: 18, reorderThreshold: 25, demandVelocity: 8, status: 'ACTIVE', priceHistory: [{ price: 44.99 }] },
  { sku: 'SKU-APP-003', name: 'Hoodie — Heather Grey', category: 'APPAREL', currentPrice: 54.99, costPrice: 30.00, stockLevel: 11, reorderThreshold: 12, demandVelocity: 15, status: 'ACTIVE', priceHistory: [{ price: 54.99 }] }
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/sentinel');
    console.log('Connected to MongoDB for seeding...');

    await Product.deleteMany({});
    await PricingSuggestion.deleteMany({});
    await ReorderSuggestion.deleteMany({});
    await InventorySnapshot.collection.deleteMany({});
    await AdvisorLog.collection.deleteMany({});
    console.log('Cleared existing data.');

    const products = await Product.insertMany(seedProducts);
    await InventorySnapshot.insertMany(products.map((product) => ({
      productId: product._id,
      stockLevel: product.stockLevel,
      demandVelocity: product.demandVelocity,
      source: 'CREATED'
    })));
    console.log('Inserted seed products.');

    await seedDefaultUsers();
    console.log('Seeded default authenticated users (admin, merchandiser, viewer).');

    process.exit(0);
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  }
}

seed();
