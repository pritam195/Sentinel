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

  const isItemAI = (item) => {
    const isFallback = item.reasoning?.includes('[Fallback');
    const isExplicitAI = item.reasoning?.includes('[AI');
    const isRulePattern = 
      item.reasoning?.includes('Inventory is critically low') ||
      item.reasoning?.includes('Demand is significantly higher') ||
      item.reasoning?.includes('Standard rule-based replenishment') ||
      item.reasoning?.includes('No pricing rules fired');
    
    return isExplicitAI || (!isRulePattern && !isFallback);
  };

  // Filter lists according to active engine or show all
  const filteredPricing = pricingSuggestions.filter(item => {
    if (filterMode === 'all') return true;
    const itemIsAI = isItemAI(item);
    return activeStrategy === 'ai' ? itemIsAI : !itemIsAI;
  });

  const filteredReorder = reorderSuggestions.filter(item => {
    if (filterMode === 'all') return true;
    const itemIsAI = isItemAI(item);
    return activeStrategy === 'ai' ? itemIsAI : !itemIsAI;
  });

  const allSuggestionsCount = pricingSuggestions.length + reorderSuggestions.length;
  const filteredCount = filteredPricing.length + filteredReorder.length;

  const CompactSuggestionRow = ({ item, type }) => {
    const isPricing = type === 'pricing';
    const triggerClass = `trigger-accent-${item.triggerReason.toLowerCase()}`;
    const product = item.productId || {};
    
    const isFallback = item.reasoning?.includes('[Fallback');
    const isExplicitAI = item.reasoning?.includes('[AI');
    const isRulePattern = 
      item.reasoning?.includes('Inventory is critically low') ||
      item.reasoning?.includes('Demand is significantly higher') ||
      item.reasoning?.includes('Standard rule-based replenishment') ||
      item.reasoning?.includes('No pricing rules fired');
    
    const isAI = isExplicitAI || (!isRulePattern && !isFallback);
    const sourceClass = isAI ? 'ai' : (isFallback ? 'fallback' : 'rule');
    const sourceLabel = isAI ? 'AI' : (isFallback ? 'FALLBACK' : 'RULE');
    
    const isUp = isPricing ? item.recommendedPrice > item.currentPrice : true;
    
    // Check if it's currently loading (animating out)
    const isCollapsing = loadingIds[item._id];

    return (
      <div className={`compact-suggestion-row ${triggerClass} ${isCollapsing ? 'collapsing' : ''}`}>
        <div className="suggestion-header-compact">
          <span className="suggestion-product-name">{product.name || 'Unknown Product'}</span>
          <span className={`source-badge ${sourceClass}`}>{sourceLabel}</span>
        </div>
        
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
    <div>
      <div className="rail-header">
        <span>Actionable Insights</span>
        <div className="filter-pill-group">
          <button 
            className={`pill-btn ${filterMode === 'active' ? (activeStrategy === 'ai' ? 'active' : 'active rule-pill') : ''}`}
            onClick={() => setFilterMode('active')}
          >
            {activeStrategy === 'ai' ? 'AI Only' : 'Rules Only'}
          </button>
          <button 
            className={`pill-btn ${filterMode === 'all' ? 'active' : ''}`}
            onClick={() => setFilterMode('all')}
          >
            All ({allSuggestionsCount})
          </button>
        </div>
      </div>
      
      {filteredCount === 0 ? (
        <div className="empty-state" style={{ border: '1px solid var(--border-hairline)' }}>
          {allSuggestionsCount === 0 
            ? 'No signals — all products within normal range.' 
            : `No pending ${activeStrategy === 'ai' ? 'AI Advisor' : 'Rule-Based'} suggestions.`}
        </div>
      ) : (
        <div>
          {filteredPricing.map(s => <CompactSuggestionRow key={s._id} item={s} type="pricing" />)}
          {filteredReorder.map(s => <CompactSuggestionRow key={s._id} item={s} type="reorder" />)}
        </div>
      )}
    </div>
  );
}
