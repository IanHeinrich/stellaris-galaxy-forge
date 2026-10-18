import {
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PickSummary } from "../../../generated/PickSummary";
import { pickCard, type CardLine } from "../../../lib/addSystem";
import { placeBeside } from "../../../lib/menuAim";
import { useStarNamedSummary } from "../../useStarClassLabel";
import { MenuItem } from "./MenuItem";
import { useMapChromeStore } from "../../../store/mapChromeStore";
import { MenuSide } from "./menuState";

/** The space between a card and the menu it sits beside. */
const CARD_GAP_PX = 6;

/** A card's title and its labelled lines. */
function CardLines({ title, lines }: { title: string; lines: readonly CardLine[] }) {
  return (
    <>
      <div className="map-tooltip-title">{title}</div>
      {lines.map((line) => (
        <div key={line.label} className="map-tooltip-row">
          <span className="map-tooltip-label">{line.label}</span>
          <span className="map-tooltip-value">{line.text}</span>
        </div>
      ))}
    </>
  );
}

/** What a pick's card says, under its title. */
export function PickCardBody({ title, summary }: { title: string; summary: PickSummary }) {
  const copy = pickCard(useStarNamedSummary(summary), title);
  return (
    <>
      <CardLines title={title} lines={copy.lines} />
      {copy.unique && (
        <div className={copy.unique.warn ? "pick-card-note warn" : "pick-card-note"}>
          {copy.unique.text}
        </div>
      )}
      {copy.clusterSystems && <div className="pick-card-note muted">{copy.clusterSystems}</div>}
      {copy.storyKept && <div className="pick-card-note warn">{copy.storyKept}</div>}
      {copy.missingDlc && <div className="pick-card-note muted">{copy.missingDlc}</div>}
    </>
  );
}

/** What a card shows: a pick's summary, or lines of its own. */
export type CardContent = { summary: PickSummary } | { lines: readonly CardLine[] };

/** A pick's card beside the menu that holds `row`, level with the row, on the side it opened on. */
function PickCard({
  row,
  title,
  content,
}: {
  row: HTMLElement;
  title: string;
  content: CardContent;
}) {
  const side = useContext(MenuSide);
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card) return;
    const menu = row.closest(".context-menu") ?? row;
    setPlace(
      placeBeside(
        menu.getBoundingClientRect(),
        row.getBoundingClientRect().top,
        { width: card.offsetWidth, height: card.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        -CARD_GAP_PX,
        side,
      ),
    );
  }, [row, content, side]);
  return (
    <div
      ref={ref}
      role="tooltip"
      className="map-tooltip pick-card"
      style={place ?? { left: 0, top: 0, visibility: "hidden" }}
    >
      {"summary" in content ? (
        <PickCardBody title={title} summary={content.summary} />
      ) : (
        <CardLines title={title} lines={content.lines} />
      )}
    </div>
  );
}

/**
 * A menu entry that shows its pick's card while it is the menu's active row: the pointer or the
 * focus came to it last. Without a summary or lines yet, it is a plain entry.
 */
export function PickItem({
  run,
  className,
  title,
  summary,
  lines,
  children,
}: {
  run: () => unknown;
  className: string;
  title: string;
  summary?: PickSummary;
  lines?: readonly CardLine[];
  children: ReactNode;
}) {
  const content = useMemo((): CardContent | null => {
    if (summary !== undefined) return { summary };
    return lines !== undefined && lines.length > 0 ? { lines } : null;
  }, [summary, lines]);
  const id = useId();
  const active = useMapChromeStore((s) => s.menuRow);
  const row = active?.card === id ? active.el : null;
  return (
    <div className="pick-item">
      <MenuItem card={id} run={run} className={className}>
        {children}
      </MenuItem>
      {row && content && <PickCard row={row} title={title} content={content} />}
    </div>
  );
}
