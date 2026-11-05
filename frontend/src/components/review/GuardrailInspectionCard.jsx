import React from 'react';
import { ShieldCheck, AlertTriangle, ArrowRight, ShieldAlert } from 'lucide-react';

const FALLBACK_REASON_MAP = {
  RATE_LIMITED: {
    label: 'LLM Quota Reached (429)',
    description: 'Upstream provider request limit exceeded; safe rule engine fallback applied.',
    tone: 'amber',
  },
  CIRCUIT_OPEN: {
    label: 'LLM Paused After Repeated Failures',
    description: 'Circuit breaker is OPEN to avoid hammering upstream endpoint; fast-failed in 0.06ms.',
    tone: 'rose',
  },
  SCHEMA_INVALID: {
    label: 'Malformed Model Response',
    description: 'LLM returned missing required fields or invalid types; rejected by Stage 1 schema filter.',
    tone: 'amber',
  },
  IMPLAUSIBLE_OUTPUT: {
    label: 'Price Outside Commercial Bounds',
    description: 'Model output violated [0.5x, 3.0x] plausible window; rejected by Stage 2 safety check.',
    tone: 'rose',
  },
  MALFORMED_JSON: {
    label: 'Non-JSON Syntax Generated',
    description: 'Model output contained invalid JSON syntax; safely fallen back to rule logic.',
    tone: 'amber',
  },
  TIMEOUT: {
    label: 'Upstream Model Timed Out',
    description: 'Call exceeded 10,000ms AbortController boundary; fell back to rule logic.',
    tone: 'amber',
  },
  UPSTREAM_ERROR: {
    label: 'API Connection Error (5xx / Socket)',
    description: 'Upstream service unavailable or refused connection; preserved recommendation via rule.',
    tone: 'amber',
  },
};

export function GuardrailInspectionCard({ suggestion }) {
  if (!suggestion) return null;

  const isPricing = 'recommendedPrice' in suggestion;
  const wasClamped = Boolean(suggestion.wasClamped);
  const isFallback = Boolean(suggestion.isFallback);
  const fallbackReason = suggestion.fallbackReason;

  if (!wasClamped && !isFallback && suggestion.outcome === 'success') {
    return (
      <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/80 dark:border-emerald-500/20 dark:bg-emerald-950/20 text-xs flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-emerald-800 dark:text-emerald-300">Guardrails Cleared Cleanly</div>
          <div className="text-[11px] text-emerald-700 dark:text-emerald-400/80 mt-0.5">
            Passed Stage 1 Schema Validation, Stage 2 Commercial Plausibility, and Stage 3 Margin Policies.
          </div>
        </div>
      </div>
    );
  }

  const fallbackInfo = fallbackReason ? FALLBACK_REASON_MAP[fallbackReason] : null;

  return (
    <div className="space-y-3">
      {/* Policy Clamp Bar (Stage 3) */}
      {wasClamped && (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/80 dark:border-amber-500/30 dark:bg-amber-950/30 text-xs space-y-2.5">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-semibold">
            <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Stage 3 Policy Clamp Applied</span>
          </div>

          <p className="text-[11px] text-amber-800 dark:text-amber-200/90 leading-relaxed">
            {suggestion.clampReason ||
              'Original proposal was bounded to protect profit margin floors or restrict single-event volatility.'}
          </p>

          {/* Before vs After Clamp Comparison Bar */}
          {isPricing && (suggestion.rawPrice || suggestion.rawRecommendedPrice) && (
            <div className="p-2.5 rounded-lg bg-white dark:bg-black/40 border border-amber-200 dark:border-amber-500/20 grid grid-cols-2 gap-4 text-center font-mono-numbers">
              <div className="border-r border-amber-200 dark:border-amber-500/20 pr-2">
                <div className="text-[10px] text-amber-700 dark:text-amber-400/70 uppercase font-semibold">Raw Proposal</div>
                <div className="text-sm font-bold text-amber-800 dark:text-amber-300 line-through">
                  ${(suggestion.rawPrice ?? suggestion.rawRecommendedPrice)?.toFixed(2)}
                </div>
              </div>
              <div className="pl-2">
                <div className="text-[10px] text-emerald-700 dark:text-emerald-400/70 uppercase font-semibold">Clamped Safe Value</div>
                <div className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                  ${suggestion.recommendedPrice?.toFixed(2)}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upstream Fallback Notice (Stage 1 / Stage 2 / Network) */}
      {isFallback && (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/80 dark:border-amber-500/30 dark:bg-amber-950/20 text-xs space-y-2">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-semibold">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Deterministic Rule Fallback Engaged</span>
          </div>

          <div className="text-[11px] text-amber-800 dark:text-amber-200/90 leading-relaxed">
            <strong>{fallbackInfo?.label || fallbackReason || 'Upstream Error'}:</strong>{' '}
            {fallbackInfo?.description ||
              'Recommendation was synthesized via deterministic rule engine to ensure continuous commercial availability.'}
          </div>
        </div>
      )}
    </div>
  );
}
