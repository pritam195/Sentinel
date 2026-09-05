import React, { useState, useEffect } from 'react';
import ProductList from './components/ProductList';
import SuggestionsPanel from './components/SuggestionsPanel';
import StrategyConfig from './components/StrategyConfig';
import TickerStrip from './components/TickerStrip';
import { API_BASE } from './config';
import './index.css';

function App() {
  const [products, setProducts] = useState([]);
  const [pricingSuggestions, setPricingSuggestions] = useState([]);
  const [reorderSuggestions, setReorderSuggestions] = useState([]);
  const [config, setConfig] = useState(null);
  
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [error, setError] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [streamData, setStreamData] = useState(null);
  const [highlightedRowId, setHighlightedRowId] = useState(null);

  const handleRowFlash = (id) => {
    setHighlightedRowId(id);
    setTimeout(() => setHighlightedRowId(null), 1500); // clear after animation
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch(`${API_BASE}/config/strategy`);
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch (err) {
      // ignore
    }
  };

  const fetchProducts = async () => {
    try {
      let url = `${API_BASE}/products?`;
      if (statusFilter) url += `status=${statusFilter}&`;
      if (categoryFilter) url += `category=${categoryFilter}`;
      
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch products');
      const data = await res.json();
      setProducts(data);
      setError(null);
    } catch (err) {
      setError('Connection error: Make sure MongoDB and backend are running.');
    }
  };

  const fetchSuggestions = async () => {
    try {
      const [pricingRes, reorderRes] = await Promise.all([
        fetch(`${API_BASE}/pricing-suggestions?status=PENDING`),
        fetch(`${API_BASE}/reorder-suggestions?status=PENDING`)
      ]);
      
      if (!pricingRes.ok || !reorderRes.ok) throw new Error('Failed to fetch suggestions');
      
      const pData = await pricingRes.json();
      const rData = await reorderRes.json();
      
      setPricingSuggestions(pData);
      setReorderSuggestions(rData);
      setError(null);
    } catch (err) {
      // Don't override primary error if products failed too
    }
  };

  const fetchAll = async () => {
    await fetchConfig();
    await fetchProducts();
    await fetchSuggestions();
    setInitialLoading(false);
  };

  useEffect(() => {
    fetchAll();
    // Poll every 5 seconds
    const interval = setInterval(() => {
      fetchAll();
    }, 5000);
    return () => clearInterval(interval);
  }, [statusFilter, categoryFilter]);

  const handleStreamPricing = async (productId) => {
    setStreamData({ title: 'AI Streaming...', text: '' });
    
    try {
      const res = await fetch(`${API_BASE}/products/${productId}/suggest-pricing/stream`, {
        method: 'POST'
      });
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      
      let fullStream = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.replace('data: ', '').trim();
            if (dataStr) {
              try {
                const data = JSON.parse(dataStr);
                if (data.chunk) {
                  fullStream += data.chunk;
                  setStreamData({ title: 'AI Reasoning Stream', text: fullStream });
                } else if (data.complete) {
                  await fetchSuggestions();
                } else if (data.error) {
                  setStreamData({ title: 'Stream Error', text: data.error });
                }
              } catch(e) {}
            }
          }
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const formatStreamedJSON = (text) => {
    // Add basic syntax highlighting to the raw streaming JSON
    return text
      .replace(/"([^"]+)":/g, '<span style="color: var(--signal-blue)">"$1"</span>:')
      .replace(/: "([^"]*)"/g, ': <span style="color: var(--signal-green)">"$1"</span>')
      .replace(/: ([0-9.]+)/g, ': <span style="color: var(--signal-amber)">$1</span>');
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-container">
          <div className="wordmark">Sentinel</div>
        </div>
        <div className="header-actions">
          <StrategyConfig config={config} fetchConfig={fetchConfig} setError={setError} />
        </div>
      </header>

      <TickerStrip 
        pricingSuggestions={pricingSuggestions} 
        reorderSuggestions={reorderSuggestions} 
      />

      {error && (
        <div className="error-banner fade-in" style={{margin: '16px'}}>
          ⚠️ {error}
        </div>
      )}

      <main className="main-content-split">
        <div className="ledger-section">
          {initialLoading ? (
            <div className="loading-spinner"></div>
          ) : (
            <>
              <ProductList 
                products={products} 
                onSimulateSale={fetchProducts}
                onUpdateStock={fetchProducts}
                onStreamAI={handleStreamPricing}
                highlightedRowId={highlightedRowId}
              />
            </>
          )}
        </div>
        
        <div className="suggestions-rail">
          <SuggestionsPanel 
            pricingSuggestions={pricingSuggestions}
            reorderSuggestions={reorderSuggestions}
            activeStrategy={config?.activeStrategy || 'rule-based'}
            fetchAll={fetchAll}
            setError={setError}
            onRowFlash={handleRowFlash}
          />
        </div>
      </main>
      
      {streamData && (
        <div className="stream-panel fade-in">
          <div className="stream-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="pulse-dot" style={{ backgroundColor: 'var(--signal-blue)' }}></span>
              <h3>{streamData.title}</h3>
            </div>
            <button className="expand-btn" onClick={() => setStreamData(null)}>Close</button>
          </div>
          <div className="stream-body">
            <pre 
              dangerouslySetInnerHTML={{ __html: formatStreamedJSON(streamData.text) }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
