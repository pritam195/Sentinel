import React, { useState } from 'react';
import { API_BASE } from '../config';

export default function StrategyConfig({ config, fetchConfig, setError }) {
  const [loading, setLoading] = useState(false);

  const toggleStrategy = async (strategy) => {
    if (config?.activeStrategy === strategy) return;
    
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/config/strategy`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy })
      });
      if (!res.ok) throw new Error('Failed to update strategy');
      await fetchConfig();
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
        >
          Rule-Based
        </div>
        <div 
          className={`toggle-option ${isActive('ai') ? 'active ai-mode' : ''}`}
          onClick={() => !loading && toggleStrategy('ai')}
        >
          AI Advisor
        </div>
      </div>
    </div>
  );
}
