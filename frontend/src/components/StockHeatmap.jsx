import React from 'react';

function StockHeatmap({ products }) {
  return (
    <div className="glass-panel" style={{ marginBottom: '20px', padding: '15px' }}>
      <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#8892b0' }}>Stock Heatmap</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(20px, 1fr))', gap: '4px' }}>
        {products.map(p => {
          let color = '#238636'; // healthy green
          const ratio = p.stockLevel / p.reorderThreshold;
          if (p.stockLevel === 0) color = '#da3633'; // out of stock red
          else if (ratio <= 1.2) color = '#d29922'; // low orange

          return (
            <div 
              key={p._id} 
              title={`${p.name}: ${p.stockLevel} units`}
              style={{
                height: '20px',
                backgroundColor: color,
                borderRadius: '2px',
                cursor: 'help'
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

export default StockHeatmap;
