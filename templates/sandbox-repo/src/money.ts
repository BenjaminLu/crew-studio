// Amounts are integers in cents.

/** The sum of amounts. */
export function add(...amounts: number[]): number {
  return amounts.reduce((sum, a) => sum + a, 0);
}

/** Split an amount into n parts that differ by at most one cent; the larger parts come first. */
export function split(amount: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts < 1) throw new Error("parts must be a positive integer");
  const base = Math.floor(amount / parts);
  const extra = amount - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

/** "$12.34" from 1234. */
export function format(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
