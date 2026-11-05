import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

export const SEEDED_ACCOUNTS = [
  {
    role: 'MERCHANDISER',
    label: 'Merchandiser',
    username: 'merchandiser',
    password: 'merchpassword123',
    description: 'Can accept/reject proposals and mutate catalog stock/prices.',
    badge: 'Decision Maker',
  },
  {
    role: 'ADMIN',
    label: 'Admin',
    username: 'admin',
    password: 'adminpassword123',
    description: 'Full privileges: can switch advisor engine & edit guardrail thresholds.',
    badge: 'System Admin',
  },
  {
    role: 'VIEWER',
    label: 'Viewer',
    username: 'viewer',
    password: 'viewerpassword123',
    description: 'Read-only audit privileges across catalog and proposal inbox.',
    badge: 'Read-Only',
  },
];

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('sentinel_token') || null);
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('sentinel_user') || 'null');
    } catch {
      return null;
    }
  });
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);

  // Synchronize storage
  const persistAuth = useCallback((newToken, newUser) => {
    if (newToken) {
      localStorage.setItem('sentinel_token', newToken);
      setToken(newToken);
    } else {
      localStorage.removeItem('sentinel_token');
      setToken(null);
    }

    if (newUser) {
      localStorage.setItem('sentinel_user', JSON.stringify(newUser));
      setUser(newUser);
    } else {
      localStorage.removeItem('sentinel_user');
      setUser(null);
    }
  }, []);

  // Validate token with server on initial boot
  useEffect(() => {
    if (!token) return;
    let isMounted = true;

    api.auth
      .me(token)
      .then((res) => {
        if (isMounted && res?.user) {
          setUser(res.user);
          localStorage.setItem('sentinel_user', JSON.stringify(res.user));
        }
      })
      .catch(() => {
        // Token expired or invalid
        if (isMounted) {
          persistAuth(null, null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [token, persistAuth]);

  const login = async (username, password) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await api.auth.login({ username, password });
      persistAuth(res.token, res.user);
      setIsAuthModalOpen(false);
      return res;
    } catch (err) {
      setAuthError(err.message || 'Authentication failed');
      throw err;
    } finally {
      setAuthLoading(false);
    }
  };

  const quickLogin = async (roleName) => {
    const preset = SEEDED_ACCOUNTS.find((a) => a.role === roleName.toUpperCase());
    if (!preset) throw new Error(`Unknown role preset: ${roleName}`);
    return login(preset.username, preset.password);
  };

  const logout = () => {
    persistAuth(null, null);
  };

  const openAuthModal = () => {
    setAuthError(null);
    setIsAuthModalOpen(true);
  };

  const closeAuthModal = () => {
    setAuthError(null);
    setIsAuthModalOpen(false);
  };

  const role = user?.role || null;
  const isViewer = role === 'VIEWER';
  const isMerchandiser = role === 'MERCHANDISER';
  const isAdmin = role === 'ADMIN';
  const canReview = isMerchandiser || isAdmin;
  const canConfigure = isAdmin;
  const isLoggedIn = Boolean(token && user);

  const value = {
    token,
    user,
    role,
    isLoggedIn,
    isViewer,
    isMerchandiser,
    isAdmin,
    canReview,
    canConfigure,
    authLoading,
    authError,
    setAuthError,
    login,
    quickLogin,
    logout,
    isAuthModalOpen,
    openAuthModal,
    closeAuthModal,
    SEEDED_ACCOUNTS,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
