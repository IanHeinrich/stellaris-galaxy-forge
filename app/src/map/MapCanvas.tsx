import { Application } from "pixi.js";
// The app's CSP forbids eval; this swaps Pixi's generated shader code for precompiled paths.
import "pixi.js/unsafe-eval";
import { useEffect, useRef } from "react";
import { MapController } from "./MapController";

/** The galaxy map. Everything Pixi lives in the controller, never in React state. */
export function MapCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let controller: MapController | null = null;
    const app = new Application();
    void app
      .init({ resizeTo: host, background: 0x05070d, antialias: true, preference: "webgl" })
      .then(() => {
        if (cancelled) {
          app.destroy(true, { children: true });
          return;
        }
        host.appendChild(app.canvas);
        controller = new MapController(app, host);
      });
    return () => {
      cancelled = true;
      if (controller) {
        controller.dispose();
        controller = null;
        app.destroy(true, { children: true });
      }
    };
  }, []);

  return <div ref={hostRef} className="map-host" />;
}
