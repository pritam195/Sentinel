import React from 'react';

export function StockHealthBar({ stockLevel = 0, reorderThreshold = 20 }) {
  const threshold = Math.max(1, reorderThreshold);
  const ratio = stockLevel / threshold;

  // Status calculation
  let color = 'bg-emerald-400';
  let label = 'Healthy';
  let badgeClass = 'text-emerald-400';

  if (stockLevel === 0) {
    color = 'bg-rose-500';
    label = 'Out of Stock';
    badgeClass = 'text-rose-400 font-bold';
  } else if (ratio < 1) {
    color = 'bg-rose-400';
    label = 'Below Threshold';
    badgeClass = 'text-rose-400';
  } else if (ratio <= 1.5) {
    color = 'bg-amber-400';
    label = 'Low Buffer';
    badgeClass = 'text-amber-400';
  }

  // Cap visual bar at 100% width for ratio = 2.0
  const fillWidth = Math.min(100, Math.max(0, (ratio / 2) * 100));

  return (
    <div className="w-28 space-y-1">
      <div className="flex items-center justify-between text-[10px] font-mono-numbers">
        <span className={badgeClass}>{stockLevel}</span>
        <span className="text-[var(--text-muted)]">/ {reorderThreshold} thold</span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${color}`}
          style={{ width: `${fillWidth}%` }}
        />
      </div>
    </div>
  );
}

