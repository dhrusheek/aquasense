// Renders the one active view and does the per-navigation housekeeping:
// document title, scroll to top, focus the view's <h1>, close the mobile drawer.
import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from 'react';
import { VIEWS, type ReleaseId, type ViewId } from '@/app/routes';
import { useHashRoute } from '@/app/useHashRoute';
import { useSidebar } from '@/components/ui/sidebar';
import { RELEASE } from '@/lib/constants';

// The release pages load on demand, so the evaluator bundle barely grows.
const RELEASE_COMPONENTS: Record<ReleaseId, ComponentType> = {
  story: lazy(() => import('@/release/Story')),
  live: lazy(() => import('@/release/Live')),
  floats: lazy(() => import('@/release/Floats')),
  build: lazy(() => import('@/release/Build')),
  connect: lazy(() => import('@/release/Connect')),
};

function Spinner() {
  return (
    <div role="status" className="flex justify-center py-24">
      <span aria-hidden="true" className="size-5 animate-spin rounded-full border-2 border-ink-3 border-t-transparent motion-reduce:animate-none" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

// The dashboard views are reachable only in the evaluator build; in release the whole branch folds away.
function LegacyView({ view }: { view: Exclude<ViewId, ReleaseId> }) {
  const [table, setTable] = useState<Record<string, ComponentType> | null>(null);
  useEffect(() => { void import('@/views').then((m) => setTable(m.VIEW_COMPONENTS)); }, []);
  const V = table?.[view];
  return V ? <V /> : <Spinner />;
}

export function ViewRouter() {
  const view = useHashRoute();
  const { setOpenMobile } = useSidebar();
  // Starts as the first view, so the initial mount (and StrictMode's re-run) never steals focus.
  const previous = useRef(view);

  useEffect(() => {
    document.title = `${VIEWS[view].title} · ${RELEASE ? 'AquaSense' : 'AquaSense-WSN'}`;
    if (previous.current === view) return;
    previous.current = view;
    window.scrollTo({ top: 0 });
    document.getElementById('view-title')?.focus({ preventScroll: true });
    setOpenMobile(false);
  }, [view, setOpenMobile]);

  // Only the active view is mounted; the key makes a route change a clean remount (charts re-measure).
  if (!(view in RELEASE_COMPONENTS)) return import.meta.env.VITE_AQ_RELEASE === '1' ? <Spinner /> : <LegacyView key={view} view={view as Exclude<ViewId, ReleaseId>} />;
  const View = RELEASE_COMPONENTS[view as ReleaseId];
  return <Suspense fallback={<Spinner />}><View key={view} /></Suspense>;
}
