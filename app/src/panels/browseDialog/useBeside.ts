import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { placeBesideRect, type Rect } from "../../lib/menuAim";
import { useOutsidePress } from "../useOutsidePress";

/** The space left between the area and the dialog's side. */
const GAP_PX = 16;

/**
 * Where a dialog goes beside `area`, a box in the pixels of the box it is positioned in, by
 * `placeBesideRect`: placed again when that box resizes or the area changes, though not while the
 * pointer is over the dialog. `inner` is an element filling the dialog. A press or a wheel turn
 * outside it calls `close`, since either can move the map from under the area. Undefined without
 * an area.
 */
export function useBeside(
  area: Rect | undefined,
  inner: RefObject<HTMLElement | null>,
  close: () => void,
): CSSProperties | undefined {
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);
  const [held, setHeld] = useState(false);
  const left = area?.left;
  const top = area?.top;
  const right = area?.right;
  const bottom = area?.bottom;
  const beside = area !== undefined;
  const latest = useRef(close);
  useEffect(() => {
    latest.current = close;
  });
  useOutsidePress(beside, close, inner);

  useEffect(() => {
    if (!beside) return undefined;
    const onWheel = (e: WheelEvent) => {
      if (!inner.current?.contains(e.target as Node | null)) latest.current();
    };
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    return () => window.removeEventListener("wheel", onWheel, { capture: true });
  }, [beside, inner]);

  useEffect(() => {
    const el = inner.current;
    if (!beside || !el) return undefined;
    const enter = () => setHeld(true);
    const leave = () => setHeld(false);
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointerleave", leave);
    };
  }, [beside, inner]);

  useLayoutEffect(() => {
    const dialog = inner.current?.parentElement;
    const box = dialog?.parentElement;
    if (left === undefined || top === undefined || right === undefined || bottom === undefined) {
      return undefined;
    }
    if (held || !dialog || !box) return undefined;
    const place = () => {
      const at = placeBesideRect(
        { left, top, right, bottom },
        { width: dialog.offsetWidth, height: dialog.offsetHeight },
        { width: box.clientWidth, height: box.clientHeight },
        GAP_PX,
      );
      setPlaced((was) =>
        was?.left === at.left && was.top === at.top ? was : { left: at.left, top: at.top },
      );
    };
    place();
    const resized = new ResizeObserver(place);
    resized.observe(box);
    return () => resized.disconnect();
  }, [left, top, right, bottom, held, inner]);

  if (left === undefined || top === undefined) return undefined;
  return placed ?? { left, top };
}
