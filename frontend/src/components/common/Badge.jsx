import React from 'react';

export function StatusBadge({ status }) {
  if (!status) return null;
  const s = String(status).toUpperCase();

  let styles = 'bg-zinc-800 text-zinc-300 border-zinc-700';
  let dotColor = 'bg-zinc-400';
  let label = s.replace(/_/g, ' ');

  switch (s) {
    case 'ACTIVE':
      styles = 'bg-emerald-950/40 text-emerald-300 border-emerald-800/40';
      dotColor = 'bg-emerald-400';
      break;
    case 'PRICE_REVIEW_PENDING':
    case 'PENDING':
      styles = 'bg-amber-950/40 text-amber-300 border-amber-800/40';
      dotColor = 'bg-amber-400';
      label = s === 'PRICE_REVIEW_PENDING' ? 'REVIEW PENDING' : 'PENDING';
      break;
    case 'OUT_OF_STOCK':
      styles = 'bg-rose-950/40 text-rose-300 border-rose-800/40';
      dotColor = 'bg-rose-400';
      break;
    case 'ACCEPTED':
      styles = 'bg-emerald-950/40 text-emerald-300 border-emerald-800/40';
      dotColor = 'bg-emerald-400';
      break;
    case 'REJECTED':
      styles = 'bg-zinc-900 text-zinc-400 border-zinc-800';
      dotColor = 'bg-zinc-500';
      break;
    case 'STALE':
      styles = 'bg-purple-950/40 text-purple-300 border-purple-800/40';
      dotColor = 'bg-purple-400';
      break;
    case 'EXPIRED':
      styles = 'bg-stone-900 text-stone-400 border-stone-800';
      dotColor = 'bg-stone-500';
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

  let styles = 'bg-zinc-800 text-zinc-300 border-zinc-700';
  let label = t.replace(/_/g, ' ');

  switch (t) {
    case 'INVENTORY_LOW':
      styles = 'bg-rose-950/50 text-rose-300 border-rose-800/50';
      label = 'LOW STOCK';
      break;
    case 'DEMAND_SPIKE':
      styles = 'bg-cyan-950/50 text-cyan-300 border-cyan-800/50';
      label = 'DEMAND SPIKE';
      break;
    case 'MANUAL':
      styles = 'bg-indigo-950/50 text-indigo-300 border-indigo-800/50';
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
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono-numbers font-semibold tracking-wide border bg-amber-950/50 text-amber-300 border-amber-800/50"
      >
        <span>⚠️</span> RULE FALLBACK
      </span>
    );
  }

  if (isAI) {
    return (
      <span
        title="Generated via Google Gemini 2.5 Flash advisor and validated through guardrails"
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono-numbers font-semibold tracking-wide border bg-cyan-950/40 text-cyan-300 border-cyan-800/40"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
        GEMINI ADVISOR
      </span>
    );
  }

  return (
    <span
      title="Deterministic inventory theory and threshold logic"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono-numbers font-semibold tracking-wide border bg-zinc-800 text-zinc-300 border-zinc-700"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
      RULE ENGINE
    </span>
  );
}

export function RoleBadge({ role }) {
  if (!role) return null;
  const r = String(role).toUpperCase();

  let styles = 'bg-zinc-800 text-zinc-300 border-zinc-700';

  switch (r) {
    case 'ADMIN':
      styles = 'bg-indigo-950/60 text-indigo-300 border-indigo-700/50';
      break;
    case 'MERCHANDISER':
      styles = 'bg-cyan-950/60 text-cyan-300 border-cyan-700/50';
      break;
    case 'VIEWER':
      styles = 'bg-zinc-800 text-zinc-400 border-zinc-700';
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
