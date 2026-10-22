'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** One line in a row's menu. `href` opens a link in a new tab instead of running `onSelect`. */
export type RowMenuItem = {
  label: string;
  onSelect?: () => void;
  href?: string;
  /** Shown checked (e.g. "Pinned") */
  on?: boolean;
  danger?: boolean;
  hidden?: boolean;
};

const LONG_PRESS_MS = 480;

/** React bubbles portal events through the tree: ignore ones from the open menu itself. */
const inside = (e: React.SyntheticEvent) => (e.currentTarget as Node).contains(e.target as Node);
const MOVE_SLOP = 10;

/** The page zoom (ZoomControl sets it on <html>): pointer coordinates are unzoomed, fixed boxes are zoomed. */
function pageZoom() {
  const z = parseFloat(getComputedStyle(document.documentElement).zoom || '1');
  return Number.isFinite(z) && z > 0 ? z : 1;
}

/**
 * Randy's rule (2026-10-22 markup): a row shows its text and one small primary action; everything
 * else lives here — right-click on a Mac, long-press on the iPad. Spread `bind` onto the row.
 */
export function useRowMenu(items: RowMenuItem[] | (() => RowMenuItem[]), title?: string) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  const open = useCallback((x: number, y: number) => setAt({ x, y }), []);

  const bind = {
    onContextMenu: (e: React.MouseEvent) => {
      if (!inside(e)) return;
      e.preventDefault();
      e.stopPropagation();
      clear();
      open(e.clientX, e.clientY);
    },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' || !inside(e)) return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      const { clientX, clientY } = e;
      timer.current = window.setTimeout(() => {
        fired.current = true;
        timer.current = null;
        open(clientX, clientY);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_SLOP) clear();
    },
    onPointerUp: () => {
      clear();
      if (fired.current) window.setTimeout(() => (fired.current = false), 450);
    },
    onPointerCancel: clear,
    // A long-press must not also tap the row's button underneath
    onClickCapture: (e: React.MouseEvent) => {
      if (!fired.current || !inside(e)) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
    'data-row-menu': '',
  };

  const list = at ? (typeof items === 'function' ? items() : items).filter(i => !i.hidden) : [];
  const menu = at && list.length ? <RowMenuPop at={at} items={list} title={title} onClose={() => setAt(null)} /> : null;
  return { bind, menu, open: (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const z = pageZoom();
    open(r.left * z, r.bottom * z);
  } };
}

function RowMenuPop({ at, items, title, onClose }: { at: { x: number; y: number }; items: RowMenuItem[]; title?: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const z = pageZoom();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth / z;
    const vh = window.innerHeight / z;
    let left = at.x / z;
    let top = at.y / z + 4;
    if (left + w > vw - 8) left = Math.max(8, vw - w - 8);
    if (top + h > vh - 8) top = Math.max(8, at.y / z - h - 4);
    setPos({ left, top });
    el.querySelector<HTMLElement>('button, a')?.focus({ preventScroll: true });
  }, [at]);

  useEffect(() => {
    const away = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const host = document.querySelector('.frontier-shell') || document.body;
  return createPortal(
    <div
      ref={ref}
      className="row-menu"
      role="menu"
      aria-label={title || 'Actions'}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
      onContextMenu={e => e.preventDefault()}
    >
      {title ? <div className="row-menu-title">{title}</div> : null}
      {items.map(i =>
        i.href ? (
          <a key={i.label} role="menuitem" className="row-menu-item" href={i.href} target="_blank" rel="noopener noreferrer" onClick={onClose}>
            {i.label}
          </a>
        ) : (
          <button
            key={i.label}
            type="button"
            role={i.on === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={i.on}
            className={`row-menu-item${i.danger ? ' is-danger' : ''}${i.on ? ' is-on' : ''}`}
            onClick={() => {
              onClose();
              i.onSelect?.();
            }}
          >
            {i.label}
          </button>
        ),
      )}
    </div>,
    host,
  );
}

/** Wrap a row (an <li> or <div>) so right-click / long-press opens its menu. */
export function MenuRow({
  as: Tag = 'div',
  items,
  title,
  className,
  style,
  dragProps,
  children,
}: {
  as?: 'div' | 'li';
  items: RowMenuItem[] | (() => RowMenuItem[]);
  title?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Extra props for the row element (e.g. drag-and-drop handlers) */
  dragProps?: React.HTMLAttributes<HTMLElement> & { draggable?: boolean };
  children: ReactNode;
}) {
  const { bind, menu } = useRowMenu(items, title);
  return (
    <Tag className={className} style={style} {...dragProps} {...bind}>
      {children}
      {menu}
    </Tag>
  );
}
