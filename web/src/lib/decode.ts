/** Digits-only scramble that settles left to right (StatTile value changes). Pure; no clock. */

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

/**
 * Frames from `from` to `to`. Positions that are digits in `to` cycle through random digits until
 * the settle front reaches them; every other character is fixed. The first frame keeps the old
 * digits, the last frame is exactly `to`.
 */
export function decodeFrames(from: string, to: string, steps: number, rnd: () => number = Math.random): string[] {
  const n = Math.max(1, Math.floor(steps));
  const frames: string[] = [];
  for (let s = 0; s < n; s++) {
    const settled = s === n - 1 ? to.length : Math.floor((to.length * s) / (n - 1 || 1));
    let out = '';
    for (let i = 0; i < to.length; i++) {
      const c = to[i];
      if (!isDigit(c) || i < settled) out += c;
      else if (s === 0 && isDigit(from[i])) out += from[i];
      else out += String(Math.floor(rnd() * 10) % 10);
    }
    frames.push(out);
  }
  return frames;
}
