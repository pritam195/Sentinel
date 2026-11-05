import React, { useRef, useEffect, useState } from 'react';
import { Radio, Copy, Check, X, AlertCircle, CheckCircle2, Pause, Play } from 'lucide-react';
import { Drawer } from '../common/Modal';

export function LiveReasoningDrawer({
  isOpen,
  onClose,
  product,
  streamText = '',
  isStreaming = false,
  streamError = null,
  streamComplete = false,
  onStop,
}) {
  const containerRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);

  // Auto-scroll logic with pause-on-scroll-up
  useEffect(() => {
    if (!autoScroll || !containerRef.current) return;
    const el = containerRef.current;
    el.scrollTop = el.scrollHeight;
  }, [streamText, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(streamText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Syntax highlighting for json chunks
  const formatStreamJSON = (raw) => {
    return raw
      .replace(/"([^"]+)":/g, '<span class="text-cyan-400 font-semibold">"$1"</span>:')
      .replace(/: "([^"]*)"/g, ': <span class="text-emerald-400">"$1"</span>')
      .replace(/: ([0-9.]+)/g, ': <span class="text-amber-400 font-bold">$1</span>');
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Live Advisor Reasoning Inspector"
      subtitle={product ? `${product.sku} — ${product.name}` : 'Streaming Telemetry'}
      width="max-w-2xl"
    >
      <div className="h-full flex flex-col justify-between space-y-4">
        
        {/* Stream Status Banner */}
        <div className="flex items-center justify-between p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
          <div className="flex items-center gap-2.5">
            {isStreaming && (
              <span className="flex items-center gap-2 text-cyan-400 text-xs font-semibold">
                <Radio className="w-4 h-4 animate-pulse" />
                <span>Streaming tokens via SSE (/products/:id/suggest-pricing/stream)</span>
              </span>
            )}

            {streamComplete && (
              <span className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                <CheckCircle2 className="w-4 h-4" />
                <span>Stream Completed & Proposal Stored</span>
              </span>
            )}

            {streamError && (
              <span className="flex items-center gap-2 text-rose-400 text-xs font-semibold">
                <AlertCircle className="w-4 h-4" />
                <span>Stream Error: {streamError}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoScroll((prev) => !prev)}
              className="p-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              title={autoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
            >
              {autoScroll ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={copyToClipboard}
              className="p-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              title="Copy streamed content"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Stream Content Terminal */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          aria-live="polite"
          aria-atomic="false"
          className="flex-1 p-4 rounded-xl border border-[var(--border-subtle)] bg-black/80 font-mono-numbers text-xs leading-relaxed overflow-y-auto text-zinc-200 select-text"
        >
          {streamText ? (
            <pre
              className="whitespace-pre-wrap font-mono-numbers"
              dangerouslySetInnerHTML={{ __html: formatStreamJSON(streamText) }}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-zinc-500 text-xs">
              Waiting for initial model token stream...
            </div>
          )}
        </div>

        {/* Footer controls */}
        <div className="pt-2 flex items-center justify-between border-t border-[var(--border-subtle)]">
          <span className="text-[11px] text-[var(--text-muted)]">
            Tokens rendered in real-time as emitted by Gemini 2.5 Flash
          </span>

          <div className="flex gap-2">
            {isStreaming && onStop && (
              <button
                onClick={onStop}
                className="px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-950/40 dark:text-rose-300 text-xs font-medium cursor-pointer"
              >
                Abort Stream
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] font-medium cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>

      </div>
    </Drawer>
  );
}

