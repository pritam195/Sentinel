import React, { useState, useRef, useEffect } from 'react';
import { Bell, AlertTriangle, TrendingUp, Sparkles, X } from 'lucide-react';

export function AlertsPopover({ pricingSuggestions = [], reorderSuggestions = [], onSelectTrigger }) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef(null);

  // Group triggers
  const allSuggestions = [...pricingSuggestions, ...reorderSuggestions];
  const lowStockCount = allSuggestions.filter((s) => s.triggerReason === 'INVENTORY_LOW').length;
  const demandSpikeCount = allSuggestions.filter((s) => s.triggerReason === 'DEMAND_SPIKE').length;
  const manualCount = allSuggestions.filter((s) => s.triggerReason === 'MANUAL').length;
  const totalCount = allSuggestions.length;

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative p-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
        aria-label="View trigger notifications"
      >
        <Bell className="w-4 h-4" />
        {totalCount > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--semantic-amber)] text-black font-bold text-[9px] font-mono-numbers flex items-center justify-center animate-pulse">
            {totalCount > 9 ? '9+' : totalCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xl p-4 z-40 animate-slide-up text-[var(--text-primary)]">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Active System Triggers
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono-numbers bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                {totalCount}
              </span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {/* Low Stock Group */}
            <div
              onClick={() => {
                if (onSelectTrigger) onSelectTrigger('INVENTORY_LOW');
                setIsOpen(false);
              }}
              className="p-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer flex items-center justify-between"
            >
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded bg-rose-950/60 text-rose-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="text-xs font-medium text-[var(--text-primary)]">Low Stock Alerts</div>
                  <div className="text-[10px] text-[var(--text-muted)]">Inventory below threshold</div>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded text-xs font-mono-numbers font-semibold bg-rose-950/80 text-rose-300 border border-rose-800/40">
                {lowStockCount}
              </span>
            </div>

            {/* Demand Spike Group */}
            <div
              onClick={() => {
                if (onSelectTrigger) onSelectTrigger('DEMAND_SPIKE');
                setIsOpen(false);
              }}
              className="p-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer flex items-center justify-between"
            >
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded bg-cyan-950/60 text-cyan-400">
                  <TrendingUp className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="text-xs font-medium text-[var(--text-primary)]">Demand Surges</div>
                  <div className="text-[10px] text-[var(--text-muted)]">Velocity exceeding category baseline</div>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded text-xs font-mono-numbers font-semibold bg-cyan-950/80 text-cyan-300 border border-cyan-800/40">
                {demandSpikeCount}
              </span>
            </div>

            {/* Manual Triggers */}
            {manualCount > 0 && (
              <div
                onClick={() => {
                  if (onSelectTrigger) onSelectTrigger('MANUAL');
                  setIsOpen(false);
                }}
                className="p-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer flex items-center justify-between"
              >
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded bg-indigo-950/60 text-indigo-400">
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[var(--text-primary)]">Manual Requests</div>
                    <div className="text-[10px] text-[var(--text-muted)]">On-demand merchandiser triggers</div>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded text-xs font-mono-numbers font-semibold bg-indigo-950/80 text-indigo-300 border border-indigo-800/40">
                  {manualCount}
                </span>
              </div>
            )}
          </div>

          <div className="mt-3 pt-2.5 border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)] text-center">
            Click any trigger group to filter the review queue
          </div>
        </div>
      )}
    </div>
  );
}
