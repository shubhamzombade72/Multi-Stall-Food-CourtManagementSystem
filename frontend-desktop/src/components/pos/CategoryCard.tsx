import React, { memo, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, GripVertical, Plus, UtensilsCrossed } from 'lucide-react';
import { CARD_PREVIEW_ROWS, CategoryCard as CardData, menuImageUrl } from '../../lib/posCatalog';
import { apiClient } from '../../api/client';

/** The fields of a dish this card reads. The dish object itself is handed back untouched to `onAdd`. */
export interface CardDish {
  id: number;
  stall_id: number;
  name: string;
  price: string;
  is_veg: boolean;
  is_available: boolean;
  image_url?: string | null;
  stall: { id: number; name: string; code?: string | null };
  category: { id: number; name: string };
}

// Full class names, so Tailwind keeps them. Cycled by card position: neighbouring cards never share a colour.
const ACCENTS = ['border-l-primary', 'border-l-info-fg', 'border-l-success-fg', 'border-l-warning-fg', 'border-l-st-cooking', 'border-l-st-kitchen'];

const ROW_HEIGHT = 44; // px, one dish row; used only to size a card before its rows are drawn

/** A small dish photo, or a plain tile when the photo cannot load. Only drawn for rows on screen, and lazily. */
const Thumb: React.FC<{ url?: string | null }> = ({ url }) => {
  const [failed, setFailed] = useState(false);
  const src = menuImageUrl(url, apiClient.defaults.baseURL);
  if (src && !failed) {
    return <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className="w-8 h-8 rounded-md object-cover border border-line shrink-0" />;
  }
  return (
    <span className="w-8 h-8 rounded-md bg-surface-2 flex items-center justify-center shrink-0" aria-hidden>
      <UtensilsCrossed className="w-4 h-4 text-subtle" />
    </span>
  );
};

interface Props<T extends CardDish> {
  card: CardData<T>;
  index: number;
  /** Quantity of each dish already in the cart, by dish id. */
  cartQty: Map<number, number>;
  expanded: boolean;
  /** Search or a single picked category: every matching dish is shown, nothing to open. */
  showAll: boolean;
  /** All Stalls with more than one stall: say whose dishes these are (once in the header, or per row on a mixed card). */
  showStall: boolean;
  onAdd: (dish: T) => void;
  onToggle: (key: string) => void;
  scrollRoot: React.RefObject<HTMLElement>;
  /** Folded to its header by the cashier (ignored while searching, so a match is never hidden). */
  collapsed: boolean;
  onCollapse: (key: string) => void;
  /** Card layout actions; the parent works out where a dragged card lands. */
  dragging: boolean;
  dropMark: 'before' | 'after' | null;
  onDragStart: (key: string) => void;
  onDragOverCard: (key: string, place: 'before' | 'after') => void;
  onDropCard: (key: string, place: 'before' | 'after') => void;
  onDragEnd: () => void;
  onStep: (key: string, delta: -1 | 1) => void;
}

function CategoryCardView<T extends CardDish>({
  card, index, cartQty, expanded, showAll, showStall, onAdd, onToggle, scrollRoot,
  collapsed, onCollapse, dragging, dropMark, onDragStart, onDragOverCard, onDropCard, onDragEnd, onStep,
}: Props<T>) {
  const folded = collapsed && !showAll;
  const total = card.items.length;
  const rowStall = showStall && card.multiStall; // several stalls on one card: each row names its own
  const headerStall = showStall && !card.multiStall ? card.items[0]?.stall.name : null;
  const open = showAll || expanded || total <= CARD_PREVIEW_ROWS;
  const rows = open ? card.items : card.items.slice(0, CARD_PREVIEW_ROWS);
  const hidden = total - rows.length;
  const withPhotos = rows.some((d) => !!d.image_url);
  const wide = !folded && open && total > CARD_PREVIEW_ROWS * 2; // a long open menu spreads across the row instead of one tall column

  // Rows are drawn only once the card is near the visible part of the list. With 100+ categories most cards stay a
  // header and an empty box of the right height until the cashier scrolls to them; once drawn they stay drawn.
  const box = useRef<HTMLElement>(null);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    if (drawn) return;
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setDrawn(true);
      return;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setDrawn(true), {
      root: scrollRoot.current,
      rootMargin: '600px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [drawn, scrollRoot]);

  const inCart = card.items.reduce((sum, d) => sum + (cartQty.get(d.id) ?? 0), 0);

  // Left half of the card drops before it, right half after it: matches how the grid reads, left to right
  const placeFor = (e: React.DragEvent<HTMLElement>): 'before' | 'after' => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? 'before' : 'after';
  };
  const onHeaderKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
      e.preventDefault();
      onStep(card.key, e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
      requestAnimationFrame(() => (e.target as HTMLElement).focus());
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onCollapse(card.key);
    }
  };

  return (
    <section
      ref={box}
      data-category-card={card.key}
      data-category-name={card.name}
      data-collapsed={folded ? 'true' : 'false'}
      aria-label={`${card.name}, ${total} dish${total === 1 ? '' : 'es'}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        onDragOverCard(card.key, placeFor(e));
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropCard(card.key, placeFor(e));
      }}
      className={`relative flex flex-col min-w-0 rounded-lg border border-line border-l-4 ${ACCENTS[index % ACCENTS.length]} bg-surface shadow-sm transition-opacity ${
        wide ? 'col-span-full' : ''
      } ${folded ? 'self-start' : ''} ${dragging ? 'opacity-40' : ''}`}
    >
      {dropMark && (
        <span
          aria-hidden
          className={`absolute top-0 bottom-0 w-1 rounded-full bg-primary z-10 ${dropMark === 'before' ? '-left-2.5' : '-right-2'}`}
        />
      )}
      <header
        role="button"
        tabIndex={0}
        draggable
        aria-expanded={!folded}
        data-card-header={card.key}
        title="Click to fold or open · drag to move · Alt + arrow keys to move"
        onClick={() => onCollapse(card.key)}
        onKeyDown={onHeaderKey}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', card.key);
          const box = e.currentTarget.parentElement;
          if (box) e.dataTransfer.setDragImage(box, 24, 20);
          onDragStart(card.key);
        }}
        onDragEnd={onDragEnd}
        className={`flex items-center gap-2 pl-1.5 pr-3 py-2 bg-surface-2/60 cursor-pointer select-none hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
          folded ? 'rounded-r-lg' : 'border-b border-line rounded-tr-lg'
        }`}
      >
        <GripVertical className="w-4 h-4 text-subtle shrink-0 cursor-grab" aria-hidden />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-extrabold text-fg leading-tight line-clamp-2 break-words" title={card.name}>
            {card.name}
          </h3>
          {headerStall && (
            <p data-card-stall className="text-[10px] font-semibold text-primary truncate" title={headerStall}>
              {headerStall}
            </p>
          )}
        </div>
        {inCart > 0 && (
          <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-primary/15 text-primary text-[10px] font-bold" title="Already in the cart from this category">
            {inCart} in cart
          </span>
        )}
        <span data-category-count className="shrink-0 px-1.5 py-0.5 rounded-md bg-surface text-muted text-[10px] font-bold border border-line">
          {total} dish{total === 1 ? '' : 'es'}
        </span>
        {folded ? <ChevronRight className="w-4 h-4 text-muted shrink-0" aria-hidden /> : <ChevronDown className="w-4 h-4 text-muted shrink-0" aria-hidden />}
      </header>

      {folded ? null : drawn ? (
        <ul className={`p-1.5 ${wide ? 'grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-x-2' : 'flex flex-col'}`}>
          {rows.map((dish) => {
            const qty = cartQty.get(dish.id) ?? 0;
            const price = `₹${Number(dish.price).toFixed(2)}`;
            const unavailable = !dish.is_available;
            return (
              <li key={dish.id} className="min-w-0">
                <button
                  type="button"
                  disabled={unavailable}
                  onClick={() => onAdd(dish)}
                  data-menu-item={dish.name}
                  data-dish-id={dish.id}
                  data-stall-id={dish.stall_id}
                  data-category-key={card.key}
                  aria-label={`Add ${dish.name}, ${price}${rowStall ? `, ${dish.stall.name}` : ''}${unavailable ? ' (unavailable)' : ''}`}
                  title={`${dish.name} · ${price}${rowStall ? ` · ${dish.stall.name}` : ''}`}
                  className="group w-full min-h-[40px] flex items-center gap-2 px-1.5 py-1 rounded-md text-left transition hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  {withPhotos && <Thumb url={dish.image_url} />}
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${dish.is_veg ? 'bg-success-fg' : 'bg-danger'}`}
                    title={dish.is_veg ? 'Vegetarian' : 'Non-Vegetarian'}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="text-[13px] font-semibold text-fg leading-snug line-clamp-2 break-words group-hover:text-primary">{dish.name}</span>
                    {(rowStall || unavailable) && (
                      <span className="block text-[10px] leading-tight truncate">
                        {rowStall && <span className="text-primary font-semibold">{dish.stall.name}</span>}
                        {unavailable && <span className="text-danger font-semibold">{rowStall ? ' · ' : ''}Unavailable</span>}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-[13px] font-extrabold text-fg tabular-nums">{price}</span>
                  {qty > 0 ? (
                    <span data-cart-qty className="shrink-0 min-w-[1.75rem] h-7 px-1 rounded-md bg-primary text-primary-fg text-xs font-bold flex items-center justify-center">
                      ×{qty}
                    </span>
                  ) : (
                    <span className="shrink-0 w-7 h-7 rounded-md bg-surface-2 text-muted group-hover:bg-primary group-hover:text-primary-fg flex items-center justify-center transition" aria-hidden>
                      <Plus className="w-4 h-4" />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div aria-hidden style={{ height: rows.length * ROW_HEIGHT + 12 }} />
      )}

      {!folded && !showAll && total > CARD_PREVIEW_ROWS && (
        <button
          type="button"
          data-card-toggle={card.key}
          aria-expanded={expanded}
          onClick={() => onToggle(card.key)}
          className="mt-auto flex items-center justify-center gap-1 px-3 py-1.5 border-t border-line text-[11px] font-bold text-primary hover:bg-surface-2 rounded-b-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" /> Show fewer
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" /> Show all {total} ({hidden} more)
            </>
          )}
        </button>
      )}
    </section>
  );
}

/** Redraw a card only when its own dishes, their cart quantities or its open state change, not on every cart change. */
const sameCard = <T extends CardDish>(a: Props<T>, b: Props<T>) =>
  a.card === b.card &&
  a.index === b.index &&
  a.expanded === b.expanded &&
  a.showAll === b.showAll &&
  a.showStall === b.showStall &&
  a.onAdd === b.onAdd &&
  a.onToggle === b.onToggle &&
  a.collapsed === b.collapsed &&
  a.dragging === b.dragging &&
  a.dropMark === b.dropMark &&
  a.onCollapse === b.onCollapse &&
  a.onStep === b.onStep &&
  a.card.items.every((d) => a.cartQty.get(d.id) === b.cartQty.get(d.id));

export const CategoryCard = memo(CategoryCardView, sameCard) as typeof CategoryCardView;
