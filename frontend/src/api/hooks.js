import { useState, useEffect, useCallback, useRef } from 'react';
import { api, ApiError } from './client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

/**
 * Hook to fetch and periodically poll the products catalog
 */
export function useProducts({ status = '', category = '', pollInterval = 5000 } = {}) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchProducts = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const data = await api.products.list({ status, category });
      setProducts(data || []);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load catalog');
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [status, category]);

  useEffect(() => {
    let mounted = true;
    fetchProducts(true);

    if (pollInterval > 0) {
      const timer = setInterval(() => {
        if (mounted) fetchProducts(false);
      }, pollInterval);
      return () => {
        mounted = false;
        clearInterval(timer);
      };
    }
  }, [fetchProducts, pollInterval]);

  const mutateLocal = useCallback((updater) => {
    setProducts((prev) => (typeof updater === 'function' ? updater(prev) : updater));
  }, []);

  return {
    products,
    loading,
    error,
    refresh: () => fetchProducts(false),
    mutateLocal,
  };
}

/**
 * Hook to manage the Human-in-the-Loop Review Queue (Pricing & Reorder suggestions)
 */
export function useSuggestions({ status = 'PENDING', pollInterval = 4000 } = {}) {
  const { token, canReview, openAuthModal } = useAuth();
  const toast = useToast();

  const [pricingSuggestions, setPricingSuggestions] = useState([]);
  const [reorderSuggestions, setReorderSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState({});
  const [error, setError] = useState(null);

  const fetchSuggestions = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const [pricing, reorder] = await Promise.all([
        api.suggestions.listPricing({ status }),
        api.suggestions.listReorder({ status }),
      ]);
      setPricingSuggestions(pricing || []);
      setReorderSuggestions(reorder || []);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load suggestion queue');
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    let mounted = true;
    fetchSuggestions(true);

    if (pollInterval > 0) {
      const timer = setInterval(() => {
        if (mounted) fetchSuggestions(false);
      }, pollInterval);
      return () => {
        mounted = false;
        clearInterval(timer);
      };
    }
  }, [fetchSuggestions, pollInterval]);

  // Handle Review Actions with Optimistic Updates & 409/410 Conflict Handling
  const reviewSuggestion = useCallback(
    async (type, id, actionStatus) => {
      if (!canReview) {
        openAuthModal();
        toast.warning(
          'Authentication required: Please log in as a Merchandiser or Admin to review proposals.'
        );
        return { success: false, error: 'Unauthorized' };
      }

      setActionInProgress((prev) => ({ ...prev, [id]: true }));

      // Snapshot for optimistic rollback
      const prevPricing = [...pricingSuggestions];
      const prevReorder = [...reorderSuggestions];

      // Optimistic removal from PENDING list
      if (status === 'PENDING') {
        if (type === 'pricing') {
          setPricingSuggestions((prev) => prev.filter((s) => s._id !== id));
        } else {
          setReorderSuggestions((prev) => prev.filter((s) => s._id !== id));
        }
      }

      try {
        const updateFn =
          type === 'pricing' ? api.suggestions.updatePricing : api.suggestions.updateReorder;
        const result = await updateFn(id, actionStatus, token);

        toast.success(
          `${type === 'pricing' ? 'Price proposal' : 'Replenishment order'} marked ${actionStatus.toLowerCase()}.`,
          actionStatus === 'ACCEPTED' ? 'Proposal Approved' : 'Proposal Dismissed'
        );

        // Fetch fresh state in background
        fetchSuggestions(false);
        return { success: true, result };
      } catch (err) {
        // Rollback optimistic state
        setPricingSuggestions(prevPricing);
        setReorderSuggestions(prevReorder);

        if (err instanceof ApiError) {
          if (err.status === 409) {
            toast.conflict(
              err.message || 'Product catalog state changed since proposal was generated. Marked as STALE.',
              '409 Staleness Conflict',
              {
                action: {
                  label: 'Refresh Queue',
                  onClick: () => fetchSuggestions(false),
                },
              }
            );
          } else if (err.status === 410) {
            toast.warning(
              'This proposal has exceeded its 24h TTL window and expired.',
              '410 Proposal Expired'
            );
          } else if (err.status === 403) {
            toast.error(
              'Your role is not authorized to approve proposals. Required: MERCHANDISER or ADMIN.',
              '403 Forbidden'
            );
          } else {
            toast.error(err.message, 'Review Action Failed');
          }
        } else {
          toast.error(err.message, 'Review Action Failed');
        }

        // Fetch to ensure state is clean
        fetchSuggestions(false);
        return { success: false, error: err };
      } finally {
        setActionInProgress((prev) => ({ ...prev, [id]: false }));
      }
    },
    [canReview, openAuthModal, toast, pricingSuggestions, reorderSuggestions, status, token, fetchSuggestions]
  );

  return {
    pricingSuggestions,
    reorderSuggestions,
    loading,
    error,
    actionInProgress,
    refresh: () => fetchSuggestions(false),
    acceptPricing: (id) => reviewSuggestion('pricing', id, 'ACCEPTED'),
    rejectPricing: (id) => reviewSuggestion('pricing', id, 'REJECTED'),
    acceptReorder: (id) => reviewSuggestion('reorder', id, 'ACCEPTED'),
    rejectReorder: (id) => reviewSuggestion('reorder', id, 'REJECTED'),
  };
}

/**
 * Hook to monitor upstream LLM advisor health, circuit breaker, and rate limit counters
 */
export function useAdvisorHealth({ pollInterval = 6000 } = {}) {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchHealth = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const data = await api.config.getAdvisorHealth();
      setHealth(data);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to fetch advisor telemetry');
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchHealth(true);

    if (pollInterval > 0) {
      const timer = setInterval(() => {
        if (mounted) fetchHealth(false);
      }, pollInterval);
      return () => {
        mounted = false;
        clearInterval(timer);
      };
    }
  }, [fetchHealth, pollInterval]);

  const breakerState = health?.breakerState || 'CLOSED';
  const isBreakerOpen = breakerState === 'OPEN';
  const isHalfOpen = breakerState === 'HALF_OPEN';
  const isClosed = breakerState === 'CLOSED';

  return {
    health,
    loading,
    error,
    breakerState,
    isBreakerOpen,
    isHalfOpen,
    isClosed,
    refresh: () => fetchHealth(false),
  };
}

/**
 * Hook to retrieve and edit system engine strategy and guardrails (ADMIN)
 */
export function useStrategyConfig() {
  const { token, canConfigure, openAuthModal } = useAuth();
  const toast = useToast();

  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchConfig = useCallback(async () => {
    try {
      const data = await api.config.getStrategy();
      setConfig(data);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load strategy config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const updateStrategy = useCallback(
    async (payload) => {
      if (!canConfigure) {
        openAuthModal();
        toast.warning('Admin role required: Only administrators can modify advisor strategy.');
        return false;
      }

      try {
        const updated = await api.config.updateStrategy(payload, token);
        setConfig(updated);
        toast.success(
          `Strategy updated to ${payload.strategy === 'ai' ? 'AI Advisor' : 'Rule-Based Engine'}.`,
          'Configuration Applied'
        );
        return true;
      } catch (err) {
        toast.error(err.message || 'Failed to update configuration', 'Config Update Failed');
        return false;
      }
    },
    [canConfigure, openAuthModal, toast, token]
  );

  return {
    config,
    loading,
    error,
    refresh: fetchConfig,
    updateStrategy,
  };
}

/**
 * Hook to stream live SSE tokens from /products/:id/suggest-pricing/stream
 */
export function useLiveStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [activeProduct, setActiveProduct] = useState(null);
  const [streamError, setStreamError] = useState(null);
  const [streamComplete, setStreamComplete] = useState(false);
  const abortControllerRef = useRef(null);

  const startStream = useCallback((product) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setActiveProduct(product);
    setIsStreaming(true);
    setStreamText('');
    setStreamError(null);
    setStreamComplete(false);

    api.products.streamPricing(product._id, {
      signal: controller.signal,
      onChunk: (_chunk, accumulated) => {
        setStreamText(accumulated);
      },
      onComplete: (_suggestion, accumulated) => {
        setStreamText(accumulated);
        setIsStreaming(false);
        setStreamComplete(true);
      },
      onError: (err) => {
        setStreamError(err.message || 'Streaming terminated unexpectedly');
        setIsStreaming(false);
      },
    });
  }, []);

  const cancelStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const clearStream = useCallback(() => {
    cancelStream();
    setActiveProduct(null);
    setStreamText('');
    setStreamError(null);
    setStreamComplete(false);
  }, [cancelStream]);

  return {
    isStreaming,
    streamText,
    activeProduct,
    streamError,
    streamComplete,
    startStream,
    cancelStream,
    clearStream,
  };
}

