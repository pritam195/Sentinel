import React from 'react';
import { Modal } from '../common/Modal';

export function KeyboardShortcutsModal({ isOpen, onClose }) {
  const shortcuts = [
    { key: 'J / K', description: 'Navigate next / previous suggestion in review list' },
    { key: 'A', description: 'Accept selected proposal (opens confirmation)' },
    { key: 'R', description: 'Reject selected proposal' },
    { key: '/', description: 'Focus search filter in current view' },
    { key: '⌘ + K / Ctrl + K', description: 'Open global command palette' },
    { key: '?', description: 'Show this keyboard shortcuts guide' },
    { key: 'Esc', description: 'Close open modal, drawer, or palette' },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Keyboard Navigation Shortcuts" maxWidth="max-w-md">
      <div className="space-y-3">
        <p className="text-xs text-[var(--text-secondary)]">
          Sentinel Decision Desk is optimized for high-speed triage without touching the mouse.
        </p>

        <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl overflow-hidden bg-[var(--bg-elevated)]">
          {shortcuts.map((s, idx) => (
            <div key={idx} className="flex items-center justify-between p-3 text-xs">
              <span className="text-[var(--text-secondary)]">{s.description}</span>
              <kbd className="px-2 py-1 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] font-mono-numbers font-semibold text-[var(--text-primary)] text-[11px] shadow-2xs">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>

        <div className="pt-2 text-center">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] font-medium cursor-pointer"
          >
            Got it
          </button>
        </div>
      </div>
    </Modal>
  );
}

