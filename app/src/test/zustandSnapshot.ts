import { createStore, type StateCreator, type StoreApi } from "zustand/vanilla";

/**
 * Stands in for `zustand` in a component test: the static renderer has no DOM to subscribe to, so
 * it takes each store's snapshot once and renders the state the test's setup left behind. The
 * stores themselves stay real. A test passes this to `vi.mock("zustand", () => import(...))`.
 */
function bind<T>(initializer: StateCreator<T, [], []>) {
  const api: StoreApi<T> = createStore(initializer);
  function use(): T;
  function use<U>(selector: (state: T) => U): U;
  function use<U>(selector?: (state: T) => U): T | U {
    return selector ? selector(api.getState()) : api.getState();
  }
  return Object.assign(use, api);
}

export const create = <T>(initializer?: StateCreator<T, [], []>) =>
  initializer ? bind(initializer) : bind;
