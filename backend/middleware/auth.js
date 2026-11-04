import jwt from 'jsonwebtoken';

export const JWT_SECRET = process.env.JWT_SECRET || 'sentinel-secure-jwt-secret-key-2026';

export const ROLES = {
  VIEWER: 'VIEWER',
  MERCHANDISER: 'MERCHANDISER',
  ADMIN: 'ADMIN'
};

/**
 * Sign a JWT token with user details and role
 */
export function signToken(payload, options = {}) {
  const expiresIn = options.expiresIn || '24h';
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
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

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
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
 * Helper to generate pre-configured tokens for testing and frontend
 */
export function createTestUser(role, userId, name) {
  const effectiveUserId = userId || `usr_${role.toLowerCase()}_${Date.now()}`;
  const token = signToken({
    userId: effectiveUserId,
    role,
    name: name || `Test ${role}`
  });
  return { userId: effectiveUserId, role, token };
}

