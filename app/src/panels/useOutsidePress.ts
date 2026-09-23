import { useEffect, useRef, type RefObject } from "react";

/**
 * Calls `close` when a press lands outside every element `inside` gives, and returns the call
 * that stops listening. The map's canvas takes no focus, so no blur follows a press on it.
 */
function listen(inside: () => ReadonlyArray<Element | null | undefined>, close: () => void) {
  const onPointerDown = (e: PointerEvent) => {
    const at = e.target as Node | null;
    if (!inside().some((el) => el?.contains(at))) close();
  };
  window.addEventListener("pointerdown", onPointerDown, { capture: true });
  return () => window.removeEventListener("pointerdown", onPointerDown, { capture: true });
}

/** While `active`, a press outside `region`, and outside `also` when given, calls `close`. */
export function useOutsidePress(
  active: boolean,
  close: () => void,
  region: RefObject<Element | null>,
  also?: RefObject<Element | null>,
): void {
  const latest = useRef(close);
  useEffect(() => {
    latest.current = close;
  });
  useEffect(() => {
    if (!active) return undefined;
    return listen(
      () => [region.current, also?.current],
      () => latest.current(),
    );
  }, [active, region, also]);
}

/**
 * `useOutsidePress` as a ref callback, for as long as the element it is attached to is mounted,
 * over the region `within` gives for it. It takes no React hook, so a component test can call
 * the component that uses it outside a render.
 */
export function outsidePressRef(
  close: () => void,
  within: (el: HTMLElement) => Element | null = (el) => el,
): (el: HTMLElement | null) => (() => void) | undefined {
  return (el) => {
    const region = el && within(el);
    return region ? listen(() => [region], close) : undefined;
  };
}
