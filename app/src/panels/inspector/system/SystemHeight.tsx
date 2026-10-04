import { useEffect, useRef, type KeyboardEvent } from "react";
import type { SystemNode } from "../../../generated/SystemNode";
import {
  heightStrength,
  heightTint,
  heightToSlider,
  isFlat,
  relativeHeight,
  roundHeight,
  sliderToHeight,
} from "../../../lib/height";
import { toCss } from "../../../lib/visual/ownerColors";
import { useEditorStore } from "../../../store/editorStore";
import { useCanEdit } from "../../../store/fileSessionStore";
import { useHeightPreviewStore } from "../../../store/heightPreviewStore";
import { EditNote, EditRow, TextField } from "../../EditField";
import { HeightMark } from "../../HeightMark";

export const HEIGHT_HINT = "0 is flat. Above 0 rises above the galaxy plane, below 0 sinks.";

/** Where the icon's plane sits, and how far its star may stand off it. */
const PLANE_Y = 12;
const MAX_LIFT = 9;

/** The height marker with its star lifted by the height, in the colour the height reads as. */
function HeightIcon({ relative }: { relative: number }) {
  const color = toCss(heightTint(relative));
  const lift = isFlat(relative)
    ? 0
    : Math.sign(relative) * (3 + (MAX_LIFT - 3) * heightStrength(relative));
  const star = PLANE_Y - lift;
  return (
    <svg className="height-icon" viewBox="0 0 16 24" width={12} height={18} aria-hidden="true">
      <HeightMark
        plane={PLANE_Y}
        star={star}
        rx={5}
        ry={2.2}
        radius={2.2}
        color={color}
        strokeWidth={1}
      />
    </svg>
  );
}

/** How far one arrow key moves the slider's height, and with Shift held. */
const KEY_STEP = 1;
const SHIFT_KEY_STEP = 10;

/** Which way an arrow key moves the height: up and right raise it, down and left lower it. */
function keyDirection(key: string): number {
  if (key === "ArrowRight" || key === "ArrowUp") return 1;
  if (key === "ArrowLeft" || key === "ArrowDown") return -1;
  return 0;
}

const previews = () => useHeightPreviewStore.getState();

/**
 * A save system's height under its position: a slider across the row whose middle moves in
 * fractions of a unit, which the map follows while it is held and which sends one edit when it is
 * let go, then a field and a Flat button. Hidden where the document has no heights.
 */
export function HeightRow({ system }: { system: SystemNode }) {
  const editable = useCanEdit("system_heights");
  const setSystemHeight = useEditorStore((s) => s.setSystemHeight);
  const previewed = useHeightPreviewStore((s) => s.inspector.get(system.id));
  /** Set by Escape until the pointer or key lets go, so the rest of that drag shows nothing. */
  const cancelled = useRef(false);
  /** Set once a release has sent the preview, so a second release sends nothing. */
  const released = useRef(false);
  const id = system.id;
  useEffect(() => () => previews().clear(id), [id]);
  if (!editable) return null;
  const relative = relativeHeight(system.height);
  const shown = previewed ?? relative;
  const show = (value: number) => {
    if (cancelled.current) return;
    released.current = false;
    previews().show(id, roundHeight(value));
  };
  const release = () => {
    cancelled.current = false;
    if (released.current) return;
    const value = previews().inspector.get(id);
    if (value === undefined) return;
    released.current = true;
    if (isFlat(value - relative)) previews().clear(id);
    else void previews().commit(id);
  };
  const cancel = () => {
    cancelled.current = true;
    previews().clear(id);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
      return;
    }
    const direction = keyDirection(e.key);
    if (direction === 0) return;
    e.preventDefault();
    const from = previews().inspector.get(id) ?? relative;
    show(from + direction * (e.shiftKey ? SHIFT_KEY_STEP : KEY_STEP));
  };
  const commit = (value: number) => {
    previews().clear(id);
    void setSystemHeight(id, value);
  };
  return (
    <>
      <EditRow label="Height">
        <span className="ins-height">
          <span className="ins-height-track">
            <HeightIcon relative={shown} />
            <input
              type="range"
              min={-1}
              max={1}
              step="any"
              aria-label="Height slider"
              aria-valuetext={String(roundHeight(shown))}
              value={heightToSlider(shown)}
              onChange={(e) => show(sliderToHeight(Number(e.target.value)))}
              onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
              onPointerUp={release}
              onPointerCancel={cancel}
              onKeyDown={onKeyDown}
              onKeyUp={release}
              onBlur={release}
            />
          </span>
          <span className="ins-height-value">
            <TextField
              kind="number"
              className="coord"
              label="Height"
              value={shown}
              decimals={previewed === undefined ? 2 : 1}
              onCommit={commit}
            />
            <button
              type="button"
              disabled={isFlat(shown)}
              title="Back to the game's default height"
              onClick={() => commit(0)}
            >
              Flat
            </button>
          </span>
        </span>
      </EditRow>
      <EditNote>{HEIGHT_HINT}</EditNote>
    </>
  );
}
