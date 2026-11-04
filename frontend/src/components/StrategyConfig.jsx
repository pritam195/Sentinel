import React, { useState } from 'react';
import { API_BASE } from '../config';

export default function StrategyConfig({ config, fetchConfig, setError, token, user, onRequireLogin }) {
  const [loading, setLoading] = useState(false);

  const toggleStrategy = async (strategy) => {
    if (config?.activeStrategy === strategy) return;
    
    if (!token) {
      if (onRequireLogin) onRequireLogin();
      setError('Please log in as ADMIN to change advisor strategy.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/config/strategy`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ strategy })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 403) {
          throw new Error(`Forbidden: Role '${user?.role || 'UNKNOWN'}' cannot change strategy. Only ADMIN is authorized.`);
        }
        throw new Error(data.error || 'Failed to update strategy');
      }

      await fetchConfig();
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const isActive = (s) => config?.activeStrategy === s;

  return (
    <div className="strategy-toggle-inline">
      <span style={{ color: 'var(--text-muted)' }}>Engine:</span>
      <div className="toggle-switch">
        <div 
          className={`toggle-option ${isActive('rule-based') ? 'active' : ''}`}
          onClick={() => !loading && toggleStrategy('rule-based')}
          title={user?.role !== 'ADMIN' ? 'Admin role required' : ''}
        >
          Rule-Based
        </div>
        <div 
          className={`toggle-option ${isActive('ai') ? 'active ai-mode' : ''}`}
          onClick={() => !loading && toggleStrategy('ai')}
          title={user?.role !== 'ADMIN' ? 'Admin role required' : ''}
        >
          AI Advisor
        </div>
      </div>
    </div>
  );
}
