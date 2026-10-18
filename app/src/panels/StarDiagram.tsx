import { useMemo } from "react";
import type { LayoutDiagram } from "../generated/LayoutDiagram";
import { singleStarClasses } from "../lib/details/starBody";
import { fitDiagram, placeLabels, starArtKeys } from "../lib/multiStar";
import { useGameDataStore } from "../store/gameDataStore";
import { useTextureUrl } from "./useTextureUrl";
import "./panels.css";

/**
 * The art the galaxy view draws for a star of the planet class `star`, `size` pixels square, on a
 * ground of its own that its texture's black blends into, as the map adds a star's light.
 */
export function StarArt({ star, size }: { star: string; size: number }) {
  const starClasses = useGameDataStore((s) => s.starClasses);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const singles = useMemo(() => singleStarClasses(starClasses), [starClasses]);
  const url = useTextureUrl(starArtKeys(star, singles, planetClasses));
  return (
    <span className="star-art" style={{ width: size, height: size }} aria-hidden="true">
      {url !== undefined && <img src={url} width={size} height={size} alt="" />}
    </span>
  );
}

/** The space kept under the stars for their labels. */
const LABEL_PX = 12;

/**
 * A layout's stars alone, each where the layout puts it with the art of the star in its slot, and
 * a distant companion's path round the centre, scaled to fill a box `size` pixels square. The art
 * is at most `starSize` across and shrinks, to `minStar`, so neighbours keep a gap. Each star
 * carries its label under it when `labels` are given and none would touch, else none does.
 */
export function StarDiagram({
  diagram,
  stars,
  size,
  starSize,
  minStar = Math.min(starSize, 8),
  labels,
  reach,
  label,
}: {
  diagram: LayoutDiagram;
  /** The planet class of each star, in the diagram's order. */
  stars: readonly string[];
  size: number;
  starSize: number;
  minStar?: number;
  /** A label for each star, in the diagram's order. */
  labels?: readonly string[];
  /** How far a whole system reaches, in game units, one scale for every diagram; unset, its own. */
  reach?: number;
  label?: string;
}) {
  const fit = fitDiagram(diagram, {
    size,
    maxStar: starSize,
    minStar,
    below: labels === undefined ? 0 : LABEL_PX,
    reach,
  });
  const shown = labels === undefined ? null : placeLabels(fit, labels);
  const art = fit.starSize;
  return (
    <span
      className="star-diagram"
      style={{ width: size, height: size }}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
    >
      <svg width={size} height={size} aria-hidden="true">
        {fit.stars.flatMap((p, i) =>
          p.path === null
            ? []
            : [
                <circle
                  key={i}
                  className="star-diagram-path"
                  cx={fit.centre.x}
                  cy={fit.centre.y}
                  r={p.path}
                />,
              ],
        )}
      </svg>
      {fit.stars.map((p, i) => (
        <span
          key={i}
          className="star-diagram-star"
          style={{ left: p.x - art / 2, top: p.y - art / 2 }}
        >
          <StarArt star={stars[i] ?? ""} size={art} />
        </span>
      ))}
      {shown?.map((place, i) => (
        <span
          key={i}
          className="star-diagram-label"
          aria-hidden="true"
          style={{ left: place.x, top: place.top }}
        >
          {labels?.[i]}
        </span>
      ))}
    </span>
  );
}
