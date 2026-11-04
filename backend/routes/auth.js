import express from 'express';
import { signToken, authenticateJWT, ROLES } from '../middleware/auth.js';

const router = express.Router();

// POST /auth/token
router.post('/token', (req, res) => {
  const { role = 'MERCHANDISER', userId, name } = req.body;
  const normalizedRole = String(role).toUpperCase();

  if (!Object.values(ROLES).includes(normalizedRole)) {
    return res.status(400).json({
      error: `Invalid role '${role}'. Must be one of: ${Object.values(ROLES).join(', ')}`
    });
  }

  const effectiveUserId = userId || `usr_${normalizedRole.toLowerCase()}_${Date.now()}`;
  const effectiveName = name || `${normalizedRole.charAt(0) + normalizedRole.slice(1).toLowerCase()} User`;

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
