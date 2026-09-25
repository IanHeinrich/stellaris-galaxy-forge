import {
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import type { PickSummary } from "../../../generated/PickSummary";
import { pickCard } from "../../../lib/addSystem";
import { placeBeside } from "../../../lib/menuAim";
import { MenuItem } from "./MenuItem";
import { MenuSide } from "./menuState";

/** The space between a card and the menu it sits beside. */
const CARD_GAP_PX = 6;

/** What a pick's card says, under its title. */
export function PickCardBody({ title, summary }: { title: string; summary: PickSummary }) {
  const copy = pickCard(summary);
  return (
    <>
      <div className="map-tooltip-title">{title}</div>
      {copy.lines.map((line) => (
        <div key={line.label} className="map-tooltip-row">
          <span className="map-tooltip-label">{line.label}</span>
          <span className="map-tooltip-value">{line.text}</span>
        </div>
      ))}
      {copy.unique && (
        <div className={copy.unique.warn ? "pick-card-note warn" : "pick-card-note"}>
          {copy.unique.text}
        </div>
      )}
      {copy.missingDlc && <div className="pick-card-note muted">{copy.missingDlc}</div>}
    </>
  );
}

/** A pick's card beside the menu that holds `row`, level with the row, on the side it opened on. */
function PickCard({
  row,
  title,
  summary,
}: {
  row: HTMLElement;
  title: string;
  summary: PickSummary;
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
  }, [row, summary, side]);
  return (
    <div
      ref={ref}
      role="tooltip"
      className="map-tooltip pick-card"
      style={place ?? { left: 0, top: 0, visibility: "hidden" }}
    >
      <PickCardBody title={title} summary={summary} />
    </div>
  );
}

/**
 * A menu entry that shows its pick's card while the pointer or the focus is on it. Without a
 * summary yet, it is a plain entry.
 */
export function PickItem({
  run,
  className,
  title,
  summary,
  children,
}: {
  run: () => unknown;
  className: string;
  title: string;
  summary: PickSummary | undefined;
  children: ReactNode;
}) {
  const [row, setRow] = useState<HTMLElement | null>(null);
  const show = (e: SyntheticEvent<HTMLElement>) => setRow(e.currentTarget);
  const hide = () => setRow(null);
  return (
    <div
      className="pick-item"
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <MenuItem run={run} className={className}>
        {children}
      </MenuItem>
      {row && summary && <PickCard row={row} title={title} summary={summary} />}
    </div>
  );
}
