/** The six corners of a hexagon lying on the plane, seen at an angle. */
function hexagon(cx: number, cy: number, rx: number, ry: number): string {
  return [0, 60, 120, 180, 240, 300]
    .map((deg) => {
      const a = (deg * Math.PI) / 180;
      return `${(cx + rx * Math.cos(a)).toFixed(2)},${(cy + ry * Math.sin(a)).toFixed(2)}`;
    })
    .join(" ");
}

/**
 * The game's height marker: a star on a drop line over its hexagon on the plane, in a 16 unit
 * wide box. The defaults fit a 16 unit glyph; `star` and `plane` are the heights of the star and
 * the hexagon's centre, and a star on the plane has no drop line.
 */
export function HeightMark({
  plane = 12.6,
  star = 3.6,
  rx = 4.6,
  ry = 2.1,
  radius = 2,
  color = "currentColor",
  strokeWidth,
}: {
  plane?: number;
  star?: number;
  rx?: number;
  ry?: number;
  radius?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <>
      <polygon
        points={hexagon(8, plane, rx, ry)}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
      />
      {star !== plane && (
        <line x1={8} y1={plane} x2={8} y2={star} stroke={color} strokeWidth={strokeWidth} />
      )}
      <circle cx={8} cy={star} r={radius} fill={color} stroke="none" />
    </>
  );
}
