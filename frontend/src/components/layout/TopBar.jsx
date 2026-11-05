import React from 'react';
import {
  Search,
  Sun,
  Moon,
  Cpu,
  Zap,
  HelpCircle,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { AlertsPopover } from '../alerts/AlertsPopover';
import { RoleBadge } from '../common/Badge';

export function TopBar({
  onOpenCommandPalette,
  onOpenShortcuts,
  onOpenStrategyModal,
  strategy = 'rule-based',
  breakerState = 'CLOSED',
  pricingSuggestions = [],
  reorderSuggestions = [],
  onSelectTrigger,
}) {
  const { user, isLoggedIn, openAuthModal, isAdmin } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const isBreakerOpen = breakerState === 'OPEN';
  const isRateLimited = breakerState === 'HALF_OPEN' || isBreakerOpen;

  return (
    <header className="h-16 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 md:px-6 flex items-center justify-between gap-4 z-20 shrink-0">
      
      {/* Left Area: Search trigger & Engine Indicator */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onOpenCommandPalette}
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-xs text-[var(--text-secondary)] transition-all cursor-pointer shadow-2xs group"
          aria-label="Open command palette"
        >
          <Search className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--text-primary)]" />
          <span className="hidden sm:inline">Search proposals, catalog, actions...</span>
          <span className="inline sm:hidden">Search...</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono-numbers bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border-subtle)]">
            ⌘K
          </kbd>
        </button>

        {/* Engine Mode Pill */}
        <div
          onClick={isAdmin ? onOpenStrategyModal : undefined}
          className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono-numbers transition-all ${
            strategy === 'ai'
              ? 'border-sky-200 bg-sky-50 text-sky-800 dark:border-cyan-800/40 dark:bg-cyan-950/40 dark:text-cyan-300'
              : 'border-slate-200 bg-slate-100 text-slate-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300'
          } ${isAdmin ? 'cursor-pointer hover:border-[var(--accent-primary)]' : 'cursor-default'}`}
          title={isAdmin ? 'Click to change advisor engine (Admin)' : 'Active recommendation engine'}
        >
          <Cpu className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
          <span className="font-semibold">
            {strategy === 'ai' ? 'GEMINI ADVISOR' : 'RULE-BASED'}
          </span>
          {isAdmin && (
            <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
              (CONFIG)
            </span>
          )}
        </div>
      </div>

      {/* Middle Area: Persistent Breaker / Quota Banner if OPEN or HALF_OPEN */}
      {isRateLimited && (
        <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-600/40 dark:bg-amber-950/50 dark:text-amber-200 text-xs animate-pulse font-medium">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>
            Running on rule engine (LLM quota reached / circuit breaker {breakerState})
          </span>
        </div>
      )}

      {/* Right Area: Alerts, Theme, Shortcuts, User Profile */}
      <div className="flex items-center gap-2">
        {/* Trigger Alerts Popover */}
        <AlertsPopover
          pricingSuggestions={pricingSuggestions}
          reorderSuggestions={reorderSuggestions}
          onSelectTrigger={onSelectTrigger}
        />

        {/* Keyboard Shortcuts Helper (?) */}
        <button
          onClick={onOpenShortcuts}
          className="p-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          title="Keyboard shortcuts (?)"
          aria-label="View keyboard shortcuts"
        >
          <HelpCircle className="w-4 h-4" />
        </button>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-400" />}
        </button>

        {/* Auth / Profile Pill */}
        {isLoggedIn ? (
          <div
            onClick={openAuthModal}
            className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
            title="Click to switch account"
          >
            <div className="w-6 h-6 rounded-md bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] flex items-center justify-center font-bold text-xs font-mono-numbers">
              {user?.name ? user.name[0].toUpperCase() : 'U'}
            </div>
            <div className="hidden sm:block text-left leading-tight">
              <div className="text-xs font-semibold text-[var(--text-primary)] truncate max-w-[100px]">
                {user?.name || user?.username}
              </div>
            </div>
            <RoleBadge role={user?.role} />
          </div>
        ) : (
          <button
            onClick={openAuthModal}
            className="py-1.5 px-3 rounded-xl bg-[var(--accent-primary)] hover:opacity-90 text-black font-semibold text-xs tracking-wide transition-all cursor-pointer shadow-xs"
          >
            Sign In
          </button>
        )}
      </div>

    </header>
  );
}

