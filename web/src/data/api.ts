// HTTP edge of the dashboard: GET /api/state, POST /api/command, static mock file, CSV export.
import type { Command, CommandOk, State } from '@/data/types';

/** '/static/' in build and dev (vite.config.ts `base`). */
export const BASE = import.meta.env.BASE_URL;

/** URL of a mock fixture next to the built page, e.g. /static/mock_state.json. */
export const mockUrl = (file: string) => `${BASE}${file}`;

export const csvUrl = '/api/export.csv';

/** One poll of the live state. Rejects on a non-2xx status or a non-object payload (app.js 1521-1528). */
export async function fetchState(signal: AbortSignal): Promise<State> {
  const r = await fetch('/api/state', { cache: 'no-store', signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d: unknown = await r.json();
  if (!d || typeof d !== 'object') throw new Error('bad payload');
  return d as State;
}

/** Queue a command for the sink. Throws Error(message) on a non-2xx status or `{ ok: false }` (app.js 1613-1623). */
export async function postCommand(cmd: Command): Promise<CommandOk> {
  const r = await fetch('/api/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const res = await r.json().catch(() => ({}));
  if (!r.ok || res.ok === false) throw new Error(res.error || `HTTP ${r.status}`);
  return res as CommandOk;
}
