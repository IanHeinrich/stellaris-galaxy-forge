import { useMemo } from "react";
import type { LayoutDiagram } from "../generated/LayoutDiagram";
import { singleStarClasses } from "../lib/details/starBody";
import { diagramPlaces, starArtKeys } from "../lib/multiStar";
import { useGameDataStore } from "../store/gameDataStore";
import { useTextureUrl } from "./useTextureUrl";
import "./panels.css";

/** The space kept under a star of a diagram for its name. */
const NAME_PX = 14;

/** The art the galaxy view draws for a star of the planet class `star`, `size` pixels square. */
export function StarArt({ star, size }: { star: string; size: number }) {
  const starClasses = useGameDataStore((s) => s.starClasses);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const singles = useMemo(() => singleStarClasses(starClasses), [starClasses]);
  const url = useTextureUrl(starArtKeys(star, singles, planetClasses));
  if (url === undefined) {
    return <span className="star-art blank" style={{ width: size, height: size }} aria-hidden />;
  }
  return <img className="star-art star-class-icon" src={url} width={size} height={size} alt="" />;
}

/**
 * A layout's stars alone, each where the layout puts it with the art of the star in its slot, and
 * a distant companion's path round the centre: in a box `size` pixels square, under each star its
 * name when `names` are given.
 */
export function StarDiagram({
  diagram,
  stars,
  size,
  starSize,
  names,
  label,
}: {
  diagram: LayoutDiagram;
  /** The planet class of each star, in the diagram's order. */
  stars: readonly string[];
  size: number;
  starSize: number;
  names?: readonly string[];
  label?: string;
}) {
  const margin = starSize / 2 + (names === undefined ? 2 : NAME_PX);
  const places = diagramPlaces(diagram, size, margin);
  const mid = size / 2;
  return (
    <span
      className="star-diagram"
      style={{ width: size, height: size }}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
    >
      <svg width={size} height={size} aria-hidden="true">
        {places.flatMap((p, i) =>
          p.path === null
            ? []
            : [<circle key={i} className="star-diagram-path" cx={mid} cy={mid} r={p.path} />],
        )}
      </svg>
      {places.map((p, i) => (
        <span
          key={i}
          className="star-diagram-star"
          style={{ left: p.x, top: p.y, transform: `translate(-50%, -${starSize / 2}px)` }}
        >
          <StarArt star={stars[i] ?? ""} size={starSize} />
          {names !== undefined && <span className="star-diagram-name">{names[i] ?? ""}</span>}
        </span>
      ))}
    </span>
  );
}
