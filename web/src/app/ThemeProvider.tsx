// Light by default (spec 08 §1), dark on request. The choice is stored as "light" | "dark" under `aq-theme`,
// the same key and values as the legacy page, so a saved choice carries over.
// index.html applies the stored class before first paint (no flash).
import type { ReactNode } from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { RELEASE } from '@/lib/constants';

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={RELEASE ? 'system' : 'light'}
      enableSystem={RELEASE}
      storageKey="aq-theme"
      disableTransitionOnChange
      // next-themes renders its own no-flash <script>. In a client-only app React never runs it
      // (index.html does that job) and warns about it in dev; marking it a data block silences that.
      scriptProps={{ type: 'application/json' }}
    >
      {children}
    </NextThemesProvider>
  );
}
