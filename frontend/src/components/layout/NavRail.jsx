import React from 'react';
import {
  Inbox,
  LayoutGrid,
  Activity,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  LogOut,
  User,
  LogIn,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { RoleBadge } from '../common/Badge';

export function NavRail({
  activeTab,
  setActiveTab,
  isCollapsed,
  setIsCollapsed,
  pendingCount = 0,
  breakerState = 'CLOSED',
}) {
  const { user, isLoggedIn, openAuthModal, logout } = useAuth();

  const navItems = [
    {
      id: 'review',
      label: 'Review Queue',
      shortLabel: 'Review',
      icon: Inbox,
      badge: pendingCount > 0 ? pendingCount : null,
      badgeColor: 'bg-[var(--semantic-amber)] text-black',
    },
    {
      id: 'catalog',
      label: 'Catalog Desk',
      shortLabel: 'Catalog',
      icon: LayoutGrid,
    },
    {
      id: 'health',
      label: 'Advisor Health',
      shortLabel: 'Health',
      icon: Activity,
      dotColor:
        breakerState === 'OPEN'
          ? 'bg-rose-500'
          : breakerState === 'HALF_OPEN'
          ? 'bg-amber-400'
          : 'bg-emerald-400',
    },
  ];

  return (
    <>
      {/* Desktop & Tablet Sidebar */}
      <aside
        className={`hidden md:flex flex-col justify-between border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] transition-all duration-200 z-30 shrink-0 ${
          isCollapsed ? 'w-16' : 'w-60'
        }`}
      >
        <div>
          {/* Logo & Brand Header */}
          <div className="h-16 flex items-center justify-between px-4 border-b border-[var(--border-subtle)]">
            <div
              className={`flex items-center gap-3 cursor-pointer ${
                isCollapsed ? 'justify-center w-full' : ''
              }`}
              onClick={() => setActiveTab('review')}
            >
              <div className="w-8 h-8 rounded-lg bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/30 flex items-center justify-center text-[var(--accent-primary)] shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              {!isCollapsed && (
                <div className="leading-tight">
                  <div className="font-bold text-sm text-[var(--text-primary)] tracking-wide">
                    Sentinel
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] tracking-wider uppercase font-mono-numbers">
                    Decision Desk
                  </div>
                </div>
              )}
            </div>

            {!isCollapsed && (
              <button
                onClick={() => setIsCollapsed(true)}
                className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-1.5" aria-label="Main Navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all cursor-pointer relative ${
                    isActive
                      ? 'bg-[var(--accent-glow)] border border-[var(--accent-primary)]/40 text-[var(--text-primary)] font-semibold shadow-xs'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] border border-transparent'
                  } ${isCollapsed ? 'justify-center px-0' : ''}`}
                  title={item.label}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[var(--accent-primary)]' : ''}`} />
                  
                  {!isCollapsed && (
                    <span className="flex-1 text-left truncate">{item.label}</span>
                  )}

                  {/* Badge or Status Dot */}
                  {item.badge && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full font-mono-numbers text-[10px] font-bold ${
                        item.badgeColor
                      } ${isCollapsed ? 'absolute -top-1 -right-1' : ''}`}
                    >
                      {item.badge}
                    </span>
                  )}

                  {item.dotColor && (
                    <span
                      className={`w-2 h-2 rounded-full ${item.dotColor} ${
                        isCollapsed ? 'absolute top-2 right-2' : ''
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Footer Area: Expand Button & User Account */}
        <div className="p-3 border-t border-[var(--border-subtle)] space-y-2">
          {isCollapsed && (
            <button
              onClick={() => setIsCollapsed(false)}
              className="w-full flex items-center justify-center p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}

          {isLoggedIn ? (
            <div
              className={`p-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-center gap-2.5 ${
                isCollapsed ? 'justify-center p-2' : ''
              }`}
            >
              <div className="w-7 h-7 rounded-lg bg-zinc-800 text-[var(--text-primary)] flex items-center justify-center font-bold text-xs shrink-0">
                {user?.name ? user.name[0].toUpperCase() : 'U'}
              </div>

              {!isCollapsed && (
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                    {user?.name || user?.username}
                  </div>
                  <div className="mt-0.5">
                    <RoleBadge role={user?.role} />
                  </div>
                </div>
              )}

              {!isCollapsed && (
                <button
                  onClick={logout}
                  className="p-1 rounded-md text-[var(--text-muted)] hover:text-rose-400 hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                  title="Sign out"
                  aria-label="Sign out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={openAuthModal}
              className={`w-full py-2 px-3 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs text-[var(--accent-primary)] font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                isCollapsed ? 'justify-center px-0' : ''
              }`}
            >
              <LogIn className="w-4 h-4" />
              {!isCollapsed && <span>Sign In</span>}
            </button>
          )}
        </div>
      </aside>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] flex items-center justify-around h-16 px-2 shadow-2xl"
        aria-label="Mobile Navigation"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center justify-center gap-1 flex-1 py-1 text-[10px] font-medium transition-colors cursor-pointer relative ${
                isActive ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'
              }`}
            >
              <div className="relative">
                <Icon className="w-5 h-5" />
                {item.badge && (
                  <span className="absolute -top-1 -right-2 px-1 rounded-full bg-[var(--semantic-amber)] text-black text-[9px] font-bold font-mono-numbers">
                    {item.badge}
                  </span>
                )}
                {item.dotColor && (
                  <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${item.dotColor}`} />
                )}
              </div>
              <span>{item.shortLabel}</span>
            </button>
          );
        })}

        <button
          onClick={openAuthModal}
          className="flex flex-col items-center justify-center gap-1 flex-1 py-1 text-[10px] text-[var(--text-muted)] cursor-pointer"
        >
          <User className="w-5 h-5" />
          <span>{isLoggedIn ? (user?.role || 'User') : 'Login'}</span>
        </button>
      </nav>
    </>
  );
}
