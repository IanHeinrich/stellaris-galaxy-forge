import { useFileSessionStore } from "../../store/fileSessionStore";
import { useMapChromeStore, type MapGesture } from "../../store/mapChromeStore";

/**
 * What the status bar says the pointer is doing. A lane drag outlives the hover it started from,
 * and a new document drops both, so the map's own state and the store never disagree.
 */
export class GestureReporter {
  private connecting = false;
  private overLane = false;
  private readonly unsubscribe: () => void;

  constructor() {
    this.unsubscribe = useFileSessionStore.subscribe((state, previous) => {
      if (state.status !== previous.status) this.forget();
    });
  }

  hover(overLane: boolean): void {
    this.overLane = overLane;
    this.publish();
  }

  connect(): void {
    this.connecting = true;
    this.publish();
  }

  endConnect(): void {
    this.connecting = false;
    this.publish();
  }

  forget(): void {
    this.connecting = false;
    this.overLane = false;
    this.publish();
  }

  dispose(): void {
    this.unsubscribe();
    this.forget();
  }

  private publish(): void {
    const gesture: MapGesture | null = this.connecting
      ? "connecting"
      : this.overLane
        ? "lane"
        : null;
    useMapChromeStore.getState().setGesture(gesture);
  }
}
