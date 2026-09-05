import express from 'express';
import './services/recommendationLoop.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import morgan from 'morgan';

dotenv.config();

import productRoutes from './routes/products.js';
import suggestionRoutes from './routes/suggestions.js';
import configRoutes from './routes/config.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Routes
app.use('/products', productRoutes);
app.use('/', suggestionRoutes);
app.use('/config', configRoutes);

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/sentinel')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Start Server
app.listen(PORT, () => {
  console.log(`Sentinel API running on port ${PORT}`);
});

