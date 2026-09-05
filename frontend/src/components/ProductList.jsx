import React, { useState } from 'react';
import { API_BASE } from '../config';

export default function ProductList({ products, onSimulateSale, onUpdateStock, onStreamAI, highlightedRowId }) {
  const [stockInputs, setStockInputs] = useState({});
  const [loadingIds, setLoadingIds] = useState({});

  const handleSimulateSale = async (id) => {
    setLoadingIds(prev => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`${API_BASE}/products/${id}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qty: 1 })
      });
      if (!res.ok) throw new Error('Failed to simulate sale');
      await onSimulateSale();
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingIds(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleUpdateStock = async (id) => {
    const val = parseInt(stockInputs[id], 10);
    if (isNaN(val) || val < 0) return;

    setLoadingIds(prev => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`${API_BASE}/products/${id}/stock`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockLevel: val })
      });
      if (!res.ok) throw new Error('Failed to update stock');
      setStockInputs(prev => ({ ...prev, [id]: '' }));
      await onUpdateStock();
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingIds(prev => ({ ...prev, [id]: false }));
    }
  };

  const calculateMargin = (product) => {
    if (!product.costPrice) return '-';
    const margin = ((product.currentPrice - product.costPrice) / product.currentPrice) * 100;
    return `${margin.toFixed(1)}%`;
  };

  const renderSparkline = (history) => {
    if (!history || history.length < 2) return <span style={{color: 'var(--text-muted)'}}>-</span>;
    const maxPrice = Math.max(...history.map(h => h.price));
    const minPrice = Math.min(...history.map(h => h.price));
    const range = maxPrice - minPrice || 1;
    
    const points = history.map((h, i) => {
      const x = (i / (history.length - 1)) * 60;
      const y = 20 - (((h.price - minPrice) / range) * 20);
      return `${x},${y}`;
    }).join(' ');

    // Use a neutral color unless there is a stark drop
    const startPrice = history[0].price;
    const endPrice = history[history.length - 1].price;
    let strokeColor = 'var(--text-muted)';
    if (endPrice < startPrice * 0.9) strokeColor = 'var(--signal-red)';
    if (endPrice > startPrice * 1.1) strokeColor = 'var(--signal-green)';

    return (
      <svg width="60" height="20" style={{ overflow: 'visible', verticalAlign: 'middle' }}>
        <polyline fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={points} />
      </svg>
    );
  };

  const renderStockHeatmap = (p) => {
    const ratio = p.stockLevel / (p.reorderThreshold || 1);
    let color = 'var(--signal-green)';
    if (ratio <= 1.2) color = 'var(--signal-amber)';
    if (ratio < 1) color = 'var(--signal-red)';
    
    // Cap width at 100%
    const width = Math.min((ratio / 2) * 100, 100);

    return (
      <div style={{ marginTop: '4px', width: '60px', height: '3px', background: 'var(--border-hairline)', borderRadius: '2px', float: 'right' }}>
        <div style={{ height: '100%', width: `${width}%`, background: color, borderRadius: '2px' }} />
      </div>
    );
  };

  return (
    <div className="table-scroll-container">
      <table className="dense-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Name</th>
            <th>Status</th>
            <th className="numeric-col">Price (Margin)</th>
            <th>History</th>
            <th className="numeric-col">Stock</th>
            <th className="numeric-col">Velocity</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {products.map(p => {
            const isHighlighted = p._id === highlightedRowId;
            return (
              <tr key={p._id} className={`${p.stockLevel === 0 ? 'out-of-stock-row' : ''} ${isHighlighted ? 'flash-highlight' : ''}`}>
                <td className="sku-label">{p.sku}</td>
                <td style={{ fontWeight: 500 }}>{p.name}</td>
                <td>
                  <span className={`status-${p.status.toLowerCase()}`}>
                    <span className="status-dot"></span>
                    <span className="status-label">{p.status.replace(/_/g, ' ')}</span>
                  </span>
                </td>
                <td className="numeric" style={{ lineHeight: '1.2' }}>
                  <div>${p.currentPrice.toFixed(2)}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{calculateMargin(p)} GM</div>
                </td>
                <td>{renderSparkline(p.priceHistory)}</td>
                <td className="numeric">
                  <div>{p.stockLevel}</div>
                  {renderStockHeatmap(p)}
                </td>
                <td className="numeric">{p.demandVelocity}</td>
                <td className="actions-cell">
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <input 
                      type="number" 
                      min="1"
                      className="stock-input"
                      placeholder="+"
                      value={stockInputs[p._id] || ''}
                      onChange={(e) => setStockInputs(prev => ({ ...prev, [p._id]: e.target.value }))}
                      style={{ width: '50px', background: 'transparent', border: '1px solid var(--border-hairline)', color: 'var(--text-primary)', padding: '4px', fontFamily: 'var(--font-mono)' }}
                    />
                    <button 
                      className="btn" 
                      onClick={() => handleUpdateStock(p._id)}
                      disabled={loadingIds[p._id] || !stockInputs[p._id]}
                    >
                      Add
                    </button>
                  </div>
                  <button 
                    className="btn" 
                    onClick={() => handleSimulateSale(p._id)}
                    disabled={loadingIds[p._id] || p.stockLevel === 0}
                  >
                    Sale
                  </button>
                  <button 
                    className="btn" 
                    onClick={() => onStreamAI(p._id)}
                    disabled={p.status === 'PRICE_REVIEW_PENDING'}
                    style={{ color: 'var(--signal-blue)', borderColor: 'var(--border-hairline)' }}
                  >
                    Stream AI
                  </button>
                </td>
              </tr>
            );
          })}
          {products.length === 0 && (
            <tr>
              <td colSpan="8" className="empty-state">No products found. (Run seed script)</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
