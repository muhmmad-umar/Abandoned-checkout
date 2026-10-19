/** "$1,000" for whole amounts, "$18.50" otherwise. */
export function fmtMoney(n: number, currency = "USD"): string {
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(whole ? Math.round(n) : n);
}

/** "2.1x" */
export function fmtRoas(n: number): string {
  return `${n.toFixed(1)}x`;
}

/** 0.153 -> "15%"; with digits=1 -> "15.3%". */
export function fmtPct(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function fmtCount(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n));
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
