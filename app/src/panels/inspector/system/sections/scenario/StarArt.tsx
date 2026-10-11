import { useGameDataStore } from "../../../../../store/gameDataStore";
import { Icon } from "../../../../parts";

/** A star class's art, a star glyph while it has none. */
export function StarArt({ starClass }: { starClass: string }) {
  const texture = useGameDataStore((s) => s.starClasses.get(starClass)?.texture_key);
  return <Icon className="pi ghost" keys={texture ? [texture] : []} glyph="★" />;
}
