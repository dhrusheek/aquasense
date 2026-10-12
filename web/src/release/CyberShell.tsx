// Release shell ("night watch on the dock"): spine, ticker, content axis and the construction strip.
// Replaces the sidebar frame when RELEASE; styled by cyber.css under [data-skin=cyber].
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { useTheme } from 'next-themes';
import { RELEASE_IDS, VIEWS, type ReleaseId } from '@/app/routes';
import { navigate, useHashRoute } from '@/app/useHashRoute';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useSnapshot, useTicker } from '@/data/hooks';
import { ageNow, currentSlot, isOnline, lightOf, nodes } from '@/data/selectors';
import { LIGHT, SIM } from '@/lib/constants';
import { readings } from '@/views/overview/readings';
import { Ticker, useHotkeys } from './ui';

const NAV: Record<ReleaseId, string> = { story: 'story', live: 'live', floats: 'floats', build: 'build', connect: 'connect' };
const BUILD_ID: string = import.meta.env.VITE_BUILD_ID || 'dev';

const NAME: Record<string, string> = { N1: 'float 1 board', N2: 'float 2 turbidity', N3: 'bank node' };

function skipToMain(e: MouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
  document.getElementById('main')?.focus();
}

/** Lamp state as word + shape, never colour alone. */
function lampWord(state: string): { shape: string; word: string; tone: 'ok' | 'check' | 'wait' | 'test' } {
  if (state === 'green') return { shape: '●', word: 'ok', tone: 'ok' };
  if (state === 'red' || state === 'hot') return { shape: '▲', word: 'check', tone: 'check' };
  if (state === 'test') return { shape: '◆', word: 'test', tone: 'test' };
  return { shape: '○', word: 'waiting', tone: 'wait' };
}

/** Page weight in kB: every resource this page loaded except the polled API, plus the document. */
function usePageKb(route: string): number | null {
  const [kb, setKb] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => {
      let bytes = 0;
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      if (nav) bytes += nav.transferSize || nav.encodedBodySize || 0;
      for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
        if (e.name.includes('/api/') || e.name.includes('sim_frames')) continue;
        bytes += e.transferSize || e.encodedBodySize || 0;
      }
      setKb(bytes ? Math.round(bytes / 1000) : null);
    };
    if (document.readyState === 'complete') measure();
    else window.addEventListener('load', measure, { once: true });
    const id = window.setTimeout(measure, 1500);
    return () => { window.clearTimeout(id); window.removeEventListener('load', measure); };
  }, [route]);
  return kb;
}

export function CyberShell({ children }: { children: ReactNode }) {
  const view = useHashRoute();
  const snap = useSnapshot();
  const { resolvedTheme, setTheme } = useTheme();
  const [sheet, setSheet] = useState(false);
  useTicker(1000); // keeps the "last packet" age and the ticker's slot current between polls
  const kb = usePageKb(view);

  const online = isOnline(snap);
  const light = lightOf(snap).state;
  const lamp = lampWord(online ? light : 'off');
  const nodeCount = nodes(snap).length;
  const age = ageNow(snap);

  const items = useMemo(() => {
    const out: string[] = [];
    if (SIM) out.push('demo pond, simulated');
    for (const r of readings(snap)) {
      if (r.value === '—') continue;
      const unit = r.unit.toLowerCase();
      const base = `${NAME[r.id]} ${r.value}${unit ? ' ' + unit : ''}`;
      const flag = r.flag.label.toLowerCase();
      out.push(r.id === 'N2' && flag !== 'no flag yet' ? `${base} · ${flag}` : base);
    }
    if (snap.everOk) out.push(`lamp ${LIGHT[light].label.toLowerCase().replace(' · ', ' ')}`);
    const sl = currentSlot(snap);
    if (sl) out.push(`slot ${sl.idx + 1}/${sl.n}`);
    if (!out.length || (SIM && out.length === 1)) out.push('waiting for the first reading');
    return out;
    // snapshot identity changes once per poll; that is the refresh rate we want
  }, [snap, light]);

  const dark = resolvedTheme === 'dark';
  const keys = useMemo(() => {
    const m: Record<string, () => void> = {
      t: () => setTheme(dark ? 'light' : 'dark'),
      '?': () => setSheet((o) => !o),
    };
    RELEASE_IDS.forEach((id, i) => { m[String(i + 1)] = () => navigate(id); });
    return m;
  }, [dark, setTheme]);
  useHotkeys(keys);

  useEffect(() => {
    if (!sheet) return;
    const close = () => setSheet(false);
    window.addEventListener('keydown', close);
    window.addEventListener('pointerdown', close);
    return () => { window.removeEventListener('keydown', close); window.removeEventListener('pointerdown', close); };
  }, [sheet]);

  return (
    <TooltipProvider delayDuration={0}>
      {/* The page router reads the sidebar context; the cyber shell shows no sidebar. */}
      <SidebarProvider className="cy-app" defaultOpen={false}>
        <a href="#main" onClick={skipToMain} className="cy-skip">Skip to content</a>
        <header className="cy-spine">
          <a href="#story" className="cy-brand" aria-label="AquaSense, story page">AquaSense</a>
          <nav className="cy-nav" aria-label="Pages">
            {RELEASE_IDS.map((id, i) => (
              <a key={id} href={`#${id}`} className={view === id ? 'cy-chip cy-chip-active' : 'cy-chip'} aria-current={view === id ? 'page' : undefined}>
                <span aria-hidden="true">[{i + 1}]</span> {NAV[id]}
                <span className="sr-only">, key {i + 1}</span>
              </a>
            ))}
          </nav>
          <div className="cy-status" role="status" aria-label="Pond status">
            <span className="cy-stat"><span aria-hidden="true" className={online ? 'cy-dot-ok' : 'cy-dot-off'}>{online ? '●' : '○'}</span> {online ? 'online' : 'offline'}</span>
            <span className="cy-stat">lamp <span aria-hidden="true" className={`cy-lamp cy-lamp--${lamp.tone}`}>{lamp.shape}</span> {lamp.word}</span>
          </div>
          <button
            type="button"
            data-slot="theme-toggle"
            className="cy-chip cy-theme"
            onClick={() => setTheme(dark ? 'light' : 'dark')}
            aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`}
          >
            <span aria-hidden="true">[t]</span><span className="cy-theme-word"> {dark ? 'day' : 'night'}</span>
          </button>
        </header>

        <Ticker items={items} />

        <main id="main" tabIndex={-1} className="cy-main" data-slot="view">
          {children}
        </main>

        <footer className="cy-strip">
          <span>fig. build {BUILD_ID}</span>
          <span>page {kb === null ? '…' : kb} kB{SIM ? ' · demo data 3.9 MB' : ''}</span>
          <span>{nodeCount} {nodeCount === 1 ? 'node' : 'nodes'}</span>
          <span>last packet {age === null ? '—' : `${Math.round(age)} s ago`}</span>
          <span>open hardware · MIT</span>
          <button type="button" className="cy-strip-keys" onPointerDown={(e) => e.stopPropagation()} onClick={() => setSheet((o) => !o)}>[?] keys</button>
        </footer>

        {sheet && (
          <div className="cy-sheet" role="dialog" aria-label="Keyboard shortcuts" onPointerDown={(e) => e.stopPropagation()}>
            <p className="cy-h3">Keys</p>
            <ul>
              {RELEASE_IDS.map((id, i) => <li key={id}><kbd>{i + 1}</kbd> {VIEWS[id].shortTitle.toLowerCase()}</li>)}
              <li><kbd>t</kbd> day or night</li>
              <li><kbd>?</kbd> this sheet</li>
            </ul>
            <p className="cy-dim">any key closes</p>
          </div>
        )}
      </SidebarProvider>
    </TooltipProvider>
  );
}
