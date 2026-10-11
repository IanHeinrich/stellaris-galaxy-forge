import { keyWords } from "../../../lib/text";
import { usePlanetDataStore } from "../../../store/planetDataStore";

/** A planet feature's name, as its game data gives it. */
export function useFeatureNamer(): (key: string) => string {
  const modifiers = usePlanetDataStore((s) => s.modifiers);
  return (key) => modifiers.get(key)?.name ?? keyWords(key.replace(/^pm_/, ""));
}
