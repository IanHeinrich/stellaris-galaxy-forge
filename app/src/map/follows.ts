/** A zustand store as a scene reads and follows it. */
export interface Store<S> {
  getState(): S;
  subscribe(listener: (state: S, prev: S) => void): () => void;
}

/** What a store change moves in view `V`, and when it applies besides a change. */
export interface Binding<V, W extends string> {
  /** "change" applies only when a field it follows changes; another value names when else it applies. */
  readonly when: W | "change";
  readonly apply?: (view: V) => void;
  readonly subscribe: (view: V) => () => void;
}

/** Applies `apply` to the view whenever one of `fields` of `store` changes, and at `when`. */
export function follows<S, V, W extends string = never>(
  store: Store<S>,
  fields: ReadonlyArray<(state: S) => unknown>,
  apply: (state: S, view: V) => void,
  when?: W,
): Binding<V, W> {
  return {
    when: when ?? "change",
    apply: (view) => apply(store.getState(), view),
    subscribe: (view) =>
      store.subscribe((state, prev) => {
        if (fields.some((field) => field(state) !== field(prev))) apply(state, view);
      }),
  };
}

/** The fields of `T` a snapshot may compare: every one that is not a function. */
export type DataField<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? never : K;
}[keyof T];

/**
 * Whether two snapshots hold the same value in every data field. `fields` is a record so that a
 * field added to `T` fails to compile until it is listed.
 */
export function sameFields<T>(fields: Record<DataField<T>, true>): (a: T, b: T) => boolean {
  const keys = Object.keys(fields) as Array<DataField<T>>;
  return (a, b) => keys.every((key) => a[key] === b[key]);
}
