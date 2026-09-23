/** Adds `value` to the set `map` holds under `key`, making the set if there is none. */
export function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
}

/** Takes `value` out of the set under `key`, dropping the set once it is empty. */
export function deleteFrom<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const set = map.get(key);
  if (!set) return;
  set.delete(value);
  if (set.size === 0) map.delete(key);
}
