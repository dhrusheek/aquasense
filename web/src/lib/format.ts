// Formatting helpers, ported 1:1 from server/static/app.js 94-181 and 432-433.
// The clock-dependent ones (netT, tAgo, whenStr) live in @/data/selectors.
import type { Tone } from '@/data/types';
import { arr, num } from '@/lib/safe';

/** en-US number with exactly `dec` decimals (default 1) and an optional unit; "—" when not finite. */
export function fmt(v: unknown, dec: number = 1, unit?: string): string {
  const n = num(v);
  if (n === null) return '—';
  const s = n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return unit ? s + ' ' + unit : s;
}

/** Integer form of `fmt`. */
export function fmtI(v: unknown, unit?: string): string {
  return fmt(v, 0, unit);
}

/** Milliseconds → "1.5 s". */
export function fmtSec(ms: unknown): string {
  const n = num(ms);
  return n === null ? '—' : fmt(n / 1000, 1, 's');
}

/** Seconds → "1.2 s ago" / "3 min 4 s ago" / "1.1 h ago" (negative clamps to 0). */
export function fmtAgo(s: unknown): string {
  let n = num(s);
  if (n === null) return '—';
  if (n < 0) n = 0;
  if (n < 60) return fmt(n, 1) + ' s ago';
  if (n < 3600) return Math.floor(n / 60) + ' min ' + Math.floor(n % 60) + ' s ago';
  return fmt(n / 3600, 1) + ' h ago';
}

/** Seconds → "1h 2m 3s", leading zero units omitted. */
export function fmtDur(s: unknown): string {
  let n = num(s);
  if (n === null) return '—';
  n = Math.floor(n);
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), sec = n % 60;
  return (h ? h + 'h ' : '') + (h || m ? m + 'm ' : '') + sec + 's';
}

/** Mean of the finite numbers in `a`; null when there are none. */
export function mean(a: unknown): number | null {
  const v = arr(a).map(num).filter((x): x is number => x !== null);
  return v.length ? v.reduce((p, c) => p + c, 0) / v.length : null;
}

/** Sum of the finite numbers in `a`; null when there are none. */
export function sum(a: unknown): number | null {
  const v = arr(a).map(num).filter((x): x is number => x !== null);
  return v.length ? v.reduce((p, c) => p + c, 0) : null;
}

/** Euclidean distance between two [x, y] points; null when either is missing or not numeric. */
export function dist(a: readonly unknown[] | null | undefined, b: readonly unknown[] | null | undefined): number | null {
  if (!a || !b) return null;
  const ax = num(a[0]), ay = num(a[1]), bx = num(b[0]), by = num(b[1]);
  if (ax === null || ay === null || bx === null || by === null) return null;
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/** ESP32 die temperature, ×100 integer → °C. Heuristic: a die is below 200 °C; -1 and ≤ -100 are "no reading". */
export function tempC(v: unknown): number | null {
  const n = num(v);
  if (n === null || n <= -100 || n === -1) return null;
  return Math.abs(n) > 200 ? n / 100 : n;
}

/** Higher is better: ≥ good → ok, ≥ ok → warn, else bad; undefined when there is no value. */
export function toneHi(v: unknown, good: number, ok: number): Tone | undefined {
  const n = num(v);
  if (n === null) return undefined;
  return n >= good ? 'ok' : n >= ok ? 'warn' : 'bad';
}

/** Lower is better: ≤ good → ok, ≤ ok → warn, else bad; undefined when there is no value. */
export function toneLo(v: unknown, good: number, ok: number): Tone | undefined {
  const n = num(v);
  if (n === null) return undefined;
  return n <= good ? 'ok' : n <= ok ? 'warn' : 'bad';
}
