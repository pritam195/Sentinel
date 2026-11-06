import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Inbox,
  LayoutGrid,
  Activity,
  Cpu,
  Moon,
  Sun,
  UserCheck,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

export function CommandPalette({
  isOpen,
  onClose,
  setActiveTab,
  products = [],
  onSelectProduct,
  onSwitchStrategy,
  strategy = 'rule-based',
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const { quickLogin } = useAuth();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Construct command list
  const baseActions = [
    {
      id: 'nav-review',
      title: 'Go to Review Inbox (Linear Triage)',
      subtitle: 'Review pending price & replenishment proposals',
      category: 'Navigation',
      icon: <Inbox className="w-4 h-4 text-cyan-400" />,
      perform: () => setActiveTab('review'),
    },
    {
      id: 'nav-catalog',
      title: 'Go to Catalog Desk',
      subtitle: 'Dense product inventory & simulation actions',
      category: 'Navigation',
      icon: <LayoutGrid className="w-4 h-4 text-emerald-400" />,
      perform: () => setActiveTab('catalog'),
    },
    {
      id: 'nav-health',
      title: 'Go to Advisor Health',
      subtitle: 'Inspect circuit breaker, rate limit & resilience telemetry',
      category: 'Navigation',
      icon: <Activity className="w-4 h-4 text-amber-400" />,
      perform: () => setActiveTab('health'),
    },
    {
      id: 'action-switch-engine',
      title: `Switch Engine to ${strategy === 'ai' ? 'Rule-Based' : 'AI Advisor'}`,
      subtitle: 'Toggle active recommendation strategy (Admin only)',
      category: 'System Control',
      icon: <Cpu className="w-4 h-4 text-indigo-400" />,
      perform: () => onSwitchStrategy?.(strategy === 'ai' ? 'rule-based' : 'ai'),
    },
    {
      id: 'action-toggle-theme',
      title: `Toggle Theme (Current: ${theme})`,
      subtitle: 'Switch between Dark Mission-Control and Light mode',
      category: 'Appearance',
      icon: theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-400" />,
      perform: () => toggleTheme(),
    },
    {
      id: 'auth-merchandiser',
      title: 'Quick Switch to Merchandiser Account',
      subtitle: 'Full HITL approval & catalog mutation permissions',
      category: 'Authentication',
      icon: <UserCheck className="w-4 h-4 text-cyan-400" />,
      perform: () => quickLogin('MERCHANDISER'),
    },
    {
      id: 'auth-admin',
      title: 'Quick Switch to Admin Account',
      subtitle: 'Full administrative rights + strategy configuration',
      category: 'Authentication',
      icon: <UserCheck className="w-4 h-4 text-indigo-400" />,
      perform: () => quickLogin('ADMIN'),
    },
    {
      id: 'auth-viewer',
      title: 'Quick Switch to Viewer Account',
      subtitle: 'Read-only audit permissions',
      category: 'Authentication',
      icon: <UserCheck className="w-4 h-4 text-zinc-400" />,
      perform: () => quickLogin('VIEWER'),
    },
  ];

  // Search in products
  const productActions = products
    .filter(
      (p) =>
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        p.sku.toLowerCase().includes(query.toLowerCase())
    )
    .slice(0, 5)
    .map((p) => ({
      id: `prod-${p._id}`,
      title: `${p.sku} — ${p.name}`,
      subtitle: `$${p.currentPrice.toFixed(2)} | Stock: ${p.stockLevel} units (${p.category})`,
      category: 'Products',
      icon: <LayoutGrid className="w-4 h-4 text-[var(--accent-primary)]" />,
      perform: () => {
        setActiveTab('catalog');
        onSelectProduct?.(p);
      },
    }));

  const filtered = [
    ...baseActions.filter(
      (a) =>
        a.title.toLowerCase().includes(query.toLowerCase()) ||
        a.subtitle.toLowerCase().includes(query.toLowerCase()) ||
        a.category.toLowerCase().includes(query.toLowerCase())
    ),
    ...productActions,
  ];

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].perform();
        onClose();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/75 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-xl rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xl overflow-hidden animate-slide-up text-[var(--text-primary)]">
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
          <Search className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command, search products, or jump to view..."
            className="w-full bg-transparent text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none"
          />
          <kbd className="px-2 py-0.5 rounded text-[10px] font-mono-numbers bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border-subtle)]">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto p-2 divide-y divide-[var(--border-subtle)]/40">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-[var(--text-muted)]">
              No matching commands or products found for "{query}"
            </div>
          ) : (
            filtered.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    item.perform();
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-[var(--accent-glow)] border border-[var(--accent-primary)]/40 text-[var(--text-primary)]'
                      : 'hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-lg bg-[var(--bg-elevated)] shrink-0">
                      {item.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                        {item.title}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] truncate">
                        {item.subtitle}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <span className="text-[10px] font-mono-numbers px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                      {item.category}
                    </span>
                    <ArrowRight className={`w-3.5 h-3.5 ${isSelected ? 'text-[var(--accent-primary)]' : 'text-transparent'}`} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-4 py-2 bg-[var(--bg-elevated)] border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)] flex items-center justify-between">
          <span>Navigate with <kbd className="px-1 py-0.5 bg-[var(--bg-surface)] rounded border border-[var(--border-subtle)] font-mono-numbers">↑</kbd> <kbd className="px-1 py-0.5 bg-[var(--bg-surface)] rounded border border-[var(--border-subtle)] font-mono-numbers">↓</kbd></span>
          <span>Select with <kbd className="px-1.5 py-0.5 bg-[var(--bg-surface)] rounded border border-[var(--border-subtle)] font-mono-numbers">Enter</kbd></span>
        </div>
      </div>
    </div>
  );
}

