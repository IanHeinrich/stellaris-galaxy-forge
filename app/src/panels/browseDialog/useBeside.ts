import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { placeBesidePoint } from "../../lib/menuAim";
import { useOutsidePress } from "../useOutsidePress";

/** The space left between the point and the dialog's side. */
const GAP_PX = 16;

/** A point in the pixels of the box the dialog is positioned in. */
export interface BesidePoint {
  x: number;
  y: number;
}

/**
 * Where a dialog goes beside `point`, by `placeBesidePoint` inside the box it is positioned in,
 * placed again when that box resizes. `inner` is an element filling the dialog. A press or a wheel
 * turn outside it calls `close`, since either can move the map from under the point. Undefined
 * without a point.
 */
export function useBeside(
  point: BesidePoint | undefined,
  inner: RefObject<HTMLElement | null>,
  close: () => void,
): CSSProperties | undefined {
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);
  const x = point?.x;
  const y = point?.y;
  const beside = point !== undefined;
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

  useLayoutEffect(() => {
    const dialog = inner.current?.parentElement;
    const area = dialog?.parentElement;
    if (x === undefined || y === undefined || !dialog || !area) return undefined;
    const place = () => {
      const at = placeBesidePoint(
        { x, y },
        { width: dialog.offsetWidth, height: dialog.offsetHeight },
        { width: area.clientWidth, height: area.clientHeight },
        GAP_PX,
      );
      setPlaced((was) =>
        was?.left === at.left && was.top === at.top ? was : { left: at.left, top: at.top },
      );
    };
    place();
    const resized = new ResizeObserver(place);
    resized.observe(area);
    return () => resized.disconnect();
  }, [x, y, inner]);

  if (x === undefined || y === undefined) return undefined;
  return placed ?? { left: x, top: y };
}
