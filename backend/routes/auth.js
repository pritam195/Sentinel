import express from 'express';
import User from '../models/User.js';
import { signToken, authenticateJWT, createLoginRateLimiter, ROLES } from '../middleware/auth.js';

const router = express.Router();
const loginLimiter = createLoginRateLimiter({ windowMs: 60 * 1000, max: 10 });

// POST /auth/login
// Server-side role lookup using seeded users and bcrypt verification
router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const normalizedUsername = String(username).toLowerCase().trim();
  const user = await User.findOne({ username: normalizedUsername });

  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: Invalid username or password' });
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    return res.status(401).json({ error: 'Unauthorized: Invalid username or password' });
  }

  // Server-side role lookup: strictly ignore any client-supplied role in req.body
  const token = signToken({
    userId: user.userId,
    username: user.username,
    role: user.role,
    name: user.name
  });

  res.json({
    token,
    user: {
      userId: user.userId,
      username: user.username,
      role: user.role,
      name: user.name
    }
  });
});

// POST /auth/dev-token
// Enabled ONLY when ALLOW_DEV_TOKENS=true and NODE_ENV !== "production"
router.post('/dev-token', (req, res) => {
  if (process.env.ALLOW_DEV_TOKENS !== 'true' || process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      error: 'Forbidden: Dev tokens are disabled. Set ALLOW_DEV_TOKENS=true in non-production environments to enable.'
    });
  }

  const { role = 'MERCHANDISER', userId, name } = req.body;
  const normalizedRole = String(role).toUpperCase();

  if (!Object.values(ROLES).includes(normalizedRole)) {
    return res.status(400).json({
      error: `Invalid role '${role}'. Must be one of: ${Object.values(ROLES).join(', ')}`
    });
  }

  const effectiveUserId = userId || `usr_dev_${normalizedRole.toLowerCase()}_${Date.now()}`;
  const effectiveName = name || `Dev ${normalizedRole} User`;

  const token = signToken({
    userId: effectiveUserId,
    role: normalizedRole,
    name: effectiveName
  });

  res.json({
    token,
    user: {
      userId: effectiveUserId,
      role: normalizedRole,
      name: effectiveName
    }
  });
});

// GET /auth/me
router.get('/me', authenticateJWT, (req, res) => {
  res.json({ user: req.user });
});

export default router;
