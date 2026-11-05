import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ShieldCheck, ArrowRight, Lock, KeyRound, CheckCircle2, User, Sparkles } from 'lucide-react';

export function LoginModal() {
  const {
    isAuthModalOpen,
    closeAuthModal,
    login,
    authLoading,
    authError,
    setAuthError,
    SEEDED_ACCOUNTS,
  } = useAuth();

  const [username, setUsername] = useState('merchandiser');
  const [password, setPassword] = useState('merchpassword123');

  if (!isAuthModalOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await login(username, password);
    } catch {
      // Auth error is stored in context
    }
  };

  const selectPreset = (preset) => {
    setUsername(preset.username);
    setPassword(preset.password);
    setAuthError(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-4xl rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xl overflow-hidden grid grid-cols-1 md:grid-cols-12 animate-slide-up">
        
        {/* Left Side: Product Mission & How-It-Works Diagram */}
        <div className="md:col-span-5 bg-[var(--bg-elevated)] p-6 md:p-8 flex flex-col justify-between border-b md:border-b-0 md:border-r border-[var(--border-subtle)]">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/30 flex items-center justify-center text-[var(--accent-primary)]">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <span className="text-lg font-bold tracking-tight text-[var(--text-primary)]">
                Sentinel
              </span>
            </div>

            <div className="mt-5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] leading-snug">
                "AI should be fast to propose, but slow to trust."
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-2 leading-relaxed">
                Sentinel treats model intelligence as advisory proposals. No automated action touches production pricing or inventory without human approval and multi-stage safety boundaries.
              </p>
            </div>

            {/* Architecture Flow Diagram */}
            <div className="mt-6 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-2.5">
              <div className="text-[10px] font-mono-numbers font-semibold text-[var(--text-muted)] tracking-wider uppercase">
                System Workflow
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                  <span className="w-5 h-5 rounded bg-zinc-800 text-[10px] font-mono-numbers flex items-center justify-center shrink-0">1</span>
                  <span>Inventory / Demand Event</span>
                </div>
                <div className="ml-2.5 border-l border-zinc-700 h-2" />
                <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                  <span className="w-5 h-5 rounded bg-cyan-950 text-cyan-400 text-[10px] font-mono-numbers flex items-center justify-center shrink-0">2</span>
                  <span>Advisor Proposal (Rule or LLM)</span>
                </div>
                <div className="ml-2.5 border-l border-zinc-700 h-2" />
                <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                  <span className="w-5 h-5 rounded bg-amber-950 text-amber-400 text-[10px] font-mono-numbers flex items-center justify-center shrink-0">3</span>
                  <span>3 Guardrails (Schema, Bounds, Policy)</span>
                </div>
                <div className="ml-2.5 border-l border-zinc-700 h-2" />
                <div className="flex items-center gap-2 font-medium text-emerald-400">
                  <span className="w-5 h-5 rounded bg-emerald-950 text-emerald-400 text-[10px] font-mono-numbers flex items-center justify-center shrink-0">4</span>
                  <span>Merchandiser HITL Approval Queue</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)] flex items-center justify-between">
            <span>JWT Auth with 1h Expiry</span>
            <span className="font-mono-numbers">Node 20 / Express 5</span>
          </div>
        </div>

        {/* Right Side: Login Form & Seeded Presets */}
        <div className="md:col-span-7 p-6 md:p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  Sign in to Decision Desk
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Role-based access control enforces proposal review and strategy changes.
                </p>
              </div>
              <button
                onClick={closeAuthModal}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 py-1 rounded cursor-pointer"
              >
                Close
              </button>
            </div>

            {/* Quick Demo Account Buttons */}
            <div className="mt-5">
              <label className="text-[11px] font-medium text-[var(--text-muted)] tracking-wider uppercase block mb-2">
                One-Click Seeded Accounts
              </label>
              <div className="grid grid-cols-3 gap-2">
                {SEEDED_ACCOUNTS.map((acc) => {
                  const isSelected = username === acc.username;
                  return (
                    <button
                      key={acc.role}
                      type="button"
                      onClick={() => selectPreset(acc)}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        isSelected
                          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 text-[var(--text-primary)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--border-active)] text-[var(--text-secondary)]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">{acc.label}</span>
                        {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-[var(--accent-primary)]" />}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] mt-1 truncate">
                        {acc.badge}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Error Banner */}
            {authError && (
              <div className="mt-4 p-3 rounded-lg border border-rose-500/30 bg-rose-950/40 text-rose-300 text-xs flex items-center gap-2">
                <span className="shrink-0 font-bold">⚠️</span>
                <span>{authError}</span>
              </div>
            )}

            {/* Credentials Form */}
            <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="text-xs font-medium text-[var(--text-secondary)] block mb-1">
                  Username
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)] font-mono-numbers"
                    placeholder="merchandiser"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-[var(--text-secondary)] block mb-1">
                  Password
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-2.5" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)] font-mono-numbers"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-2.5 px-4 rounded-xl bg-[var(--accent-primary)] hover:opacity-95 text-black font-semibold text-xs tracking-wide transition-all shadow-lg shadow-cyan-500/10 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {authLoading ? (
                    'Verifying credentials...'
                  ) : (
                    <>
                      <span>Sign in as {username}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          <div className="mt-4 text-[11px] text-[var(--text-muted)] text-center">
            Role lookup is resolved server-side from bcrypt-hashed credentials.
          </div>
        </div>

      </div>
    </div>
  );
}
