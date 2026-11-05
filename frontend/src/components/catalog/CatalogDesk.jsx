import React, { useState, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
} from '@tanstack/react-table';
import {
  Search,
  Filter,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Layers,
  Radio,
  Plus,
  ShoppingCart,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { StockHealthBar } from './StockHealthBar';
import { StatusBadge } from '../common/Badge';
import { ProductDetailDrawer } from './ProductDetailDrawer';
import { TableRowSkeleton } from '../common/Skeleton';
import { useAuth } from '../../context/AuthContext';

export function CatalogDesk({
  products = [],
  loading = false,
  onProductUpdated,
  onOpenLiveStream,
  highlightedRowId = null,
}) {
  const { canReview, openAuthModal } = useAuth();
  const [globalFilter, setGlobalFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sorting, setSorting] = useState([{ id: 'stockLevel', desc: false }]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Filtered dataset
  const filteredData = useMemo(() => {
    return products.filter((p) => {
      if (categoryFilter !== 'ALL' && p.category !== categoryFilter) return false;
      if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
      return true;
    });
  }, [products, categoryFilter, statusFilter]);

  // Define Columns
  const columns = useMemo(
    () => [
      {
        accessorKey: 'sku',
        header: 'SKU',
        cell: (info) => (
          <span className="font-mono-numbers font-bold text-xs text-[var(--accent-primary)]">
            {info.getValue()}
          </span>
        ),
      },
      {
        accessorKey: 'name',
        header: 'Product Name',
        cell: (info) => (
          <div className="font-semibold text-xs text-[var(--text-primary)] truncate max-w-[200px]">
            {info.getValue()}
          </div>
        ),
      },
      {
        accessorKey: 'category',
        header: 'Category',
        cell: (info) => (
          <span className="text-[11px] font-mono-numbers text-[var(--text-secondary)]">
            {info.getValue()}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: (info) => <StatusBadge status={info.getValue()} />,
      },
      {
        accessorKey: 'currentPrice',
        header: 'Price (Margin)',
        cell: (info) => {
          const row = info.row.original;
          const price = info.getValue();
          const margin =
            row.costPrice && price
              ? (((price - row.costPrice) / price) * 100).toFixed(1)
              : null;
          return (
            <div className="font-mono-numbers text-xs leading-tight">
              <span className="font-bold text-[var(--text-primary)]">${price.toFixed(2)}</span>
              {margin && (
                <span className="block text-[10px] text-[var(--text-muted)]">{margin}% GM</span>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: 'stockLevel',
        header: 'Stock Health',
        cell: (info) => {
          const row = info.row.original;
          return (
            <StockHealthBar
              stockLevel={info.getValue()}
              reorderThreshold={row.reorderThreshold}
            />
          );
        },
      },
      {
        accessorKey: 'demandVelocity',
        header: 'Velocity',
        cell: (info) => (
          <span className="font-mono-numbers text-xs font-semibold text-[var(--text-primary)]">
            {info.getValue()}/day
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <div className="text-right">Actions</div>,
        cell: (info) => {
          const p = info.row.original;
          return (
            <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => {
                  setSelectedProduct(p);
                  setIsDrawerOpen(true);
                }}
                className="px-2 py-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[11px] font-medium text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                Inspect
              </button>
              <button
                onClick={() => onOpenLiveStream?.(p)}
                className="p-1 rounded-md border border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100 dark:border-cyan-800/40 dark:bg-cyan-950/40 dark:text-cyan-300 dark:hover:bg-cyan-900/40 transition-colors cursor-pointer"
                title="Stream AI Reasoning"
              >
                <Radio className="w-3.5 h-3.5 text-sky-600 dark:text-cyan-400" />
              </button>
            </div>
          );
        },
      },
    ],
    [onOpenLiveStream]
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    state: {
      globalFilter,
      sorting,
    },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize: 20,
      },
    },
  });

  const categories = ['ALL', 'ELECTRONICS', 'APPAREL', 'HOME', 'BEAUTY', 'GROCERY'];
  const statuses = ['ALL', 'ACTIVE', 'PRICE_REVIEW_PENDING', 'OUT_OF_STOCK'];

  return (
    <div className="h-full flex flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
      
      {/* Top Filter & Search Controls */}
      <div className="p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex flex-wrap items-center justify-between gap-3 shrink-0">
        
        {/* Search Input */}
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-2.5" />
          <input
            type="text"
            value={globalFilter ?? ''}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Search SKU or name..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] font-mono-numbers"
          />
        </div>

        {/* Filters & Row count */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs text-[var(--text-secondary)] font-mono-numbers focus:outline-none cursor-pointer"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                Category: {c}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs text-[var(--text-secondary)] font-mono-numbers focus:outline-none cursor-pointer"
          >
            {statuses.map((s) => (
              <option key={s} value={s}>
                Status: {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>

          <span className="text-[11px] font-mono-numbers text-[var(--text-muted)] ml-2">
            Showing {filteredData.length} of {products.length} products
          </span>
        </div>
      </div>

      {/* TanStack Dense Data Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse">
          {/* Sticky Header */}
          <thead className="sticky top-0 z-10 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] text-[11px] font-mono-numbers font-semibold uppercase tracking-wider text-[var(--text-muted)] shadow-2xs">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sortDir = header.column.getIsSorted();

                  return (
                    <th
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      className={`py-3 px-4 select-none ${canSort ? 'cursor-pointer hover:text-[var(--text-primary)]' : ''}`}
                    >
                      <div className="flex items-center gap-1.5">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && (
                          <span className="text-[var(--text-muted)]">
                            {sortDir === 'asc' ? (
                              <ArrowUp className="w-3 h-3 text-[var(--accent-primary)]" />
                            ) : sortDir === 'desc' ? (
                              <ArrowDown className="w-3 h-3 text-[var(--accent-primary)]" />
                            ) : (
                              <ArrowUpDown className="w-2.5 h-2.5 opacity-40" />
                            )}
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          {/* Table Body */}
          <tbody className="divide-y divide-[var(--border-subtle)] text-xs">
            {loading ? (
              <>
                <TableRowSkeleton />
                <TableRowSkeleton />
                <TableRowSkeleton />
                <TableRowSkeleton />
                <TableRowSkeleton />
              </>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-12 text-[var(--text-muted)]">
                  No catalog products found matching active filters.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => {
                const p = row.original;
                const isHighlighted = p._id === highlightedRowId;

                return (
                  <tr
                    key={row.id}
                    onClick={() => {
                      setSelectedProduct(p);
                      setIsDrawerOpen(true);
                    }}
                    className={`transition-colors cursor-pointer ${
                      isHighlighted
                        ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
                        : 'hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="py-2.5 px-4 whitespace-nowrap">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="p-3 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex items-center justify-between text-xs font-mono-numbers text-[var(--text-muted)] shrink-0">
        <div>
          Page {table.getState().pagination.pageIndex + 1} of{' '}
          {Math.max(1, table.getPageCount())}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="p-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] disabled:opacity-40 cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="p-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] disabled:opacity-40 cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Product Detail & Action Drawer */}
      <ProductDetailDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        product={selectedProduct}
        onProductUpdated={(updated) => {
          setSelectedProduct(updated);
          onProductUpdated?.(updated);
        }}
        onOpenLiveStream={onOpenLiveStream}
      />

    </div>
  );
}

