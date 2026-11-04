import React, { useState } from 'react';
import { API_BASE } from '../config';

export default function SuggestionsPanel({ 
  pricingSuggestions = [], 
  reorderSuggestions = [], 
  activeStrategy = 'rule-based', 
  fetchAll, 
  setError, 
  onRowFlash 
}) {
  const [loadingIds, setLoadingIds] = useState({});
  const [expandedIds, setExpandedIds] = useState({});
  const [filterMode, setFilterMode] = useState('active'); // 'active' (matches activeStrategy) | 'all'

  const handleAction = async (type, item, actionStatus) => {
    setLoadingIds(prev => ({ ...prev, [item._id]: true }));
    const endpoint = type === 'pricing' ? 'pricing-suggestions' : 'reorder-suggestions';
    
    try {
      const res = await fetch(`${API_BASE}/${endpoint}/${item._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: actionStatus })
      });
      if (!res.ok) throw new Error(`Failed to ${actionStatus} suggestion`);
      
      // Trigger animations
      if (actionStatus === 'ACCEPTED' && onRowFlash) {
        onRowFlash(item.productId?._id);
      }
      
      // Allow animation to play before fetching all to remove it
      setTimeout(async () => {
        await fetchAll();
      }, 300);
      
    } catch (err) {
      setError(err.message);
      setLoadingIds(prev => ({ ...prev, [item._id]: false }));
    }
  };

  const toggleExpand = (id) => {
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const isItemFallback = (item) => {
    return Boolean(item.isFallback || item.reasoning?.includes('[Fallback'));
  };

  const isItemAI = (item) => {
    const isFallback = isItemFallback(item);
    if (isFallback) return false;
    const isExplicitAI = item.reasoning?.includes('[AI');
    const isRulePattern = 
      item.reasoning?.includes('Inventory is critically low') ||
      item.reasoning?.includes('Demand is significantly higher') ||
      item.reasoning?.includes('Standard rule-based replenishment') ||
      item.reasoning?.includes('No pricing rules fired');
    
    return isExplicitAI || !isRulePattern;
  };

  // Filter lists according to active engine or show all
  const filteredPricing = pricingSuggestions.filter(item => {
    if (filterMode === 'all') return true;
    const isFallback = isItemFallback(item);
    const itemIsAI = isItemAI(item);
    if (activeStrategy === 'ai') {
      return itemIsAI || isFallback;
    }
    return !itemIsAI && !isFallback;
  });

  const filteredReorder = reorderSuggestions.filter(item => {
    if (filterMode === 'all') return true;
    const isFallback = isItemFallback(item);
    const itemIsAI = isItemAI(item);
    if (activeStrategy === 'ai') {
      return itemIsAI || isFallback;
    }
    return !itemIsAI && !isFallback;
  });

  const allSuggestionsCount = pricingSuggestions.length + reorderSuggestions.length;
  const filteredCount = filteredPricing.length + filteredReorder.length;

  const CompactSuggestionRow = ({ item, type }) => {
    const isPricing = type === 'pricing';
    const triggerClass = `trigger-accent-${item.triggerReason.toLowerCase()}`;
    const product = item.productId || {};
    
    const isFallback = isItemFallback(item);
    const isAI = isItemAI(item);
    const sourceClass = isFallback ? 'fallback' : (isAI ? 'ai' : 'rule');
    const sourceLabel = isFallback ? 'AI FALLBACK' : (isAI ? 'AI' : 'RULE');
    
    const isUp = isPricing ? item.recommendedPrice > item.currentPrice : true;
    
    // Check if it's currently loading (animating out)
    const isCollapsing = loadingIds[item._id];

    return (
      <div className={`compact-suggestion-row ${triggerClass} ${isCollapsing ? 'collapsing' : ''}`}>
        <div className="suggestion-header-compact">
          <span className="suggestion-product-name">{product.name || 'Unknown Product'}</span>
          <span className={`source-badge ${sourceClass}`}>{sourceLabel}</span>
        </div>

        {activeStrategy === 'ai' && isFallback && (
          <div className="fallback-warning-pill">
            <span className="fallback-warning-icon">⚠️</span>
            <span>Fallback used: upstream LLM unavailable {item.fallbackReason ? `(${item.fallbackReason})` : ''}</span>
          </div>
        )}
        
        <div className="suggestion-delta">
          <span className="old-val" style={{ opacity: 0.6 }}>
            {isPricing ? `$${item.currentPrice?.toFixed(2)}` : item.currentStock}
          </span>
          <span className={`delta-arrow ${isUp ? 'up' : 'down'}`}>
            {isUp ? '▲' : '▼'}
          </span>
          <span className="new-val">
            {isPricing ? `$${item.recommendedPrice?.toFixed(2)}` : `+${item.recommendedQuantity}`}
          </span>
        </div>

        <div className="suggestion-reasoning-compact">
          <div className={`reasoning-text ${expandedIds[item._id] ? 'expanded' : ''}`}>
            {item.reasoning.replace(/\[AI Analysis\] /g, '')}
          </div>
          <button className="expand-btn" onClick={() => toggleExpand(item._id)}>
            {expandedIds[item._id] ? 'Less' : 'View reasoning'}
          </button>
        </div>

        <div className="confidence-meter-container">
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>CONF</span>
          <div className="confidence-meter-track">
            <div 
              className="confidence-meter-fill" 
              style={{ width: `${item.confidence * 100}%`, backgroundColor: item.confidence > 0.8 ? 'var(--signal-green)' : 'var(--signal-amber)' }}
            />
          </div>
          <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }}>{(item.confidence * 100).toFixed(0)}%</span>
        </div>
        
        <div className="compact-actions">
          <button 
            className="btn"
            style={{ flex: 1, borderColor: 'var(--signal-green)', color: 'var(--signal-green)' }}
            onClick={() => handleAction(type, item, 'ACCEPTED')}
            disabled={loadingIds[item._id]}
          >
            Accept
          </button>
          <button 
            className="btn"
            style={{ flex: 1, borderColor: 'var(--border-hairline)', color: 'var(--text-muted)' }}
            onClick={() => handleAction(type, item, 'REJECTED')}
            disabled={loadingIds[item._id]}
          >
            Reject
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="card">
      <div className="suggestions-header-compact">
        <div className="suggestions-title-group">
          <span className="section-title">Human-in-the-Loop Review Queue</span>
          <span className="queue-count-badge">{filteredCount}</span>
        </div>

        <div className="filter-pill-toggle">
          <button 
            className={`filter-pill ${filterMode === 'active' ? 'active' : ''}`}
            onClick={() => setFilterMode('active')}
          >
            Active Engine ({activeStrategy.toUpperCase()})
          </button>
          <button 
            className={`filter-pill ${filterMode === 'all' ? 'active' : ''}`}
            onClick={() => setFilterMode('all')}
          >
            All Suggestions ({allSuggestionsCount})
          </button>
        </div>
      </div>

      <div className="suggestions-columns-container">
        {/* Pricing Suggestions Column */}
        <div className="suggestions-col">
          <div className="col-header">
            <span className="col-title">Price Adjustments</span>
            <span className="col-count">{filteredPricing.length}</span>
          </div>
          <div className="suggestions-scrollable">
            {filteredPricing.length === 0 ? (
              <div className="empty-queue-msg">No pending price adjustments</div>
            ) : (
              filteredPricing.map(item => (
                <CompactSuggestionRow key={item._id} item={item} type="pricing" />
              ))
            )}
          </div>
        </div>

        {/* Reorder Suggestions Column */}
        <div className="suggestions-col">
          <div className="col-header">
            <span className="col-title">Replenishment Orders</span>
            <span className="col-count">{filteredReorder.length}</span>
          </div>
          <div className="suggestions-scrollable">
            {filteredReorder.length === 0 ? (
              <div className="empty-queue-msg">No pending replenishment orders</div>
            ) : (
              filteredReorder.map(item => (
                <CompactSuggestionRow key={item._id} item={item} type="reorder" />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
