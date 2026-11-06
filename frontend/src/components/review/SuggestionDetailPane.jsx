import React, { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  TrendingUp,
  TrendingDown,
  Clock,
  Radio,
  RefreshCw,
  AlertTriangle,
  FileText,
  Boxes,
  Percent,
  Layers,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { SourceBadge, TriggerBadge, StatusBadge } from '../common/Badge';
import { GuardrailInspectionCard } from './GuardrailInspectionCard';
import { useAuth } from '../../context/AuthContext';

export function SuggestionDetailPane({
  suggestion,
  type = 'pricing',
  onAccept,
  onReject,
  onRefresh,
  onOpenLiveStream,
  actionLoading = false,
}) {
  const { canReview, openAuthModal, role } = useAuth();
  const [showConfirmAccept, setShowConfirmAccept] = useState(false);

  if (!suggestion) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center text-[var(--text-muted)] border border-dashed border-[var(--border-subtle)] rounded-2xl bg-[var(--bg-surface)]">
        <Layers className="w-8 h-8 mb-2 opacity-50" />
        <p className="text-sm font-medium">Select a proposal from the triage list</p>
        <p className="text-xs mt-1">Use J and K keys to navigate proposals</p>
      </div>
    );
  }

  const isPricing = type === 'pricing';
  const product = suggestion.productId || {};

  // Price / Quantity computations
  const currentVal = isPricing ? suggestion.currentPrice : suggestion.currentStock;
  const proposedVal = isPricing ? suggestion.recommendedPrice : suggestion.recommendedQuantity;

  let deltaPct = 0;
  let isPositive = false;
  if (isPricing && currentVal > 0) {
    const diff = proposedVal - currentVal;
    deltaPct = (diff / currentVal) * 100;
    isPositive = diff > 0;
  }

  // Margin calculation
  const currentMargin =
    product.costPrice && product.currentPrice
      ? (((product.currentPrice - product.costPrice) / product.currentPrice) * 100).toFixed(1)
      : null;

  const proposedMargin =
    product.costPrice && isPricing && proposedVal
      ? (((proposedVal - product.costPrice) / proposedVal) * 100).toFixed(1)
      : null;

  // TTL calculation
  const expiresAt = suggestion.expiresAt ? new Date(suggestion.expiresAt) : null;
  const isExpired = expiresAt && expiresAt <= new Date();
  const isStale = suggestion.status === 'STALE';
  const isPending = suggestion.status === 'PENDING';

  const formatTtl = (targetDate) => {
    if (!targetDate) return 'No TTL';
    const diff = targetDate.getTime() - Date.now();
    if (diff <= 0) return 'Expired';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${mins}m remaining`;
  };

  return (
    <div className="h-full flex flex-col justify-between p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-y-auto space-y-6">
      
      {/* 1. Header: SKU, Title, Badges & Streaming Trigger */}
      <div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono-numbers px-2 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] font-bold text-[var(--accent-primary)]">
                {product.sku || 'SKU-UNKNOWN'}
              </span>
              <TriggerBadge trigger={suggestion.triggerReason} />
              <StatusBadge status={suggestion.status} />
            </div>
            <h1 className="text-lg font-bold text-[var(--text-primary)] mt-2 leading-snug">
              {product.name || 'Catalog Item'}
            </h1>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Category: <span className="font-semibold text-[var(--text-primary)]">{product.category || 'GENERAL'}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            {onOpenLiveStream && (
              <button
                onClick={() => onOpenLiveStream(product)}
                className="px-2.5 py-1.5 rounded-lg border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-800 dark:border-cyan-800/40 dark:bg-cyan-950/40 dark:hover:bg-cyan-900/50 dark:text-cyan-300 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Inspect real-time LLM reasoning tokens via Server-Sent Events"
              >
                <Radio className="w-3.5 h-3.5 text-sky-600 dark:text-cyan-400 animate-pulse" />
                <span>Live Stream</span>
              </button>
            )}
          </div>
        </div>

        {/* 2. Hero Decision Card: Before -> Proposed */}
        <div className="mt-5 p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] relative overflow-hidden">
          <div className="text-[10px] font-mono-numbers font-semibold tracking-wider uppercase text-[var(--text-muted)] mb-3 flex items-center justify-between">
            <span>Proposed Commercial Action</span>
            <span className="flex items-center gap-1 text-[var(--text-secondary)]">
              <Clock className="w-3 h-3" />
              <span>TTL: {formatTtl(expiresAt)}</span>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
            {/* Current Value */}
            <div className="sm:col-span-5">
              <div className="text-xs text-[var(--text-muted)] font-medium">
                {isPricing ? 'Current Retail Price' : 'Current On-Hand Stock'}
              </div>
              <div className="text-2xl font-bold font-mono-numbers text-[var(--text-secondary)] mt-1">
                {isPricing ? `$${currentVal?.toFixed(2)}` : `${currentVal} units`}
              </div>
              {isPricing && currentMargin && (
                <div className="text-[11px] text-[var(--text-muted)] font-mono-numbers mt-0.5">
                  Margin: {currentMargin}% GM
                </div>
              )}
            </div>

            {/* Transition Arrow / Delta */}
            <div className="sm:col-span-2 flex flex-col items-center justify-center">
              <ArrowRight className="w-5 h-5 text-[var(--accent-primary)] hidden sm:block" />
              {isPricing && (
                <span
                  className={`mt-1 text-xs font-mono-numbers font-bold px-2 py-0.5 rounded-full border ${
                    Math.abs(deltaPct) < 0.001
                      ? 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700'
                      : isPositive
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800/40'
                      : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-400 dark:border-rose-800/40'
                  }`}
                >
                  {isPositive ? '+' : ''}{deltaPct.toFixed(1)}%
                </span>
              )}
            </div>

            {/* Proposed Value */}
            <div className="sm:col-span-5 sm:text-right">
              <div className="text-xs text-[var(--accent-primary)] font-semibold">
                {isPricing ? 'Advisor Proposed Price' : 'Recommended Reorder Sizing'}
              </div>
              <div className="text-2xl font-black font-mono-numbers text-[var(--text-primary)] mt-1">
                {isPricing ? `$${proposedVal?.toFixed(2)}` : `+${proposedVal} units`}
              </div>
              {isPricing && proposedMargin && (
                <div className="text-[11px] font-mono-numbers text-emerald-700 dark:text-emerald-400 font-semibold mt-0.5">
                  Projected Margin: {proposedMargin}% GM
                </div>
              )}
              {!isPricing && suggestion.suggestedLeadTimeDays && (
                <div className="text-[11px] font-mono-numbers text-[var(--text-muted)] mt-0.5">
                  Lead Time: {suggestion.suggestedLeadTimeDays} days
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 3. What the Guardrails Did (Stage 1 / 2 / 3 Verification) */}
        <div className="mt-5">
          <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2 flex items-center justify-between">
            <span>Guardrail Pipeline Audit</span>
            <SourceBadge
              isFallback={suggestion.isFallback}
              reasoning={suggestion.reasoning}
              wasClamped={suggestion.wasClamped}
            />
          </div>
          <GuardrailInspectionCard suggestion={suggestion} />
        </div>

        {/* 4. Economic Reasoning & Recommendation Rationale */}
        <div className="mt-5 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
              Advisor Economic Rationale
            </span>
            <div className="flex items-center gap-1.5 font-mono-numbers text-xs">
              <span className="text-[var(--text-muted)]">Confidence:</span>
              <span className="font-bold text-[var(--text-primary)]">
                {((suggestion.confidence ?? 0.8) * 100).toFixed(0)}%
              </span>
            </div>
          </div>

          <p className="text-xs text-[var(--text-primary)] leading-relaxed font-sans whitespace-pre-line">
            {suggestion.reasoning ? suggestion.reasoning.replace(/\[AI Analysis\] /g, '') : 'No rationale provided.'}
          </p>
        </div>

        {/* 5. Product Context Telemetry Card */}
        <div className="mt-5 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
          <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider block mb-3">
            Product Telemetry Context
          </span>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono-numbers">
            <div className="p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <span className="text-[10px] text-[var(--text-muted)] block">On-Hand Stock</span>
              <span className="text-sm font-bold text-[var(--text-primary)]">{product.stockLevel ?? currentVal}</span>
            </div>

            <div className="p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <span className="text-[10px] text-[var(--text-muted)] block">Reorder Threshold</span>
              <span className="text-sm font-bold text-[var(--text-primary)]">{product.reorderThreshold ?? '-'}</span>
            </div>

            <div className="p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <span className="text-[10px] text-[var(--text-muted)] block">Demand Velocity</span>
              <span className="text-sm font-bold text-[var(--text-primary)]">{product.demandVelocity ?? 0}/day</span>
            </div>

            <div className="p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <span className="text-[10px] text-[var(--text-muted)] block">Unit Cost Price</span>
              <span className="text-sm font-bold text-[var(--text-primary)]">${product.costPrice?.toFixed(2) ?? '-'}</span>
            </div>
          </div>
        </div>

        {/* 6. Inline Conflict Notice (409 Staleness / 410 Expired) */}
        {(isStale || isExpired) && (
          <div className="mt-5 p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-950/30 dark:text-rose-200 text-xs space-y-2">
            <div className="flex items-center gap-2 font-semibold text-rose-800 dark:text-rose-300">
              <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              <span>{isStale ? 'Proposal is STALE (409 Conflict)' : 'Proposal has EXPIRED (410 Gone)'}</span>
            </div>
            <p className="text-[11px] text-rose-800 dark:text-rose-200/90 leading-relaxed">
              {isStale
                ? 'Product price or stock drifted in the catalog after this recommendation was generated. The proposal cannot be applied in its current state.'
                : 'This proposal exceeded its 24-hour time-to-live horizon and has been archived.'}
            </p>
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="mt-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white dark:bg-rose-900/60 dark:hover:bg-rose-900 dark:border-rose-700/50 font-medium text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh Queue</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* 7. Action Footer: Accept & Reject Buttons */}
      <div className="pt-4 border-t border-[var(--border-subtle)]">
        {isPending ? (
          <div>
            {!showConfirmAccept ? (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => {
                    if (!canReview) {
                      openAuthModal();
                    } else {
                      setShowConfirmAccept(true);
                    }
                  }}
                  className={`flex-1 py-3 px-4 rounded-xl text-xs font-bold tracking-wide transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ${
                    canReview
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-black shadow-emerald-500/10'
                      : 'border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--text-primary)]'
                  }`}
                  title={!canReview ? 'Click to sign in as Merchandiser or Admin' : 'Accept and apply proposal (A)'}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{canReview ? 'Accept Proposal' : 'Sign in to Accept'}</span>
                  {canReview && (
                    <kbd className="hidden sm:inline px-1.5 py-0.5 rounded text-[10px] bg-white/20 dark:bg-black/20 font-mono-numbers">
                      A
                    </kbd>
                  )}
                </button>

                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => {
                    if (!canReview) openAuthModal();
                    else onReject(suggestion._id);
                  }}
                  className="py-3 px-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-rose-600 dark:hover:text-rose-400 text-xs font-semibold tracking-wide transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  title={!canReview ? 'Click to sign in as Merchandiser or Admin' : 'Dismiss proposal (R)'}
                >
                  <XCircle className="w-4 h-4" />
                  <span>Reject</span>
                  {canReview && (
                    <kbd className="hidden sm:inline px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-surface)] text-[var(--text-muted)] font-mono-numbers border border-[var(--border-subtle)]">
                      R
                    </kbd>
                  )}
                </button>
              </div>
            ) : (
              /* Confirmation Prompt */
              <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300 animate-slide-up space-y-2.5">
                <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                  Confirm catalog update for {product.name}?
                </div>
                <p className="text-[11px] text-emerald-800 dark:text-emerald-200/90 leading-relaxed font-sans">
                  {isPricing
                    ? `Mutating retail price from $${currentVal?.toFixed(2)} to $${proposedVal?.toFixed(2)}. Stamped with acting role '${role}'.`
                    : `Issuing replenishment order for +${proposedVal} units. Stamped with acting role '${role}'.`}
                </p>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => {
                      onAccept(suggestion._id);
                      setShowConfirmAccept(false);
                    }}
                    disabled={actionLoading}
                    className="flex-1 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-black font-bold text-xs cursor-pointer disabled:opacity-50"
                  >
                    {actionLoading ? 'Applying...' : 'Yes, Confirm & Apply'}
                  </button>
                  <button
                    onClick={() => setShowConfirmAccept(false)}
                    className="py-2 px-3 rounded-lg border border-emerald-300 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-900/40 text-xs font-medium cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {!canReview && (
              <div className="mt-2 text-center text-[11px] text-[var(--text-muted)]">
                Logged in as <strong>{role || 'Guest'}</strong> (Read-only). Sign in as{' '}
                <button
                  onClick={openAuthModal}
                  className="text-[var(--accent-primary)] underline cursor-pointer"
                >
                  Merchandiser
                </button>{' '}
                to approve changes.
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-[var(--text-muted)] text-center py-2">
            This proposal has been marked <strong>{suggestion.status}</strong>.
            {suggestion.actedBy && (
              <span className="block text-[10px] font-mono-numbers mt-0.5">
                Acted by: {suggestion.actedBy}
              </span>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
