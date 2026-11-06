import React, { useState } from 'react';
import {
  Activity,
  ShieldAlert,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { useAdvisorHealth, useStrategyConfig } from '../../api/hooks';
import { useAuth } from '../../context/AuthContext';
import { Modal } from '../common/Modal';

export function AdvisorHealthPanel() {
  const { health, refresh, breakerState } = useAdvisorHealth();
  const { config, updateStrategy } = useStrategyConfig();
  const { isAdmin, openAuthModal } = useAuth();

  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [targetStrategy, setTargetStrategy] = useState('rule-based');
  const [switching, setSwitching] = useState(false);

  const circuitBreaker = health?.circuitBreaker || {};
  const concurrency = health?.concurrencyLimiter || {};
  const retries = health?.retryStats || {};
  const fallbacks = health?.fallbackCountsByReason || {};

  const handleOpenSwitch = (nextStrategy) => {
    if (!isAdmin) {
      openAuthModal();
      return;
    }
    setTargetStrategy(nextStrategy);
    setIsConfirmModalOpen(true);
  };

  const handleConfirmSwitch = async () => {
    setSwitching(true);
    await updateStrategy({ strategy: targetStrategy });
    setSwitching(false);
    setIsConfirmModalOpen(false);
    refresh();
  };

  const totalFallbacks = Object.values(fallbacks).reduce((a, b) => a + b, 0);

  return (
    <div className="h-full flex flex-col p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-y-auto space-y-6">
      
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[var(--border-subtle)]">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-[var(--accent-primary)]" />
            <h1 className="text-lg font-bold text-[var(--text-primary)]">
              Advisor Telemetry & Upstream Resilience
            </h1>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Real-time circuit breaker states, semaphore queuing, retry exhaustion, and fallback reason accounting.
          </p>
        </div>

        <button
          onClick={() => refresh()}
          className="px-3 py-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-xs text-[var(--text-primary)] font-medium flex items-center gap-1.5 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
          <span>Refresh Telemetry</span>
        </button>
      </div>

      {/* 1. Circuit Breaker Three-State Diagram */}
      <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Upstream Circuit Breaker State Machine
          </span>
          <span className="text-xs font-mono-numbers px-2.5 py-0.5 rounded-full font-bold bg-slate-100 dark:bg-black/40 border border-[var(--border-subtle)]">
            State: <strong className={breakerState === 'CLOSED' ? 'text-emerald-700 dark:text-emerald-400' : breakerState === 'HALF_OPEN' ? 'text-amber-700 dark:text-amber-400' : 'text-rose-700 dark:text-rose-400'}>{breakerState}</strong>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* CLOSED Node */}
          <div
            className={`p-4 rounded-xl border transition-all ${
              breakerState === 'CLOSED'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500/20 dark:border-emerald-500/50 dark:bg-emerald-950/30 dark:text-emerald-300'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] opacity-50 text-[var(--text-muted)]'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs font-mono-numbers">CLOSED</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-[11px] mt-2 leading-relaxed">
              Normal operating state. All candidate proposals query the LLM gateway.
            </p>
          </div>

          {/* HALF_OPEN Node */}
          <div
            className={`p-4 rounded-xl border transition-all ${
              breakerState === 'HALF_OPEN'
                ? 'border-amber-300 bg-amber-50 text-amber-900 ring-2 ring-amber-500/20 dark:border-amber-500/50 dark:bg-amber-950/30 dark:text-amber-300'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] opacity-50 text-[var(--text-muted)]'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs font-mono-numbers">HALF_OPEN</span>
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <p className="text-[11px] mt-2 leading-relaxed">
              Cooldown window elapsed (10s). Admits single trial probe to test API recovery.
            </p>
          </div>

          {/* OPEN Node */}
          <div
            className={`p-4 rounded-xl border transition-all ${
              breakerState === 'OPEN'
                ? 'border-rose-300 bg-rose-50 text-rose-900 ring-2 ring-rose-500/20 dark:border-rose-500/50 dark:bg-rose-950/30 dark:text-rose-300'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] opacity-50 text-[var(--text-muted)]'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs font-mono-numbers">OPEN (TRIPPED)</span>
              <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400" />
            </div>
            <p className="text-[11px] mt-2 leading-relaxed">
              Fast-fails upstream calls in 0.06ms to protect quota; 100% routed to rule engine.
            </p>
          </div>
        </div>

        {/* Breaker internals */}
        <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between text-xs font-mono-numbers text-[var(--text-muted)] gap-2">
          <span>Consecutive Failures: <strong>{circuitBreaker.consecutiveFailures ?? 0} / {circuitBreaker.failureThreshold ?? 5}</strong></span>
          <span>Cooldown: <strong>{(circuitBreaker.cooldownMs ?? 10000) / 1000}s</strong></span>
          <span>Last Failure: <strong>{circuitBreaker.lastFailureTime ? new Date(circuitBreaker.lastFailureTime).toLocaleTimeString() : 'None'}</strong></span>
        </div>
      </div>

      {/* 2. Resilience Gauges: Concurrency Semaphore & Retry Counters */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        
        {/* Concurrency Limiter (Semaphore) */}
        <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Semaphore Concurrency Limiter
            </span>
            <span className="text-xs font-mono-numbers text-[var(--accent-primary)] font-bold">
              {concurrency.activeCount ?? 0} / {concurrency.maxConcurrency ?? 5} in-flight
            </span>
          </div>

          <div className="w-full h-2 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] overflow-hidden">
            <div
              className="h-full bg-[var(--accent-primary)] transition-all duration-300"
              style={{
                width: `${Math.min(
                  100,
                  ((concurrency.activeCount ?? 0) / Math.max(1, concurrency.maxConcurrency ?? 5)) * 100
                )}%`,
              }}
            />
          </div>

          <div className="flex justify-between text-xs font-mono-numbers text-[var(--text-muted)] pt-1">
            <span>Queued Requests: <strong>{concurrency.queueLength ?? 0}</strong></span>
            <span>Max Concurrency: <strong>{concurrency.maxConcurrency ?? 5}</strong></span>
          </div>
        </div>

        {/* Exponential Backoff & Retry Stats */}
        <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Retry Handler Statistics
            </span>
            <span className="text-xs font-mono-numbers text-[var(--text-muted)]">
              Max Retries: 3 with full jitter
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center font-mono-numbers">
            <div className="p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <span className="text-[10px] text-[var(--text-muted)] block">Total Calls</span>
              <span className="text-sm font-bold text-[var(--text-primary)]">{retries.totalCalls ?? 0}</span>
            </div>
            <div className="p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <span className="text-[10px] text-[var(--text-muted)] block">Retried</span>
              <span className="text-sm font-bold text-amber-700 dark:text-amber-400">{retries.totalRetries ?? 0}</span>
            </div>
            <div className="p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <span className="text-[10px] text-[var(--text-muted)] block">Recovered</span>
              <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{retries.successfulRetries ?? 0}</span>
            </div>
            <div className="p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <span className="text-[10px] text-[var(--text-muted)] block">Exhausted</span>
              <span className="text-sm font-bold text-rose-700 dark:text-rose-400">{retries.exhaustedRetries ?? 0}</span>
            </div>
          </div>
        </div>

      </div>

      {/* 3. Fallback Counts by Reason (Audited AdvisorLogs) */}
      <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Audited Fallback Reason Accounting (Total: {totalFallbacks})
          </span>
          <span className="text-[11px] font-mono-numbers text-[var(--text-muted)]">
            Source: AdvisorLog Collection
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono-numbers text-xs">
          {Object.entries(fallbacks).map(([reason, count]) => (
            <div
              key={reason}
              className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-between"
            >
              <div className="truncate pr-1">
                <span className="text-[10px] text-[var(--text-muted)] block truncate">{reason}</span>
                <span className="font-bold text-[var(--text-primary)]">{count}</span>
              </div>
              <span
                className={`w-2 h-2 rounded-full ${
                  count > 0 ? (reason === 'CIRCUIT_OPEN' ? 'bg-rose-400' : 'bg-amber-400') : 'bg-zinc-700'
                }`}
              />
            </div>
          ))}
        </div>
      </div>

      {/* 4. Strategy Engine Switcher (ADMIN ONLY) */}
      <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] block">
              Autonomous Recommendation Engine
            </span>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Current active strategy: <strong className="text-[var(--text-primary)]">{config?.activeStrategy === 'ai' ? 'Google Gemini 2.5 Flash Advisor' : 'Textbook Rule-Based Engine'}</strong>
            </p>
          </div>

          {!isAdmin && (
            <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] bg-[var(--bg-surface)] px-2.5 py-1 rounded-lg border border-[var(--border-subtle)]">
              <Lock className="w-3.5 h-3.5" />
              <span>Admin Role Required</span>
            </span>
          )}
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={() => handleOpenSwitch('rule-based')}
            disabled={config?.activeStrategy === 'rule-based'}
            className={`flex-1 py-3 px-4 rounded-xl border font-semibold text-xs tracking-wide transition-all cursor-pointer ${
              config?.activeStrategy === 'rule-based'
                ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 text-[var(--text-primary)] cursor-default'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]'
            }`}
          >
            <span>Switch to Rule-Based Engine</span>
          </button>

          <button
            onClick={() => handleOpenSwitch('ai')}
            disabled={config?.activeStrategy === 'ai'}
            className={`flex-1 py-3 px-4 rounded-xl border font-semibold text-xs tracking-wide transition-all cursor-pointer ${
              config?.activeStrategy === 'ai'
                ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 text-[var(--text-primary)] cursor-default'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]'
            }`}
          >
            <span>Switch to Gemini AI Advisor</span>
          </button>
        </div>
      </div>

      {/* Confirmation Modal for Strategy Switch */}
      <Modal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        title="Confirm Engine Strategy Switch"
      >
        <div className="space-y-3 text-xs text-[var(--text-primary)]">
          <p className="leading-relaxed">
            Are you sure you want to transition the primary recommendation engine to{' '}
            <strong className="text-[var(--accent-primary)] font-bold">
              {targetStrategy === 'ai' ? 'Google Gemini 2.5 Flash' : 'Rule-Based Engine'}
            </strong>?
          </p>
          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
            All subsequent catalogue stock and demand spike triggers will evaluate through the chosen advisor. All guardrails remain strictly enforced.
          </p>

          <div className="pt-3 flex gap-2 justify-end">
            <button
              onClick={() => setIsConfirmModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] text-xs cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmSwitch}
              disabled={switching}
              className="px-4 py-2 rounded-lg bg-[var(--accent-primary)] hover:opacity-90 text-black font-semibold text-xs cursor-pointer disabled:opacity-50"
            >
              {switching ? 'Applying...' : 'Confirm Switch'}
            </button>
          </div>
        </div>
      </Modal>

    </div>
  );
}

