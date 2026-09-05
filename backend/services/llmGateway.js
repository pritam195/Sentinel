import dotenv from 'dotenv';

dotenv.config();

/**
 * Gateway to call the LLM API.
 * Currently configured for Gemini 1.5 Flash via Google AI Studio.
 * 
 * @param {string} prompt 
 * @returns {Promise<string>} The raw text response from the model
 */
export async function callLLM(prompt) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') {
    throw new Error('LLM_API_KEY is missing or invalid.');
  }

  const model = process.env.LLM_MODEL || 'gemini-1.5-flash';
  // Standard Gemini base URL if not provided
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
      throw new Error(`LLM API error (${response.status}): ${errorText}`);
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
      throw new Error('LLM request timed out after 10 seconds.');
    }
    throw error;
  }
}

export async function callLLMStream(prompt, onChunk) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') throw new Error('LLM_API_KEY missing');
  
  const model = process.env.LLM_MODEL || 'gemini-1.5-flash';
  const baseUrl = process.env.LLM_BASE_URL || `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent`;
  
  const url = `${baseUrl}?alt=sse&key=${apiKey}`;

  const payload = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1 } };

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
    if (error.name === 'AbortError') throw new Error('LLM stream timed out after 10 seconds.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) throw new Error(`Stream error: ${res.status}`);

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
}
