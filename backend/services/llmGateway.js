import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import {
  executeWithResilience,
  globalCircuitBreaker,
  globalSemaphore,
  globalRetryHandler,
  CircuitBreaker,
  Semaphore,
  RetryHandler
} from './resilience.js';

dotenv.config();

export {
  globalCircuitBreaker,
  globalSemaphore,
  globalRetryHandler,
  CircuitBreaker,
  Semaphore,
  RetryHandler,
  executeWithResilience
};

/**
 * Calls Gemini REST API
 */
export async function callGemini(prompt, options = {}) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') {
    throw new Error('LLM_API_KEY is missing or invalid.');
  }

  const model = process.env.LLM_MODEL || 'gemini-2.5-flash';
  const baseUrl = process.env.LLM_BASE_URL || `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const url = baseUrl.includes('?') ? `${baseUrl}&key=${apiKey}` : `${baseUrl}?key=${apiKey}`;

  const payload = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.1,
    }
  };

  return executeWithResilience(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, 10000); // 10 second timeout

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(`LLM API error (${response.status}): ${errorText}`);
        err.status = response.status;
        err.headers = response.headers;
        throw err;
      }

      const data = await response.json();
      
      // Extract text from Gemini response structure
      if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
        return data.candidates[0].content.parts[0].text;
      }
      
      throw new Error('Unexpected response format from LLM.');
    } catch (error) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') {
        const err = new Error('LLM request timed out after 10 seconds.');
        err.name = 'AbortError';
        err.code = 'TIMEOUT';
        throw err;
      }
      throw error;
    }
  }, options);
}

/**
 * Calls Groq / Grok OpenAI-compatible REST API as secondary fallback
 */
export async function callGroq(prompt, options = {}) {
  const apiKey = process.env.GROQ_API_KEY || process.env.GROK_API_KEY;
  if (!apiKey || apiKey === 'your_groq_api_key_here') {
    throw new Error('GROQ_API_KEY is missing or invalid.');
  }

  const model = process.env.GROQ_MODEL || process.env.GROK_MODEL || 'openai/gpt-oss-120b';
  const url = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1/chat/completions';

  const payload = {
    model,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.1
  };

  return executeWithResilience(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(`Groq API error (${response.status}): ${errorText}`);
        err.status = response.status;
        err.headers = response.headers;
        throw err;
      }

      const data = await response.json();
      if (data.choices && data.choices.length > 0 && data.choices[0].message) {
        return data.choices[0].message.content;
      }

      throw new Error('Unexpected response format from Groq.');
    } catch (error) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') {
        const err = new Error('Groq request timed out after 10 seconds.');
        err.name = 'AbortError';
        err.code = 'TIMEOUT';
        throw err;
      }
      throw error;
    }
  }, options);
}

/**
 * Gateway to call the LLM API with built-in resilience and multi-provider fallback:
 * 1. Primary: Gemini 2.5 Flash
 * 2. Secondary: Groq (openai/gpt-oss-120b) if Gemini is rate limited, exhausted, or unavailable
 * 
 * @param {string} prompt 
 * @param {object} options
 * @returns {Promise<string>} The raw text response from the model
 */
export async function callLLM(prompt, options = {}) {
  const hasGeminiKey = Boolean(process.env.LLM_API_KEY && process.env.LLM_API_KEY !== 'your_api_key_here');
  const hasGroqKey = Boolean((process.env.GROQ_API_KEY || process.env.GROK_API_KEY) && (process.env.GROQ_API_KEY || process.env.GROK_API_KEY) !== 'your_groq_api_key_here');

  if (!hasGeminiKey) {
    if (hasGroqKey) {
      return callGroq(prompt, options);
    }
    throw new Error('LLM_API_KEY is missing or invalid.');
  }

  try {
    return await callGemini(prompt, options);
  } catch (geminiError) {
    if (hasGroqKey) {
      console.warn(`[LLM Gateway] Primary LLM (Gemini) unavailable (${geminiError.message}). Switching to fallback LLM (Groq)...`);
      try {
        return await callGroq(prompt, options);
      } catch (groqError) {
        console.error(`[LLM Gateway] Fallback LLM (Groq) also failed: ${groqError.message}`);
        throw groqError;
      }
    }
    throw geminiError;
  }
}

export async function callGeminiStream(prompt, onChunk, options = {}) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') throw new Error('LLM_API_KEY missing');
  
  const model = process.env.LLM_MODEL || 'gemini-2.5-flash';
  const baseUrl = process.env.LLM_BASE_URL || `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent`;
  const url = `${baseUrl}?alt=sse&key=${apiKey}`;

  const payload = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1 } };

  return executeWithResilience(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        const err = new Error('LLM stream timed out after 10 seconds.');
        err.name = 'AbortError';
        err.code = 'TIMEOUT';
        throw err;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const errorText = await res.text();
      const err = new Error(`Stream error ${res.status}: ${errorText}`);
      err.status = res.status;
      err.headers = res.headers;
      throw err;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.replace('data: ', '').trim();
          if (dataStr && dataStr !== '[DONE]') {
            try {
              const data = JSON.parse(dataStr);
              if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
                const textChunk = data.candidates[0].content.parts[0].text;
                fullText += textChunk;
                if (onChunk) onChunk(textChunk);
              }
            } catch(e) {}
          }
        }
      }
    }
    return fullText;
  }, options);
}

export async function callGroqStream(prompt, onChunk, options = {}) {
  const apiKey = process.env.GROQ_API_KEY || process.env.GROK_API_KEY;
  if (!apiKey || apiKey === 'your_groq_api_key_here') {
    throw new Error('GROQ_API_KEY is missing or invalid.');
  }

  const model = process.env.GROQ_MODEL || process.env.GROK_MODEL || 'openai/gpt-oss-120b';
  const url = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1/chat/completions';

  const payload = {
    model,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.1,
    stream: true
  };

  return executeWithResilience(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        const err = new Error('Groq stream timed out after 10 seconds.');
        err.name = 'AbortError';
        err.code = 'TIMEOUT';
        throw err;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const errorText = await res.text();
      const err = new Error(`Groq stream error ${res.status}: ${errorText}`);
      err.status = res.status;
      err.headers = res.headers;
      throw err;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });

      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.replace('data: ', '').trim();
          if (dataStr && dataStr !== '[DONE]') {
            try {
              const data = JSON.parse(dataStr);
              const textChunk = data.choices?.[0]?.delta?.content || '';
              if (textChunk) {
                fullText += textChunk;
                if (onChunk) onChunk(textChunk);
              }
            } catch (e) {}
          }
        }
      }
    }
    return fullText;
  }, options);
}

export async function callLLMStream(prompt, onChunk, options = {}) {
  const hasGeminiKey = Boolean(process.env.LLM_API_KEY && process.env.LLM_API_KEY !== 'your_api_key_here');
  const hasGroqKey = Boolean((process.env.GROQ_API_KEY || process.env.GROK_API_KEY) && (process.env.GROQ_API_KEY || process.env.GROK_API_KEY) !== 'your_groq_api_key_here');

  if (!hasGeminiKey) {
    if (hasGroqKey) {
      return callGroqStream(prompt, onChunk, options);
    }
    throw new Error('LLM_API_KEY is missing or invalid.');
  }

  try {
    return await callGeminiStream(prompt, onChunk, options);
  } catch (geminiError) {
    if (hasGroqKey) {
      console.warn(`[LLM Gateway] Primary stream (Gemini) unavailable (${geminiError.message}). Switching to fallback stream (Groq)...`);
      try {
        return await callGroqStream(prompt, onChunk, options);
      } catch (groqError) {
        console.error(`[LLM Gateway] Fallback stream (Groq) also failed: ${groqError.message}`);
        throw groqError;
      }
    }
    throw geminiError;
  }
}
