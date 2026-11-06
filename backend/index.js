import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

// Fail startup immediately if JWT_SECRET is missing outside of test mode
if (!process.env.JWT_SECRET && process.env.NODE_ENV !== 'test') {
  console.error('FATAL: JWT_SECRET environment variable is missing outside of test mode.');
  process.exit(1);
}

// Log loud warning at boot if dev tokens are enabled
if (process.env.ALLOW_DEV_TOKENS === 'true' && process.env.NODE_ENV !== 'production') {
  console.warn('\n⚠️  [SECURITY WARNING] ALLOW_DEV_TOKENS=true is active! Dev token endpoint is enabled at /auth/dev-token. DO NOT ENABLE IN PRODUCTION!\n');
}

import { runReconciliationSweep, startReconciliationScheduler } from './services/recommendationLoop.js';
import mongoose from 'mongoose';
import cors from 'cors';
import morgan from 'morgan';
import PricingSuggestion from './models/PricingSuggestion.js';
import ReorderSuggestion from './models/ReorderSuggestion.js';
import Config from './models/Config.js';
import { seedDefaultUsers } from './models/User.js';

import productRoutes from './routes/products.js';
import suggestionRoutes from './routes/suggestions.js';
import configRoutes from './routes/config.js';
import authRoutes from './routes/auth.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Health & Diagnostics Endpoint
let lastMongoError = null;

app.get('/health', (req, res) => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || '';
  const maskedUri = uri ? uri.replace(/:([^@]+)@/, ':****@') : 'NONE (Using localhost)';
  res.json({
    status: mongoose.connection.readyState === 1 ? 'ok' : 'error',
    mongoState: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown',
    mongoUriConfigured: Boolean(uri),
    mongoUriMasked: maskedUri,
    lastMongoError: lastMongoError || null,
  });
});

// Routes
app.use('/auth', authRoutes);
app.use('/products', productRoutes);
app.use('/', suggestionRoutes);
app.use('/config', configRoutes);

// MongoDB Connection
const targetMongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/sentinel';
mongoose.connect(targetMongoUri)
  .then(async () => {
    console.log('Connected to MongoDB');
    lastMongoError = null;
    try {
      await Promise.all([
        PricingSuggestion.syncIndexes(),
        ReorderSuggestion.syncIndexes()
      ]);
      await seedDefaultUsers();

      // Run reconciliation sweep at startup
      console.log('[Startup] Executing initial inventory reconciliation sweep...');
      const sweepResult = await runReconciliationSweep();
      console.log(`[Startup] Initial reconciliation sweep complete: ${sweepResult.reconciledCount} product events re-emitted.`);

      // Start periodic reconciliation scheduler
      const config = await Config.findOne();
      const intervalMinutes = config?.reconciliationIntervalMinutes ?? parseInt(process.env.RECONCILIATION_INTERVAL_MINUTES || '15', 10);
      startReconciliationScheduler(intervalMinutes * 60 * 1000);
    } catch (e) {
      console.warn('Startup initialization warning:', e.message);
    }
  })
  .catch(err => {
    lastMongoError = err.message || String(err);
    console.error('MongoDB connection error:', err);
  });

// Start Server
app.listen(PORT, () => {
  console.log(`Sentinel API running on port ${PORT}`);
});

export default app;
