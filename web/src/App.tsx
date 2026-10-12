import { useEffect } from 'react';
import { ThemeProvider } from '@/app/ThemeProvider';
import { ViewRouter } from '@/app/ViewRouter';
import { AppShell } from '@/components/shell/AppShell';
import { Toaster } from '@/components/ui/sonner';
import { PondLayer } from '@/components/pond';
import { PatternDefs } from '@/components/viz/PatternDefs';
import { toast } from 'sonner';
import { store } from '@/data/store';
import { RELEASE, SIM } from '@/lib/constants';

export default function App() {
  // Start polling /api/state (or the mock source) once; start() is idempotent under StrictMode.
  useEffect(() => { store.start(); }, []);

  // Hosted build: say once, and until closed, that none of this is live hardware.
  useEffect(() => {
    if (!SIM) return;
    if (RELEASE) {
      toast('Demo pond', {
        id: 'sim-notice',
        description: 'This pond is simulated so you can explore the dashboard. Connect your own floats to see your water.',
        duration: 10000,
        closeButton: true,
      });
      return;
    }
    toast.warning('This is a simulation', {
      id: 'sim-notice',
      description: 'The four nodes are simulated, not live hardware. They sometimes go offline and run through different scenarios.',
      duration: Infinity,
      closeButton: true,
    });
  }, []);

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
