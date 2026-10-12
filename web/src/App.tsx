import { useEffect, useRef } from 'react';
import { ThemeProvider } from '@/app/ThemeProvider';
import { ViewRouter } from '@/app/ViewRouter';
import { AppShell } from '@/components/shell/AppShell';
import { Toaster } from '@/components/ui/sonner';
import { PondLayer } from '@/components/pond';
import { PatternDefs } from '@/components/viz/PatternDefs';
import { toast } from 'sonner';
import { useHashRoute } from '@/app/useHashRoute';
import { store } from '@/data/store';
import { RELEASE, SIM } from '@/lib/constants';

export default function App() {
  // Start polling /api/state (or the mock source) once; start() is idempotent under StrictMode.
  useEffect(() => { store.start(); }, []);

  const route = useHashRoute();
  const simShown = useRef(false);

  // Hosted build: say once that none of this is live hardware. Release: only on the live page, once per session.
  useEffect(() => {
    if (!SIM) return;
    if (RELEASE) {
      if (route !== 'live') return;
      try {
        if (sessionStorage.getItem('aq-demo-toast')) return;
        sessionStorage.setItem('aq-demo-toast', '1');
      } catch { /* storage blocked: show it each visit to the page */ }
      toast('Demo pond', {
        id: 'sim-notice',
        description: 'This pond is simulated so you can explore the dashboard. Connect your own floats to see your water.',
        duration: 8000,
        closeButton: true,
      });
      return;
    }
    if (simShown.current) return;
    simShown.current = true;
    toast.warning('This is a simulation', {
      id: 'sim-notice',
      description: 'The four nodes are simulated, not live hardware. They sometimes go offline and run through different scenarios.',
      duration: Infinity,
      closeButton: true,
    });
  }, [route]);

  return (
    <ThemeProvider>
      {/* Document-global SVG fill patterns (node identity is a pattern, never a hue). */}
      <PatternDefs />
      {/* Pond life: water and a goldfish under the cards (spec 09). */}
      <PondLayer />
      <AppShell>
        <ViewRouter />
      </AppShell>
      {/* Toasts sit on the card surface; only the icon carries the status hue. */}
      <Toaster
        position="bottom-right"
        duration={4200}
        richColors={false}
        toastOptions={{
          classNames: {
            toast: 'cn-toast',
            success: '[&_[data-icon]]:text-ok-ink',
            warning: '[&_[data-icon]]:text-warn-ink',
            error: '[&_[data-icon]]:text-bad-ink',
          },
        }}
      />
    </ThemeProvider>
  );
}
