import React from 'react';

export function StatusBadge({ status }) {
  if (!status) return null;
  const s = String(status).toUpperCase();

  let styles = 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700';
  let dotColor = 'bg-slate-400 dark:bg-zinc-400';
  let label = s.replace(/_/g, ' ');

  switch (s) {
    case 'ACTIVE':
      styles = 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40';
      dotColor = 'bg-emerald-500 dark:bg-emerald-400';
      break;
    case 'PRICE_REVIEW_PENDING':
    case 'PENDING':
      styles = 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/40';
      dotColor = 'bg-amber-500 dark:bg-amber-400';
      label = s === 'PRICE_REVIEW_PENDING' ? 'REVIEW PENDING' : 'PENDING';
      break;
    case 'OUT_OF_STOCK':
      styles = 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/40';
      dotColor = 'bg-rose-500 dark:bg-rose-400';
      break;
    case 'ACCEPTED':
      styles = 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40';
      dotColor = 'bg-emerald-500 dark:bg-emerald-400';
      break;
    case 'REJECTED':
      styles = 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-800';
      dotColor = 'bg-slate-400 dark:bg-zinc-500';
      break;
    case 'STALE':
      styles = 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800/40';
      dotColor = 'bg-purple-500 dark:bg-purple-400';
      break;
    case 'EXPIRED':
      styles = 'bg-stone-100 text-stone-700 border-stone-200 dark:bg-stone-900 dark:text-stone-400 dark:border-stone-800';
      dotColor = 'bg-stone-400 dark:bg-stone-500';
      break;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium tracking-wide uppercase border ${styles}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      {label}
    </span>
  );
}

export function TriggerBadge({ trigger }) {
  if (!trigger) return null;
  const t = String(trigger).toUpperCase();

  let styles = 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700';
  let label = t.replace(/_/g, ' ');

  switch (t) {
    case 'INVENTORY_LOW':
      styles = 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800/50';
      label = 'LOW STOCK';
      break;
    case 'DEMAND_SPIKE':
      styles = 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-cyan-950/50 dark:text-cyan-300 dark:border-cyan-800/50';
      label = 'DEMAND SPIKE';
      break;
    case 'MANUAL':
      styles = 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800/50';
      label = 'MANUAL TRIGGER';
      break;
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono-numbers font-semibold tracking-wider uppercase border ${styles}`}
    >
      {label}
    </span>
  );
}

export function SourceBadge({ isFallback, reasoning, wasClamped }) {
  // Determine if it was rule engine or Gemini advisor
  const isRulePattern =
    reasoning?.includes('Inventory is critically low') ||
    reasoning?.includes('Demand is significantly higher') ||
    reasoning?.includes('Standard rule-based replenishment') ||
    reasoning?.includes('No pricing rules fired');

  const isAI = !isFallback && !isRulePattern;

  if (isFallback) {
    return (
      <span
        title="Upstream LLM unavailable or timed out; safe rule engine fallback applied"
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono-numbers font-semibold tracking-wide border bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/50"
      >
        <span>⚠️</span> RULE FALLBACK
      </span>
    );
  }

  if (isAI) {
    return (
      <span
        title="Generated via Google Gemini 2.5 Flash advisor and validated through guardrails"
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono-numbers font-semibold tracking-wide border bg-sky-50 text-sky-800 border-sky-200 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-800/40"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-sky-500 dark:bg-cyan-400" />
        GEMINI ADVISOR
      </span>
    );
  }

  return (
    <span
      title="Deterministic inventory theory and threshold logic"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono-numbers font-semibold tracking-wide border bg-slate-100 text-slate-700 border-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-zinc-400" />
      RULE ENGINE
    </span>
  );
}

export function RoleBadge({ role }) {
  if (!role) return null;
  const r = String(role).toUpperCase();

  let styles = 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700';

  switch (r) {
    case 'ADMIN':
      styles = 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-700/50';
      break;
    case 'MERCHANDISER':
      styles = 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-700/50';
      break;
    case 'VIEWER':
      styles = 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700';
      break;
  }

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono-numbers font-semibold tracking-wider uppercase border ${styles}`}
    >
      {r}
    </span>
  );
}
