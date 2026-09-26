/** `a` mixed towards `b` by `share` in [0, 1], channel by channel. */
export function mixColor(a: number, b: number, share: number): number {
  const channel = (shift: number) => {
    const from = (a >> shift) & 0xff;
    const to = (b >> shift) & 0xff;
    return Math.round(from + (to - from) * share) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}
