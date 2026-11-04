import express from 'express';
import './services/recommendationLoop.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import morgan from 'morgan';
import PricingSuggestion from './models/PricingSuggestion.js';
import ReorderSuggestion from './models/ReorderSuggestion.js';

dotenv.config();

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

// Routes
app.use('/auth', authRoutes);
app.use('/products', productRoutes);
app.use('/', suggestionRoutes);
app.use('/config', configRoutes);

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/sentinel')
  .then(async () => {
    console.log('Connected to MongoDB');
    try {
      await Promise.all([
        PricingSuggestion.syncIndexes(),
        ReorderSuggestion.syncIndexes()
      ]);
    } catch (e) {
      console.warn('Index sync warning:', e.message);
    }
  })
  .catch(err => console.error('MongoDB connection error:', err));

// Start Server
app.listen(PORT, () => {
  console.log(`Sentinel API running on port ${PORT}`);
});

export default app;
