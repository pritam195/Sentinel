import React, { useMemo } from 'react';

export default function TickerStrip({ pricingSuggestions, reorderSuggestions }) {
  // Combine, sort by newest, take top 10
  const recentTriggers = useMemo(() => {
    const all = [...(pricingSuggestions || []), ...(reorderSuggestions || [])];
    return all.slice(0, 10);
  }, [pricingSuggestions, reorderSuggestions]);

  if (recentTriggers.length === 0) {
    return (
      <div className="ticker-strip">
        <div style={{ paddingLeft: '16px' }}>SYSTEM HEALTHY — NO PENDING ALERTS</div>
      </div>
    );
  }

  return (
    <div className="ticker-strip">
      <div className="ticker-content">
        {recentTriggers.map((t, i) => (
          <div key={`${t._id}-${i}`} className="ticker-item">
            <div className={`ticker-signal ${t.triggerReason.toLowerCase()}`}></div>
            <span>{t.productId?.name || 'Unknown Item'}: {t.triggerReason.replace('_', ' ')} detected</span>
          </div>
        ))}
        {/* Duplicate for infinite loop effect */}
        {recentTriggers.map((t, i) => (
          <div key={`dup-${t._id}-${i}`} className="ticker-item">
            <div className={`ticker-signal ${t.triggerReason.toLowerCase()}`}></div>
            <span>{t.productId?.name || 'Unknown Item'}: {t.triggerReason.replace('_', ' ')} detected</span>
          </div>
        ))}
      </div>
    </div>
  );
}
