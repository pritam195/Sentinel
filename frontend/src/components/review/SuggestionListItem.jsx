import React from 'react';
import { DollarSign, Package, TrendingUp, TrendingDown, Minus, ShieldAlert } from 'lucide-react';
import { TriggerBadge, SourceBadge, StatusBadge } from '../common/Badge';

export function SuggestionListItem({ suggestion, type = 'pricing', isSelected, onSelect }) {
  const isPricing = type === 'pricing';
  const product = suggestion.productId || {};

  // Compute Delta & Percentage
  let deltaText = '';
  let isPositive = false;
  let isNeutral = false;

  if (isPricing) {
    const oldPrice = suggestion.currentPrice || product.currentPrice || 0;
    const newPrice = suggestion.recommendedPrice || 0;
    const diff = newPrice - oldPrice;
    const pct = oldPrice > 0 ? (diff / oldPrice) * 100 : 0;
    isPositive = diff > 0.001;
    isNeutral = Math.abs(diff) <= 0.001;
    deltaText = `${isPositive ? '+' : ''}${pct.toFixed(1)}%`;
  } else {
    deltaText = `+${suggestion.recommendedQuantity ?? 0}`;
    isPositive = true;
  }

  // Age formatting
  const createdAt = suggestion.createdAt ? new Date(suggestion.createdAt) : null;
  const timeAgo = createdAt
    ? formatTimeAgo(Date.now() - createdAt.getTime())
    : 'just now';

  return (
    <div
      onClick={onSelect}
      className={`p-3.5 rounded-xl border transition-all cursor-pointer select-none relative ${
        isSelected
          ? 'bg-[var(--bg-elevated)] border-[var(--accent-primary)] shadow-md shadow-sky-500/10 dark:shadow-cyan-500/5'
          : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:border-[var(--border-active)] hover:bg-[var(--bg-hover)]'
      }`}
    >
      {/* Selection Left Accent Bar */}
      {isSelected && (
        <div className="absolute left-0 top-3 bottom-3 w-1 bg-[var(--accent-primary)] rounded-r" />
      )}

      {/* Row Header: Product Name + Time */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 border ${
              isPricing
                ? 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-400 dark:border-cyan-800/40'
                : 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-400 dark:border-indigo-800/40'
            }`}
          >
            {isPricing ? <DollarSign className="w-3.5 h-3.5" /> : <Package className="w-3.5 h-3.5" />}
          </div>
          <span className="font-semibold text-xs text-[var(--text-primary)] truncate">
            {product.name || 'Unknown Product'}
          </span>
        </div>

        <span className="text-[10px] font-mono-numbers text-[var(--text-muted)] shrink-0">
          {timeAgo}
        </span>
      </div>

      {/* Core Delta & Proposed Value */}
      <div className="mt-2.5 flex items-baseline justify-between">
        <div className="flex items-baseline gap-2 font-mono-numbers">
          <span className="text-xs text-[var(--text-muted)] line-through">
            {isPricing ? `$${suggestion.currentPrice?.toFixed(2)}` : `${suggestion.currentStock} units`}
          </span>
          <span className="text-sm font-bold text-[var(--text-primary)]">
            {isPricing ? `$${suggestion.recommendedPrice?.toFixed(2)}` : `+${suggestion.recommendedQuantity} units`}
          </span>
        </div>

        <div className="flex items-center gap-1 font-mono-numbers text-xs font-semibold">
          {isPricing && (
            <span
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-semibold border ${
                isNeutral
                  ? 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700'
                  : isPositive
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-400 dark:border-emerald-800/30'
                  : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/70 dark:text-rose-400 dark:border-rose-800/30'
              }`}
            >
              {isNeutral ? <Minus className="w-3 h-3" /> : isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {deltaText}
            </span>
          )}

          {!isPricing && (
            <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold border bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/70 dark:text-indigo-300 dark:border-indigo-800/30">
              {deltaText} order
            </span>
          )}
        </div>
      </div>

      {/* Badges & Meta */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <TriggerBadge trigger={suggestion.triggerReason} />
        
        {suggestion.status !== 'PENDING' && (
          <StatusBadge status={suggestion.status} />
        )}

        {suggestion.wasClamped && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono-numbers bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/30 font-semibold">
            <ShieldAlert className="w-3 h-3 text-amber-600 dark:text-amber-400" /> CLAMPED
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5 font-mono-numbers text-[10px] text-[var(--text-muted)]">
          <span>CONF</span>
          <span className="font-semibold text-[var(--text-secondary)]">
            {((suggestion.confidence ?? 0.8) * 100).toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(diffMs) {
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${Math.max(1, seconds)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
