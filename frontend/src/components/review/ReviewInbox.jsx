import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Inbox,
  Search,
  Filter,
  CheckCircle,
  XCircle,
  Clock,
  Sparkles,
  ArrowUpDown,
  Layers,
  RefreshCw,
  CheckCheck,
} from 'lucide-react';
import { SuggestionListItem } from './SuggestionListItem';
import { SuggestionDetailPane } from './SuggestionDetailPane';
import { SuggestionCardSkeleton } from '../common/Skeleton';
import { useSuggestions } from '../../api/hooks';

export function ReviewInbox({
  onOpenLiveStream,
  onOpenShortcuts,
  activeTriggerFilter,
  onClearTriggerFilter,
}) {
  const [activeStatusTab, setActiveStatusTab] = useState('PENDING'); // PENDING | ACCEPTED | REJECTED | STALE | EXPIRED
  const [typeFilter, setTypeFilter] = useState('ALL'); // ALL | PRICING | REORDER
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('NEWEST'); // NEWEST | OLDEST | CONFIDENCE | DELTA
  const [selectedId, setSelectedId] = useState(null);

  const searchInputRef = useRef(null);

  const {
    pricingSuggestions,
    reorderSuggestions,
    loading,
    error,
    actionInProgress,
    refresh,
    acceptPricing,
    rejectPricing,
    acceptReorder,
    rejectReorder,
  } = useSuggestions({ status: activeStatusTab });

  // Merge and normalize suggestions
  const unifiedList = useMemo(() => {
    const list = [];
    if (typeFilter === 'ALL' || typeFilter === 'PRICING') {
      pricingSuggestions.forEach((p) => list.push({ ...p, _type: 'pricing' }));
    }
    if (typeFilter === 'ALL' || typeFilter === 'REORDER') {
      reorderSuggestions.forEach((r) => list.push({ ...r, _type: 'reorder' }));
    }

    // Filter by trigger reason if set by Alerts Popover
    let filtered = list;
    if (activeTriggerFilter) {
      filtered = filtered.filter((item) => item.triggerReason === activeTriggerFilter);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((item) => {
        const prod = item.productId || {};
        return (
          prod.name?.toLowerCase().includes(q) ||
          prod.sku?.toLowerCase().includes(q) ||
          prod.category?.toLowerCase().includes(q) ||
          item.triggerReason?.toLowerCase().includes(q)
        );
      });
    }

    // Sort list
    return filtered.sort((a, b) => {
      if (sortBy === 'NEWEST') {
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      }
      if (sortBy === 'OLDEST') {
        return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
      }
      if (sortBy === 'CONFIDENCE') {
        return (b.confidence || 0) - (a.confidence || 0);
      }
      if (sortBy === 'DELTA') {
        const deltaA = Math.abs((a.recommendedPrice ?? a.recommendedQuantity ?? 0) - (a.currentPrice ?? a.currentStock ?? 0));
        const deltaB = Math.abs((b.recommendedPrice ?? b.recommendedQuantity ?? 0) - (b.currentPrice ?? b.currentStock ?? 0));
        return deltaB - deltaA;
      }
      return 0;
    });
  }, [pricingSuggestions, reorderSuggestions, typeFilter, activeTriggerFilter, searchQuery, sortBy]);

  // Keep selection synchronized
  useEffect(() => {
    if (unifiedList.length > 0) {
      if (!selectedId || !unifiedList.some((item) => item._id === selectedId)) {
        setSelectedId(unifiedList[0]._id);
      }
    } else {
      setSelectedId(null);
    }
  }, [unifiedList, selectedId]);

  // Currently selected item
  const selectedItem = useMemo(() => {
    return unifiedList.find((item) => item._id === selectedId) || null;
  }, [unifiedList, selectedId]);

  // Keyboard Navigation: J / K / A / R / / / ?
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if user is currently typing in an input
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        if (unifiedList.length === 0) return;
        const currIdx = unifiedList.findIndex((item) => item._id === selectedId);
        const nextIdx = currIdx < unifiedList.length - 1 ? currIdx + 1 : 0;
        setSelectedId(unifiedList[nextIdx]._id);
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        if (unifiedList.length === 0) return;
        const currIdx = unifiedList.findIndex((item) => item._id === selectedId);
        const prevIdx = currIdx > 0 ? currIdx - 1 : unifiedList.length - 1;
        setSelectedId(unifiedList[prevIdx]._id);
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        if (selectedItem && activeStatusTab === 'PENDING') {
          if (selectedItem._type === 'pricing') acceptPricing(selectedItem._id);
          else acceptReorder(selectedItem._id);
        }
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        if (selectedItem && activeStatusTab === 'PENDING') {
          if (selectedItem._type === 'pricing') rejectPricing(selectedItem._id);
          else rejectReorder(selectedItem._id);
        }
      } else if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === '?') {
        e.preventDefault();
        if (onOpenShortcuts) onOpenShortcuts();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [unifiedList, selectedId, selectedItem, activeStatusTab, acceptPricing, rejectPricing, acceptReorder, rejectReorder, onOpenShortcuts]);

  const statusTabs = [
    { id: 'PENDING', label: 'Pending', count: activeStatusTab === 'PENDING' ? unifiedList.length : undefined },
    { id: 'ACCEPTED', label: 'Accepted' },
    { id: 'REJECTED', label: 'Rejected' },
    { id: 'STALE', label: 'Stale' },
    { id: 'EXPIRED', label: 'Expired' },
  ];

  return (
    <div className="h-full flex flex-col md:flex-row gap-5 min-h-0">
      
      {/* LEFT COLUMN: Triage List Pane (Superhuman/Linear Style) */}
      <div className="w-full md:w-[420px] lg:w-[460px] flex flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden shrink-0">
        
        {/* Status Tabs Header */}
        <div className="flex items-center gap-1 p-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-x-auto">
          {statusTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveStatusTab(tab.id);
                setSelectedId(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all cursor-pointer whitespace-nowrap ${
                activeStatusTab === tab.id
                  ? 'bg-[var(--bg-surface)] text-[var(--accent-primary)] shadow-2xs'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <span>{tab.label}</span>
              {tab.id === 'PENDING' && (
                <span className="ml-1.5 px-1.5 py-0.2 rounded-full font-mono-numbers text-[10px] bg-amber-950 text-amber-300 border border-amber-800/40">
                  {pricingSuggestions.length + reorderSuggestions.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search, Type Filter & Sort Controls */}
        <div className="p-3 border-b border-[var(--border-subtle)] space-y-2 bg-[var(--bg-surface)]">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-2.5" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by SKU, product name, trigger... (press /)"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]"
            />
          </div>

          <div className="flex items-center justify-between text-xs gap-2 pt-1">
            {/* Type Selector (All, Pricing, Reorder) */}
            <div className="flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5">
              {['ALL', 'PRICING', 'REORDER'].map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-mono-numbers font-semibold cursor-pointer ${
                    typeFilter === t
                      ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-2xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Sort Selector */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg px-2 py-1 text-[11px] text-[var(--text-secondary)] font-mono-numbers focus:outline-none cursor-pointer"
            >
              <option value="NEWEST">Newest First</option>
              <option value="OLDEST">Oldest First</option>
              <option value="CONFIDENCE">Confidence</option>
              <option value="DELTA">Largest Delta</option>
            </select>
          </div>

          {/* Active Trigger Tag Notice */}
          {activeTriggerFilter && (
            <div className="flex items-center justify-between px-2.5 py-1 rounded-lg bg-cyan-950/40 border border-cyan-800/40 text-[11px] text-cyan-300">
              <span>Filtering by trigger: <strong>{activeTriggerFilter}</strong></span>
              <button
                onClick={onClearTriggerFilter}
                className="text-cyan-400 hover:underline cursor-pointer"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Scrollable Suggestion List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {loading ? (
            <div className="space-y-3">
              <SuggestionCardSkeleton />
              <SuggestionCardSkeleton />
              <SuggestionCardSkeleton />
            </div>
          ) : unifiedList.length === 0 ? (
            /* Calm Empty State */
            <div className="h-full flex flex-col items-center justify-center p-8 text-center text-[var(--text-muted)]">
              <div className="w-12 h-12 rounded-2xl bg-emerald-950/40 border border-emerald-800/40 text-emerald-400 flex items-center justify-center mb-3">
                <CheckCheck className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">All Caught Up</h3>
              <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-[220px] leading-relaxed">
                Zero proposals pending review. Autonomous triggers will populate proposals as inventory shifts.
              </p>
              <button
                onClick={() => refresh()}
                className="mt-4 px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-xs text-[var(--text-primary)] flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Check for Events</span>
              </button>
            </div>
          ) : (
            unifiedList.map((item) => (
              <SuggestionListItem
                key={item._id}
                suggestion={item}
                type={item._type}
                isSelected={item._id === selectedId}
                onSelect={() => setSelectedId(item._id)}
              />
            ))
          )}
        </div>

        {/* Triage Footer Hint */}
        <div className="px-3 py-2 bg-[var(--bg-elevated)] border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)] flex items-center justify-between font-mono-numbers">
          <span>{unifiedList.length} items</span>
          <span>J/K navigate • A accept • R reject</span>
        </div>
      </div>

      {/* RIGHT COLUMN: Selected Suggestion Detail Desk */}
      <div className="flex-1 min-w-0 h-full">
        <SuggestionDetailPane
          suggestion={selectedItem}
          type={selectedItem?._type || 'pricing'}
          onAccept={(id) => {
            if (selectedItem?._type === 'pricing') acceptPricing(id);
            else acceptReorder(id);
          }}
          onReject={(id) => {
            if (selectedItem?._type === 'pricing') rejectPricing(id);
            else rejectReorder(id);
          }}
          onRefresh={refresh}
          onOpenLiveStream={onOpenLiveStream}
          actionLoading={Boolean(selectedItem && actionInProgress[selectedItem._id])}
        />
      </div>

    </div>
  );
}
