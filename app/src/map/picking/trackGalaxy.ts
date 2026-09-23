import { useGalaxyStore } from "../../store/galaxyStore";
import type { PickIndex } from "./pickIndex";

/** Builds `index` over the galaxy and keeps it in step with every edit until the returned call. */
export function trackGalaxy(index: PickIndex): () => void {
  index.build(useGalaxyStore.getState().systems);
  return useGalaxyStore.subscribe((state, previous) => {
    if (state.version === previous.version) return;
    if (state.galaxy === previous.galaxy && state.lastDelta) {
      index.apply(state.lastDelta, state.systems);
    } else {
      index.build(state.systems);
    }
  });
}
