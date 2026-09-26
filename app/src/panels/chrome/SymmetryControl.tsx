import type { FocusEvent, KeyboardEvent, ReactNode } from "react";
import type { Symmetry } from "../../lib/geometry/symmetry";
import { shortcutLabel } from "../../lib/keys";
import { useToolStore } from "../../store/toolStore";
import { Glyph } from "../Glyph";
import { outsidePressRef } from "../useOutsidePress";
import { choiceOf, MIRRORS, ROTATIONS, SYMMETRY_OFF, type SymmetryChoice } from "./symmetryChoices";
import "./chrome.css";

function focusButton(from: HTMLElement): void {
  from.closest(".symmetry-control")?.querySelector<HTMLElement>(".symmetry-toggle")?.focus();
}

/** Arrow keys walk the flyout's choices in reading order, Home and End jump to its ends. */
function onMenuKey(e: KeyboardEvent<HTMLDivElement>, close: () => void): void {
  const step: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  const items = () => [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    focusButton(e.currentTarget);
    close();
  } else if (e.key in step) {
    e.preventDefault();
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    all[(at + step[e.key] + all.length) % all.length]?.focus();
  } else if (e.key === "Home" || e.key === "End") {
    e.preventDefault();
    const all = items();
    all[e.key === "Home" ? 0 : all.length - 1]?.focus();
  }
}

function Choice({ choice, current }: { choice: SymmetryChoice; current: Symmetry }) {
  const setSymmetry = useToolStore((s) => s.setSymmetry);
  const setMenu = useToolStore((s) => s.setSymmetryMenu);
  const checked = choiceOf(current).value === choice.value;
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      aria-label={choice.label}
      title={choice.label}
      autoFocus={checked}
      onClick={(e) => {
        setSymmetry(choice.symmetry);
        focusButton(e.currentTarget);
        setMenu(false);
      }}
    >
      {choice.short}
    </button>
  );
}

function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="symmetry-row">
      {label && <span className="symmetry-row-label">{label}</span>}
      {children}
    </div>
  );
}

/** The global symmetry: the button opens the flyout that picks it, and Shift+M turns it off and back on. */
export function SymmetryControl() {
  const symmetry = useToolStore((s) => s.symmetry);
  const last = useToolStore((s) => s.lastSymmetry);
  const open = useToolStore((s) => s.symmetryMenu);
  const setMenu = useToolStore((s) => s.setSymmetryMenu);
  const on = symmetry.kind !== "off";
  const choice = choiceOf(on ? symmetry : last);
  const close = () => setMenu(false);
  const pressOutside = outsidePressRef(close, (menu) => menu.closest(".symmetry-control"));
  const key = shortcutLabel("toggleSymmetry");
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
  };
  return (
    <div className="symmetry-control" onBlur={onBlur}>
      <button
        type="button"
        className="icon symmetry-toggle"
        aria-pressed={on}
        aria-label="Symmetry"
        aria-haspopup="menu"
        aria-expanded={open}
        title={
          on
            ? `Symmetry: ${choice.label} (${key} turns it off)`
            : `Symmetry off (${key} turns on ${choice.label.toLowerCase()})`
        }
        onClick={() => setMenu(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            e.preventDefault();
            setMenu(true);
          }
        }}
      >
        <Glyph className="rail-icon" size={14}>
          <path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2" />
        </Glyph>
        {on && <span className="symmetry-badge">{choice.short}</span>}
      </button>
      {open && (
        <div
          className="symmetry-menu"
          role="menu"
          aria-label="Symmetry"
          ref={pressOutside}
          onKeyDown={(e) => onMenuKey(e, close)}
        >
          <Row>
            <Choice choice={SYMMETRY_OFF} current={symmetry} />
          </Row>
          <Row label="Mirror">
            {MIRRORS.map((c) => (
              <Choice key={c.value} choice={c} current={symmetry} />
            ))}
          </Row>
          <Row label="Rotate">
            {ROTATIONS.map((c) => (
              <Choice key={c.value} choice={c} current={symmetry} />
            ))}
          </Row>
        </div>
      )}
    </div>
  );
}
