import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  effectSummary,
  PICKER_CARD_WIDTH,
  pickerCardPlace,
  visibleSpan,
  type Span,
} from "../../../lib/details/picker";

export const NO_DESCRIPTION = "No description";
export const NO_EFFECT = "No effect";

/** What a card shows of a row. */
export interface CardItem {
  label: string;
  /** What it gives, a line each; empty for nothing. */
  effects: readonly string[];
  /** What kind of thing it is, under its name. */
  category?: string;
  /** A line under its effects, such as how long it lasts. */
  note?: string;
  /** What it says under its effects; `null` says there is none, and without it the card leaves it out. */
  description?: string | null;
}

/** A row's first effects, and how many more the card lists. */
export function EffectSummary({ effects }: { effects: readonly string[] }) {
  const { shown, more } = effectSummary(effects);
  if (shown === "") return <span className="muted">{NO_EFFECT}</span>;
  return (
    <span>
      {shown}
      {more !== null && <span className="muted dp-more"> {more}</span>}
    </span>
  );
}

/**
 * What the card says of a row: its name, its category, every effect, its note, then its
 * description where it has a place for one.
 */
function PickerCardBody({ item }: { item: CardItem }) {
  return (
    <>
      <span className="dp-card-name">{item.label}</span>
      {item.category !== undefined && (
        <span className="dp-card-category muted">{item.category}</span>
      )}
      {item.effects.length > 0 && (
        <ul className="dp-card-effects">
          {item.effects.map((effect, i) => (
            <li key={i}>{effect}</li>
          ))}
        </ul>
      )}
      {item.note !== undefined && <span className="dp-card-note muted">{item.note}</span>}
      {item.description !== undefined && (
        <span className="dp-card-text">
          {item.description === null ? (
            <span className="muted">{NO_DESCRIPTION}</span>
          ) : (
            item.description
          )}
        </span>
      )}
    </>
  );
}

/**
 * Where the card stands: in the window beside the element that holds it, out of sight while its
 * row is scrolled away, or in place under it.
 */
type CardPlace = { left: number; top: number } | "hidden" | "under";

/** The boxes `el` scrolls in, nearest first. */
function scrollingBoxes(el: HTMLElement): Span[] {
  const boxes: Span[] = [];
  for (let at = el.parentElement; at !== null; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === "auto" || overflowY === "scroll") boxes.push(at.getBoundingClientRect());
  }
  return boxes;
}

/** Where a card of `height` goes beside `box`, level with what shows of `row`. */
function placeCard(box: HTMLElement, row: HTMLElement, height: number): CardPlace {
  const shown = visibleSpan(row.getBoundingClientRect(), scrollingBoxes(row));
  const place = pickerCardPlace(
    box.getBoundingClientRect(),
    shown?.top ?? 0,
    height,
    window.innerHeight,
  );
  if (place === null) return "under";
  return shown === null ? "hidden" : place;
}

/**
 * The card's ref, and its place beside the element that holds it, level with what shows of the row
 * `rowId` names:
 * measured again as the row, what it shows or its place changes, and as the window resizes or
 * anything in it scrolls; `null` until it is measured.
 */
function useCardPlace(
  rowId: string,
  item: CardItem,
): [RefObject<HTMLDivElement | null>, CardPlace | null] {
  const card = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CardPlace | null>(null);
  const [moved, setMoved] = useState(0);
  useEffect(() => {
    const move = () => setMoved((n) => n + 1);
    window.addEventListener("resize", move);
    window.addEventListener("scroll", move, true);
    return () => {
      window.removeEventListener("resize", move);
      window.removeEventListener("scroll", move, true);
    };
  }, []);
  const under = place === "under";
  useLayoutEffect(() => {
    const el = card.current;
    const box = el?.parentElement ?? null;
    const row = document.getElementById(rowId);
    if (el === null || box === null || row === null) return;
    setPlace(placeCard(box, row, el.offsetHeight));
  }, [rowId, item, moved, under]);
  return [card, place];
}

/**
 * A row's card, left of the element that holds it, over the map and level with the row `rowId`
 * names. Where the window has no room there, it shows in place at a fixed height. `children` go
 * after what the card says of the row, and a new `item` measures it again.
 */
export function PickerCard({
  id,
  item,
  rowId,
  children,
}: {
  id: string;
  item: CardItem;
  rowId: string;
  children?: ReactNode;
}) {
  const [card, place] = useCardPlace(rowId, item);
  const under = place === "under";
  return (
    <div
      id={id}
      ref={card}
      className={under ? "dp-card under" : "dp-card"}
      style={
        under
          ? undefined
          : {
              width: PICKER_CARD_WIDTH,
              ...(place === null || place === "hidden"
                ? { left: 0, top: 0, visibility: "hidden" }
                : place),
            }
      }
    >
      <PickerCardBody item={item} />
      {children}
    </div>
  );
}
