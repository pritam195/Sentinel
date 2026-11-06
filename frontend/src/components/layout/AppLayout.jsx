import React, { useState, useEffect } from 'react';
import { NavRail } from './NavRail';
import { TopBar } from './TopBar';
import { CommandPalette } from './CommandPalette';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import { LiveReasoningDrawer } from '../stream/LiveReasoningDrawer';
import { LoginModal } from '../auth/LoginModal';
import { ReviewInbox } from '../review/ReviewInbox';
import { CatalogDesk } from '../catalog/CatalogDesk';
import { AdvisorHealthPanel } from '../health/AdvisorHealthPanel';
import { useProducts, useSuggestions, useAdvisorHealth, useStrategyConfig, useLiveStream } from '../../api/hooks';
import { ExternalLink, GitBranch } from 'lucide-react';

export function AppLayout() {
  const [activeTab, setActiveTab] = useState('review'); // 'review' | 'catalog' | 'health'
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isLiveStreamOpen, setIsLiveStreamOpen] = useState(false);
  const [activeTriggerFilter, setActiveTriggerFilter] = useState(null);

  // Global hooks
  const { products, loading: productsLoading, refresh: refreshProducts } = useProducts();
  const { pricingSuggestions, reorderSuggestions } = useSuggestions({ status: 'PENDING' });
  const { breakerState } = useAdvisorHealth();
  const { config, updateStrategy } = useStrategyConfig();
  const liveStream = useLiveStream();

  const handleOpenLiveStreamForProduct = (product) => {
    liveStream.startStream(product);
    setIsLiveStreamOpen(true);
  };

  const handleSelectTriggerFromAlerts = (triggerType) => {
    setActiveTriggerFilter(triggerType);
    setActiveTab('review');
  };

  // Global Keyboard Shortcuts (⌘K / Ctrl+K and ?)
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      } else if (e.key === '?' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
        e.preventDefault();
        setIsShortcutsModalOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      
      {/* 1. Left Nav Rail */}
      <NavRail
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isCollapsed={isNavCollapsed}
        setIsCollapsed={setIsNavCollapsed}
        pendingCount={pricingSuggestions.length + reorderSuggestions.length}
        breakerState={breakerState}
      />

      {/* 2. Main Workstation Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        
        {/* Top App Bar */}
        <TopBar
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          onOpenShortcuts={() => setIsShortcutsModalOpen(true)}
          onOpenStrategyModal={() => setActiveTab('health')}
          strategy={config?.activeStrategy || 'rule-based'}
          breakerState={breakerState}
          pricingSuggestions={pricingSuggestions}
          reorderSuggestions={reorderSuggestions}
          onSelectTrigger={handleSelectTriggerFromAlerts}
        />

        {/* Dynamic Viewport Container */}
        <main className="flex-1 min-h-0 p-4 md:p-6 overflow-hidden">
          {activeTab === 'review' && (
            <ReviewInbox
              onOpenLiveStream={handleOpenLiveStreamForProduct}
              onOpenShortcuts={() => setIsShortcutsModalOpen(true)}
              activeTriggerFilter={activeTriggerFilter}
              onClearTriggerFilter={() => setActiveTriggerFilter(null)}
            />
          )}

          {activeTab === 'catalog' && (
            <CatalogDesk
              products={products}
              loading={productsLoading}
              onProductUpdated={refreshProducts}
              onOpenLiveStream={handleOpenLiveStreamForProduct}
            />
          )}

          {activeTab === 'health' && <AdvisorHealthPanel />}
        </main>

        {/* Deployable Quality Footer */}
        <footer className="h-9 px-6 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between text-[11px] text-[var(--text-muted)] shrink-0">
          <div className="flex items-center gap-2">
            <span>Advisor suggestions are proposals; a human approves every change.</span>
          </div>

          <div className="flex items-center gap-4">
            <span className="font-mono-numbers text-[10px]">v2.1.0 • React 19 + Express 5</span>
            <a
              href="https://github.com/pritam195/Sentinel"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 hover:text-[var(--text-primary)] transition-colors"
            >
              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
              <span>GitHub</span>
            </a>
          </div>
        </footer>

      </div>

      {/* 3. Global Overlays & Drawers */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        products={products}
        onSelectProduct={(p) => handleOpenLiveStreamForProduct(p)}
        onSwitchStrategy={(strat) => updateStrategy({ strategy: strat })}
        strategy={config?.activeStrategy}
      />

      <KeyboardShortcutsModal
        isOpen={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
      />

      <LiveReasoningDrawer
        isOpen={isLiveStreamOpen}
        onClose={() => {
          setIsLiveStreamOpen(false);
          liveStream.clearStream();
        }}
        product={liveStream.activeProduct}
        streamText={liveStream.streamText}
        isStreaming={liveStream.isStreaming}
        streamError={liveStream.streamError}
        streamComplete={liveStream.streamComplete}
        onStop={liveStream.cancelStream}
      />

      <LoginModal />

    </div>
  );
}
