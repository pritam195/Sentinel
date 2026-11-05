import dotenv from 'dotenv';
dotenv.config();

import jwt from 'jsonwebtoken';

const isTest = process.env.NODE_ENV === 'test' || !process.env.NODE_ENV;

if (!process.env.JWT_SECRET && !isTest) {
  throw new Error('FATAL: JWT_SECRET environment variable is missing outside of test mode.');
}

export const JWT_SECRET = process.env.JWT_SECRET || (isTest ? 'sentinel-test-jwt-secret-key-2026' : undefined);

export const ROLES = {
  VIEWER: 'VIEWER',
  MERCHANDISER: 'MERCHANDISER',
  ADMIN: 'ADMIN'
};

/**
 * Sign a JWT token with user details and server-verified role
 * Default expiry: 1 hour (as required by Phase 1 Auth Lockdown)
 */
export function signToken(payload, options = {}) {
  const expiresIn = options.expiresIn || '1h';
  return jwt.sign(payload, JWT_SECRET, { expiresIn, algorithm: 'HS256' });
}

/**
 * Middleware: Verifies JWT token and populates req.user
 */
export function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Authentication token is required' });
  }

  jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, decoded) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Unauthorized: Token has expired' });
      }
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
    }
    req.user = decoded;
    next();
  });
}

/**
 * Middleware: Enforces that req.user has one of the allowed roles
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Forbidden: Role '${req.user.role}' is not authorized. Required: ${allowedRoles.join(', ')}`
      });
    }
    next();
  };
}

/**
 * Simple in-memory rate limiter for login attempts
 * Limits consecutive failed or repeated attempts per IP
 */
export function createLoginRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60 * 1000; // 1 minute default
  const max = options.max || 10; // max 10 attempts per minute
  const attempts = new Map();

  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const clientData = attempts.get(ip) || { count: 0, resetTime: now + windowMs };

    if (now > clientData.resetTime) {
      clientData.count = 0;
      clientData.resetTime = now + windowMs;
    }

    clientData.count++;
    attempts.set(ip, clientData);

    if (clientData.count > max) {
      const retryAfterSec = Math.ceil((clientData.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSec);
      return res.status(429).json({
        error: `Too many login attempts. Please try again after ${retryAfterSec} seconds.`
      });
    }

    next();
  };
}
