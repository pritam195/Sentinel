import React, { useState } from 'react';
import {
  Drawer,
} from '../common/Modal';
import {
  Package,
  DollarSign,
  TrendingUp,
  Radio,
  Plus,
  Minus,
  ShoppingCart,
  Clock,
  Sparkles,
  ShieldAlert,
} from 'lucide-react';
import { StatusBadge } from '../common/Badge';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { api } from '../../api/client';

export function ProductDetailDrawer({
  isOpen,
  onClose,
  product,
  onProductUpdated,
  onOpenLiveStream,
}) {
  const { canReview, openAuthModal, role, token } = useAuth();
  const toast = useToast();

  const [stockDelta, setStockDelta] = useState(5);
  const [targetStock, setTargetStock] = useState('');
  const [orderQty, setOrderQty] = useState(1);
  const [editPrice, setEditPrice] = useState('');
  const [editCost, setEditCost] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  if (!product) return null;

  // Margin calculation
  const marginPct =
    product.costPrice && product.currentPrice
      ? (((product.currentPrice - product.costPrice) / product.currentPrice) * 100).toFixed(1)
      : null;

  const handleAdjustStock = async (delta) => {
    if (!canReview) {
      openAuthModal();
      return;
    }
    setActionLoading(true);
    try {
      const updated = await api.products.updateStock(
        product._id,
        { delta },
        token
      );
      toast.success(
        `Adjusted stock by ${delta > 0 ? '+' : ''}${delta} units (New total: ${updated.stockLevel}).`,
        'Inventory Updated'
      );
      onProductUpdated?.(updated);
    } catch (err) {
      toast.error(err.message, 'Stock Adjustment Failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSetStock = async (e) => {
    e.preventDefault();
    const val = parseInt(targetStock, 10);
    if (isNaN(val) || val < 0) return;

    if (!canReview) {
      openAuthModal();
      return;
    }
    setActionLoading(true);
    try {
      const updated = await api.products.updateStock(
        product._id,
        { stockLevel: val },
        token
      );
      toast.success(`Inventory stock level set to ${val} units.`, 'Stock Level Set');
      setTargetStock('');
      onProductUpdated?.(updated);
    } catch (err) {
      toast.error(err.message, 'Update Failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSimulateOrder = async (qtyToOrder) => {
    setActionLoading(true);
    try {
      const updated = await api.products.createOrder(product._id, { qty: qtyToOrder });
      toast.success(
        `Simulated purchase of ${qtyToOrder} unit(s). Demand velocity updated.`,
        'Order Dispatched'
      );
      onProductUpdated?.(updated);
    } catch (err) {
      toast.error(err.message, 'Purchase Simulation Failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdatePrice = async (e) => {
    e.preventDefault();
    if (!canReview) {
      openAuthModal();
      return;
    }

    const payload = {};
    if (editPrice) {
      const p = parseFloat(editPrice);
      if (!isNaN(p) && p > 0) payload.currentPrice = p;
    }
    if (editCost) {
      const c = parseFloat(editCost);
      if (!isNaN(c) && c >= 0) payload.costPrice = c;
    }

    if (Object.keys(payload).length === 0) {
      toast.warning('Provide a valid retail price or unit cost');
      return;
    }

    setActionLoading(true);
    try {
      const updated = await api.products.updatePrice(product._id, payload, token);
      toast.success(
        `Updated financials. priceVersion incremented to v${updated.priceVersion}.`,
        'Catalog Price Updated'
      );
      setEditPrice('');
      setEditCost('');
      onProductUpdated?.(updated);
    } catch (err) {
      toast.error(err.message, 'Price Update Failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSuggestReorder = async () => {
    if (!canReview) {
      openAuthModal();
      return;
    }
    setActionLoading(true);
    try {
      await api.products.suggestReorder(product._id, token);
      toast.success(
        'Replenishment proposal drafted and routed to Human-in-the-Loop review queue.',
        'Reorder Drafted'
      );
      onClose();
    } catch (err) {
      toast.error(err.message, 'Proposal Request Failed');
    } finally {
      setActionLoading(false);
    }
  };

  const hasPriceHistory = Boolean(product.priceHistory && product.priceHistory.length > 0);

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={product.name}
      subtitle={`SKU: ${product.sku} | Category: ${product.category}`}
      width="max-w-xl"
    >
      <div className="space-y-6 text-[var(--text-primary)]">
        
        {/* Status & Version Header */}
        <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusBadge status={product.status} />
            <span className="text-xs font-mono-numbers text-[var(--text-muted)]">
              v{product.priceVersion || 1}
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono-numbers">
            <div>
              <span className="text-[10px] text-[var(--text-muted)] block">Retail Price</span>
              <span className="text-sm font-bold text-[var(--text-primary)]">
                ${product.currentPrice.toFixed(2)}
              </span>
            </div>
            {marginPct && (
              <div>
                <span className="text-[10px] text-[var(--text-muted)] block">Gross Margin</span>
                <span className="text-sm font-bold text-emerald-400">{marginPct}%</span>
              </div>
            )}
          </div>
        </div>

        {/* Action 1: Inventory Stepper & Stock Adjustment */}
        <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Inventory Controls (Labeled Steppers)
            </span>
            <span className="text-xs font-mono-numbers text-[var(--text-muted)]">
              Current: <strong className="text-[var(--text-primary)]">{product.stockLevel}</strong> units
            </span>
          </div>

          {/* Stepper Delta Buttons */}
          <div className="grid grid-cols-4 gap-2">
            <button
              onClick={() => handleAdjustStock(1)}
              disabled={actionLoading || !canReview}
              className="py-2 px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-xs font-mono-numbers font-semibold text-emerald-400 transition-colors cursor-pointer disabled:opacity-50"
            >
              +1 Stock
            </button>
            <button
              onClick={() => handleAdjustStock(5)}
              disabled={actionLoading || !canReview}
              className="py-2 px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-xs font-mono-numbers font-semibold text-emerald-400 transition-colors cursor-pointer disabled:opacity-50"
            >
              +5 Stock
            </button>
            <button
              onClick={() => handleAdjustStock(10)}
              disabled={actionLoading || !canReview}
              className="py-2 px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-xs font-mono-numbers font-semibold text-emerald-400 transition-colors cursor-pointer disabled:opacity-50"
            >
              +10 Stock
            </button>
            <button
              onClick={() => handleAdjustStock(-1)}
              disabled={actionLoading || !canReview || product.stockLevel <= 0}
              className="py-2 px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-xs font-mono-numbers font-semibold text-rose-400 transition-colors cursor-pointer disabled:opacity-50"
            >
              -1 Stock
            </button>
          </div>

          {/* Set Exact Stock Input Form */}
          <form onSubmit={handleSetStock} className="flex gap-2 pt-1">
            <input
              type="number"
              min="0"
              value={targetStock}
              onChange={(e) => setTargetStock(e.target.value)}
              placeholder="Set exact on-hand units..."
              className="flex-1 px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-mono-numbers text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
            />
            <button
              type="submit"
              disabled={actionLoading || !targetStock || !canReview}
              className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-medium cursor-pointer disabled:opacity-50"
            >
              Set Level
            </button>
          </form>
        </div>

        {/* Action 2: Simulate Customer Order */}
        <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Simulate Purchase Event
            </span>
            <span className="text-xs font-mono-numbers text-[var(--text-muted)]">
              Velocity: {product.demandVelocity} / day
            </span>
          </div>

          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Dispatching customer orders decreases inventory and increments demand velocity telemetry, triggering autonomous threshold alerts.
          </p>

          <div className="flex gap-2">
            <button
              onClick={() => handleSimulateOrder(1)}
              disabled={actionLoading || product.stockLevel < 1}
              className="flex-1 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>Buy 1 Unit</span>
            </button>
            <button
              onClick={() => handleSimulateOrder(2)}
              disabled={actionLoading || product.stockLevel < 2}
              className="flex-1 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>Buy 2 Units</span>
            </button>
            <button
              onClick={() => handleSimulateOrder(5)}
              disabled={actionLoading || product.stockLevel < 5}
              className="flex-1 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>Buy 5 Units</span>
            </button>
          </div>
        </div>

        {/* Action 3: Price & Cost Mutation Form */}
        <form onSubmit={handleUpdatePrice} className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Direct Price & Cost Revision
            </span>
            <span className="text-[10px] font-mono-numbers text-[var(--text-muted)]">
              Increments priceVersion
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-[var(--text-muted)] block mb-1">New Retail Price ($)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={editPrice}
                onChange={(e) => setEditPrice(e.target.value)}
                placeholder={`Current: $${product.currentPrice.toFixed(2)}`}
                className="w-full px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-mono-numbers text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
              />
            </div>
            <div>
              <label className="text-[11px] text-[var(--text-muted)] block mb-1">Unit Cost Price ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={editCost}
                onChange={(e) => setEditCost(e.target.value)}
                placeholder={product.costPrice ? `Current: $${product.costPrice.toFixed(2)}` : 'Set cost...'}
                className="w-full px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-mono-numbers text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={actionLoading || (!editPrice && !editCost) || !canReview}
            className="w-full py-2 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] cursor-pointer disabled:opacity-50"
          >
            Apply Financial Revision
          </button>
        </form>

        {/* Action 4: Trigger On-Demand AI Recommendations */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => {
              onClose();
              onOpenLiveStream?.(product);
            }}
            className="py-2.5 px-3 rounded-xl border border-cyan-800/40 bg-cyan-950/40 hover:bg-cyan-900/50 text-cyan-300 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Radio className="w-4 h-4 text-cyan-400 animate-pulse" />
            <span>Stream AI Pricing</span>
          </button>

          <button
            onClick={handleSuggestReorder}
            disabled={actionLoading || !canReview}
            className="py-2.5 px-3 rounded-xl border border-indigo-800/40 bg-indigo-950/40 hover:bg-indigo-900/50 text-indigo-300 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Package className="w-4 h-4 text-indigo-400" />
            <span>Propose Replenishment</span>
          </button>
        </div>

        {/* Price History Timeline (Shown ONLY when real priceHistory records exist) */}
        {hasPriceHistory && (
          <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] block">
              Audited Price History
            </span>
            <div className="divide-y divide-[var(--border-subtle)] max-h-40 overflow-y-auto">
              {product.priceHistory.map((h, i) => (
                <div key={i} className="py-2 flex items-center justify-between text-xs font-mono-numbers">
                  <div>
                    <span className="font-bold text-[var(--text-primary)]">${h.price.toFixed(2)}</span>
                    {h.changedBy && (
                      <span className="ml-2 text-[10px] text-[var(--text-muted)]">by {h.changedBy}</span>
                    )}
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {h.date ? new Date(h.date).toLocaleDateString() : 'Baseline'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </Drawer>
  );
}
