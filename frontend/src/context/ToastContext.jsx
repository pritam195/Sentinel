import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    ({ title, message, type = 'info', duration = 4500, action = null }) => {
      const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const toast = { id, title, message, type, action };

      setToasts((prev) => [...prev, toast]);

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, duration);
      }

      return id;
    },
    [removeToast]
  );

  const toast = {
    success: (message, title = 'Action completed', options = {}) =>
      addToast({ ...options, title, message, type: 'success' }),
    error: (message, title = 'Operation failed', options = {}) =>
      addToast({ ...options, title, message, type: 'error' }),
    warning: (message, title = 'Attention required', options = {}) =>
      addToast({ ...options, title, message, type: 'warning' }),
    info: (message, title = 'System notice', options = {}) =>
      addToast({ ...options, title, message, type: 'info' }),
    conflict: (message, title = 'Version Conflict (409)', options = {}) =>
      addToast({ ...options, title, message, type: 'conflict', duration: 7000 }),
  };

  const getIcon = (type) => {
    switch (type) {
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />;
      case 'warning':
      case 'conflict':
        return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;
      default:
        return <Info className="w-4 h-4 text-cyan-400 shrink-0" />;
    }
  };

  const getBorderColor = (type) => {
    switch (type) {
      case 'success':
        return 'border-emerald-500/30 bg-emerald-950/40 text-emerald-100';
      case 'error':
        return 'border-rose-500/30 bg-rose-950/40 text-rose-100';
      case 'warning':
      case 'conflict':
        return 'border-amber-500/30 bg-amber-950/40 text-amber-100';
      default:
        return 'border-cyan-500/30 bg-cyan-950/40 text-cyan-100';
    }
  };

  return (
    <ToastContext.Provider value={{ toast, addToast, removeToast }}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
        aria-live="polite"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-3 p-3 rounded-lg border backdrop-blur-md shadow-2xl transition-all duration-200 animate-slide-up ${getBorderColor(
              t.type
            )}`}
          >
            {getIcon(t.type)}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold tracking-wide uppercase text-zinc-300">
                {t.title}
              </div>
              <div className="text-xs mt-0.5 text-zinc-100 leading-relaxed break-words font-sans">
                {t.message}
              </div>
              {t.action && (
                <div className="mt-2">
                  <button
                    onClick={() => {
                      t.action.onClick();
                      removeToast(t.id);
                    }}
                    className="text-xs font-medium px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                  >
                    {t.action.label}
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={() => removeToast(t.id)}
              className="text-zinc-400 hover:text-zinc-200 p-0.5 rounded cursor-pointer"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context.toast;
}
