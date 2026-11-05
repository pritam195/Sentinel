import { API_BASE } from '../config';

/**
 * Custom Sentinel API Error carrying HTTP status code and response payload
 */
export class ApiError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Core fetch wrapper with JSON serialization, JWT injection, and standard error decoding
 */
async function request(endpoint, options = {}) {
  const { method = 'GET', body, token, headers = {}, signal } = options;

  const reqHeaders = {
    ...headers,
  };

  if (body && !(body instanceof FormData)) {
    reqHeaders['Content-Type'] = 'application/json';
  }

  if (token) {
    reqHeaders['Authorization'] = `Bearer ${token}`;
  }

  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: reqHeaders,
      body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      signal,
    });
  } catch (netErr) {
    if (netErr.name === 'AbortError') throw netErr;
    throw new ApiError(
      'Network request failed. Ensure the Sentinel backend server is running.',
      0
    );
  }

  let data = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const errorMsg =
      data?.error ||
      data?.message ||
      `Request failed with status ${response.status} (${response.statusText})`;
    throw new ApiError(errorMsg, response.status, data);
  }

  return data;
}

export const api = {
  // Authentication & Identity
  auth: {
    /**
     * Authenticate seeded user credentials (username, password)
     */
    login: (credentials) =>
      request('/auth/login', {
        method: 'POST',
        body: credentials,
      }),

    /**
     * Inspect active token identity
     */
    me: (token) =>
      request('/auth/me', {
        method: 'GET',
        token,
      }),

    /**
     * Dev token endpoint (active only when ALLOW_DEV_TOKENS=true)
     */
    devToken: (payload) =>
      request('/auth/dev-token', {
        method: 'POST',
        body: payload,
      }),
  },

  // Configuration & Engine Health
  config: {
    /**
     * Retrieve active merchandising strategy and thresholds
     */
    getStrategy: () =>
      request('/config/strategy', {
        method: 'GET',
      }),

    /**
     * Update active strategy or guardrail parameters (ADMIN only)
     */
    updateStrategy: (payload, token) =>
      request('/config/strategy', {
        method: 'PATCH',
        body: payload,
        token,
      }),

    /**
     * Retrieve real-time upstream circuit breaker, concurrency, and fallback telemetry
     */
    getAdvisorHealth: () =>
      request('/config/advisor-health', {
        method: 'GET',
      }),
  },

  // Catalog Products & Direct Actions
  products: {
    /**
     * List catalog products with optional status and category filters
     */
    list: (params = {}) => {
      const q = new URLSearchParams();
      if (params.status) q.append('status', params.status);
      if (params.category) q.append('category', params.category);
      const queryStr = q.toString();
      return request(`/products${queryStr ? `?${queryStr}` : ''}`);
    },

    /**
     * Create product record
     */
    create: (data, token) =>
      request('/products', {
        method: 'POST',
        body: data,
        token,
      }),

    /**
     * Adjust stock level or apply a delta
     */
    updateStock: (id, payload, token) =>
      request(`/products/${id}/stock`, {
        method: 'PATCH',
        body: payload,
        token,
      }),

    /**
     * Update product price or costPrice (increments priceVersion)
     */
    updatePrice: (id, payload, token) =>
      request(`/products/${id}/price`, {
        method: 'PATCH',
        body: payload,
        token,
      }),

    /**
     * Simulate a customer order purchase event
     */
    createOrder: (id, payload = { qty: 1 }) =>
      request(`/products/${id}/orders`, {
        method: 'POST',
        body: payload,
      }),

    /**
     * Trigger manual pricing recommendation
     */
    suggestPricing: (id, token) =>
      request(`/products/${id}/suggest-pricing`, {
        method: 'POST',
        token,
      }),

    /**
     * Trigger manual replenishment recommendation
     */
    suggestReorder: (id, token) =>
      request(`/products/${id}/suggest-reorder`, {
        method: 'POST',
        token,
      }),

    /**
     * Stream live Gemini reasoning tokens via SSE
     */
    streamPricing: async (id, { onChunk, onComplete, onError, signal }) => {
      const url = `${API_BASE}/products/${id}/suggest-pricing/stream`;
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          signal,
        });

        if (!response.ok) {
          throw new ApiError(`Stream connection failed: ${response.status}`, response.status);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let accumulatedText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const rawData = line.slice(6).trim();
              if (!rawData) continue;

              try {
                const parsed = JSON.parse(rawData);
                if (parsed.chunk) {
                  accumulatedText += parsed.chunk;
                  if (onChunk) onChunk(parsed.chunk, accumulatedText);
                } else if (parsed.complete) {
                  if (onComplete) onComplete(parsed.suggestion, accumulatedText);
                } else if (parsed.error) {
                  if (onError) onError(new Error(parsed.error));
                }
              } catch {
                // Non-JSON SSE line or partial parse, treat as raw text
                accumulatedText += rawData;
                if (onChunk) onChunk(rawData, accumulatedText);
              }
            }
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (onError) onError(err);
        else throw err;
      }
    },
  },

  // Merchandiser HITL Approval Queue
  suggestions: {
    /**
     * List pricing suggestions (optional status: PENDING, ACCEPTED, REJECTED, STALE, EXPIRED)
     */
    listPricing: (params = {}) => {
      const q = new URLSearchParams();
      if (params.status) q.append('status', params.status);
      const queryStr = q.toString();
      return request(`/pricing-suggestions${queryStr ? `?${queryStr}` : ''}`);
    },

    /**
     * Review pricing suggestion (status: ACCEPTED | REJECTED)
     * Handles 409 Conflict (priceVersion stale) and 410 Gone (expired)
     */
    updatePricing: (id, status, token) =>
      request(`/pricing-suggestions/${id}`, {
        method: 'PATCH',
        body: { status },
        token,
      }),

    /**
     * List reorder replenishment suggestions
     */
    listReorder: (params = {}) => {
      const q = new URLSearchParams();
      if (params.status) q.append('status', params.status);
      const queryStr = q.toString();
      return request(`/reorder-suggestions${queryStr ? `?${queryStr}` : ''}`);
    },

    /**
     * Review reorder suggestion (status: ACCEPTED | REJECTED)
     * Handles 409 Conflict (stock drifted > 25%) and 410 Gone (expired)
     */
    updateReorder: (id, status, token) =>
      request(`/reorder-suggestions/${id}`, {
        method: 'PATCH',
        body: { status },
        token,
      }),
  },
};
