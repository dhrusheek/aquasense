// Hash router (#home, #overview, #events, #system, #r1 … #r9). No router library: deep links,
// back/forward and middle-click all work because navigation is plain <a href="#r3">.
import { useSyncExternalStore } from 'react';
import { HASH_ALIASES, isReleaseId, isViewId, type ViewId } from '@/app/routes';
import { RELEASE } from '@/lib/constants';

export type { ViewId } from '@/app/routes';

/** The view opened when there is no hash at all (spec 05 §9: flip to 'overview' to skip the landing page). */
const DEFAULT_VIEW: ViewId = RELEASE ? 'story' : 'home';
/** Where an unknown hash (#foo) lands. */
/** The dashboard's old page ids; in the release build they all land on 'live'. */
const LEGACY_IDS = ['home', 'overview', 'events', 'system', 'demo', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9'];
const FALLBACK_VIEW: ViewId = RELEASE ? 'story' : 'overview';

function alias(v: string): ViewId | undefined {
  return Object.prototype.hasOwnProperty.call(HASH_ALIASES, v) ? HASH_ALIASES[v] : undefined;
}

/**
 * '#r3' → 'r3'; '' → the default; '#demo' → its alias; unknown → the fallback.
 * Release build: the five release ids only; every old dashboard id lands on 'live'.
 * Evaluator build: a release id is not a page and resolves to 'overview'.
 */
export function parseHash(h: string): ViewId {
  const v = String(h || '').replace(/^#/, '');
  if (!v) return DEFAULT_VIEW;
  if (RELEASE) return isReleaseId(v) ? v : LEGACY_IDS.includes(v) ? 'live' : FALLBACK_VIEW;
  if (isReleaseId(v)) return 'overview';
  return isViewId(v) ? v : alias(v) ?? FALLBACK_VIEW;
}

/** An alias, an unknown hash or an id the build does not serve is rewritten in place, without adding a history entry. */
function normalise(): void {
  const raw = window.location.hash.replace(/^#/, '');
  if (raw && parseHash(raw) !== raw) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search + '#' + parseHash(raw));
  }
}

function subscribe(cb: () => void): () => void {
  const onHash = () => { normalise(); cb(); };
  normalise();
  window.addEventListener('hashchange', onHash);
  return () => window.removeEventListener('hashchange', onHash);
}

const getSnapshot = (): ViewId => parseHash(window.location.hash);

/** The view selected by location.hash; re-renders on hashchange. */
export function useHashRoute(): ViewId {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function navigate(v: ViewId): void {
  window.location.hash = '#' + v;
}
