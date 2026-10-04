import { vi } from "vitest";

type Listener = (e: PointerEvent) => void;

export type Surface = HTMLCanvasElement & {
  fire(type: string, x: number, y: number, extra?: Partial<PointerEvent>): void;
};

/** A canvas that records its listeners, so a test can press, drag and release on it. */
export function recordingCanvas(): Surface {
  const listeners = new Map<string, Listener>();
  let time = 1000;
  return {
    style: {},
    addEventListener: (type: string, fn: Listener) => void listeners.set(type, fn),
    removeEventListener: (type: string) => void listeners.delete(type),
    setPointerCapture: () => undefined,
    hasPointerCapture: () => false,
    releasePointerCapture: () => undefined,
    fire(type: string, x: number, y: number, extra: Partial<PointerEvent> = {}) {
      listeners.get(type)?.({
        offsetX: x,
        offsetY: y,
        button: type === "pointermove" ? -1 : 0,
        pointerId: 1,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        timeStamp: (time += 50),
        ...extra,
      } as PointerEvent);
    },
  } as unknown as Surface;
}

/**
 * Stands a window in that keeps its key listeners, and returns the way to press a key on it: the
 * spy it gives back says whether the press was kept from the app. Undo it with `unstubAllGlobals`.
 */
export function stubWindowKeys(): (type: "keydown" | "keyup", name: string) => () => boolean {
  const listeners = new Map<string, (e: KeyboardEvent) => void>();
  vi.stubGlobal("window", {
    addEventListener: (type: string, fn: (e: KeyboardEvent) => void) =>
      void listeners.set(type, fn),
    removeEventListener: (type: string) => void listeners.delete(type),
  });
  vi.stubGlobal("HTMLElement", class {});
  return (type, name) => {
    const stop = vi.fn();
    listeners.get(type)?.({ key: name, target: null, stopImmediatePropagation: stop } as never);
    return () => stop.mock.calls.length > 0;
  };
}
