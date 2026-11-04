import React, { useState } from 'react';
import { API_BASE } from '../config';

const SEEDED_PRESETS = [
  { label: 'Merchandiser', username: 'merchandiser', password: 'merchpassword123', role: 'MERCHANDISER' },
  { label: 'Admin', username: 'admin', password: 'adminpassword123', role: 'ADMIN' },
  { label: 'Viewer', username: 'viewer', password: 'viewerpassword123', role: 'VIEWER' }
];

export default function AuthModal({ onLoginSuccess, isOpen, onClose }) {
  const [username, setUsername] = useState('merchandiser');
  const [password, setPassword] = useState('merchpassword123');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }

      localStorage.setItem('sentinel_token', data.token);
      localStorage.setItem('sentinel_user', JSON.stringify(data.user));
      onLoginSuccess(data.token, data.user);
      if (onClose) onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPreset = (preset) => {
    setUsername(preset.username);
    setPassword(preset.password);
    setError(null);
  };

  return (
    <div className="modal-backdrop">
      <div className="auth-modal-card fade-in">
        <div className="auth-modal-header">
          <h3>Authenticate to Sentinel</h3>
          {onClose && <button className="close-btn" onClick={onClose}>&times;</button>}
        </div>

        <p className="auth-subtitle">
          RBAC enforced on all review actions and configuration changes.
        </p>

        <div className="preset-pill-group">
          <span className="preset-label">Quick switch:</span>
          {SEEDED_PRESETS.map((p) => (
            <button
              key={p.role}
              type="button"
              className={`preset-btn ${username === p.username ? 'active' : ''}`}
              onClick={() => handleSelectPreset(p)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {error && <div className="auth-error-banner">⚠️ {error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder="e.g. merchandiser"
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="auth-modal-actions">
            <button type="submit" className="login-submit-btn" disabled={loading}>
              {loading ? 'Authenticating...' : `Log In as ${username}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
