export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const safeDiv = (a: number, b: number): number | null => (b > 0 ? a / b : null);
/** Relative change from `from` to `to`, or null when `from` is not positive. */
export const relChange = (from: number | null | undefined, to: number | null | undefined): number | null =>
  from != null && to != null && from > 0 ? (to - from) / from : null;
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
/** Map `x` linearly from [x0, x1] onto [y0, y1], clamped to the output range. */
export function lerpClamped(x: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x0 === x1) return y0;
  const t = clamp((x - x0) / (x1 - x0), 0, 1);
  return y0 + t * (y1 - y0);
}
