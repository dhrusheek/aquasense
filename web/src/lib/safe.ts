// Safe getters, ported 1:1 from server/static/app.js 72-88 and 131-136.
// Every field of /api/state may be missing or null; nothing here ever throws.

/** Dotted-path read. Returns `d` when any step is missing, null or not an object. */
export function get<T = unknown>(o: unknown, path: string, d?: T): T {
  if (o == null) return d as T;
  const parts = String(path).split('.');
  let cur: unknown = o;
  for (let i = 0; i < parts.length; i++) {
    if (cur == null || typeof cur !== 'object') return d as T;
    cur = (cur as Record<string, unknown>)[parts[i]];
  }
  return (cur === undefined || cur === null ? d : cur) as T;
}

/** The value if it is an array, else `[]`. */
export function arr<T>(x: readonly T[] | null | undefined): T[];
export function arr<T = unknown>(x: unknown): T[];
export function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}

/** The value if it is a plain (non-array) object, else `{}`. */
export function obj<T extends object>(x: T | null | undefined): T;
export function obj<T extends object = Record<string, unknown>>(x: unknown): T;
export function obj(x: unknown): object {
  return x && typeof x === 'object' && !Array.isArray(x) ? x : {};
}

/** Finite number or null. `''`, booleans, null and undefined are null (never 0). */
export function num(x: unknown): number | null {
  if (x === null || x === undefined || x === '' || typeof x === 'boolean') return null;
  const n = Number(x);
  return isFinite(n) ? n : null;
}

/** "N1" | 1 | "1" → 1; null when there are no digits. */
export function nNum(id: unknown): number | null {
  if (typeof id === 'number') return id;
  const m = /(\d+)/.exec(String(id == null ? '' : id));
  return m ? Number(m[1]) : null;
}

/** Anything nNum understands → "N<k>", else "—". */
export function nId(x: unknown): string {
  const n = nNum(x);
  return n ? 'N' + n : '—';
}
