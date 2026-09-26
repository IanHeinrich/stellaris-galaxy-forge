/** White texels with premultiplied alpha, made on the CPU, and their size. */
export interface Texels {
  readonly texels: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** `make`'s texels, made on the first call and shared by every scene after. */
export function once(make: () => Texels): () => Texels {
  let made: Texels | null = null;
  return () => (made ??= make());
}

/** `alpha(x, y)` for each texel of a `width` by `height` field, `x` and `y` from -1 to 1. */
export function field(
  width: number,
  height: number,
  alpha: (x: number, y: number) => number,
): Texels {
  const texels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const x = ((col + 0.5) / width) * 2 - 1;
      const y = ((row + 0.5) / height) * 2 - 1;
      const a = Math.round(255 * Math.min(1, Math.max(0, alpha(x, y))));
      texels.set([a, a, a, a], (row * width + col) * 4);
    }
  }
  return { texels, width, height };
}
