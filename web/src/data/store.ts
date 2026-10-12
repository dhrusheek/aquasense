// The one data store: the latest /api/state document plus fetch bookkeeping, replaced wholesale
// once a second and read through React's useSyncExternalStore (see @/data/hooks).
// Poll loop ported from server/static/app.js 1508-1533.
import { fetchState } from '@/data/api';
import { createMockSource } from '@/data/mock';
import { createReplaySource } from '@/data/replay';
import type { State } from '@/data/types';
import { POLL_MS, SIM, TIMEOUT_MS } from '@/lib/constants';

export interface Snapshot {
  /** Last good payload (kept while offline, like legacy S.data). */
  data: State | null;
  /** The most recent poll succeeded. */
  fetchOk: boolean;
  /** At least one poll ever succeeded. */
  everOk: boolean;
  /** The most recent poll failed. */
  fetchFailed: boolean;
  /** performance.now() at the last successful poll. */
  recvPerf: number;
  /** ?mock mode. */
  mock: boolean;
  /** 'mock_state.json' or the ?mock=<name>.json value. */
  mockFile: string;
}

const qs = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
const MOCK = SIM || (qs.has('mock') && qs.get('mock') !== '0');
const mockParam = qs.get('mock') || '';
const MOCK_FILE = /^[\w-]+\.json$/.test(mockParam) ? mockParam : 'mock_state.json';

let snapshot: Snapshot = {
  data: null, fetchOk: false, everOk: false, fetchFailed: false, recvPerf: 0, mock: MOCK, mockFile: MOCK_FILE,
};
const listeners = new Set<() => void>();

function set(patch: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((cb) => cb());
}

const mockSource = SIM ? createReplaySource() : MOCK ? createMockSource(MOCK_FILE) : null;
let started = false;

function poll(): void {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const p: Promise<State> = mockSource ? mockSource.next() : fetchState(ctl.signal);
  p.then((d) => {
    clearTimeout(to);
    if (!d || typeof d !== 'object') throw new Error('bad payload');
    set({ data: d, fetchOk: true, everOk: true, fetchFailed: false, recvPerf: performance.now() });
  }).catch(() => {
    clearTimeout(to);
    // Keep `data`; only notify when the flags actually change so the snapshot reference stays stable.
    if (snapshot.fetchOk || !snapshot.fetchFailed) set({ fetchOk: false, fetchFailed: true });
  }).then(() => {
    setTimeout(poll, POLL_MS); // always after settle, so polls never overlap
  });
}

export const store = {
  /** Stable reference until the next update. */
  getSnapshot(): Snapshot {
    return snapshot;
  },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
  /** Idempotent; begins the poll loop. */
  start(): void {
    if (started) return;
    started = true;
    poll();
  },
};
