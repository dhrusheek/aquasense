import { useId } from 'react';
import { ArrowRight } from 'lucide-react';
import { DEMO_STEPS } from '@/lib/constants';
import { ProgressCells } from '../r9/ProgressCells';

export interface DemoStripProps {
  /** derived.demo_flow: step name → shown. */
  flow: Record<string, boolean>;
}

/**
 * The 17-step demonstration as one line: a cell per step, the count, the next step and a link to
 * the full list on #r9 (spec 05 §4.7).
 */
export function DemoStrip({ flow }: DemoStripProps) {
  const titleId = useId();
  const done = DEMO_STEPS.map((st) => flow[st.k] === true);
  const count = done.filter(Boolean).length;
  const next = done.indexOf(false);
  const total = DEMO_STEPS.length;

  return (
    <section
      aria-labelledby={titleId}
      data-slot="demo-strip"
      className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border bg-card px-6 py-4 max-sm:px-4"
    >
      <h2 id={titleId} className="tray-title">Demo flow</h2>
      <ProgressCells steps={done} count={false} className="shrink-0" />
      <span aria-hidden="true" className="tabular font-mono text-[13px] whitespace-nowrap text-foreground">
        {count} / {total}
      </span>
      <span className="min-w-0 text-[13px] text-muted-foreground">
        {next === -1 ? `all ${total} shown` : `next: ${DEMO_STEPS[next].k}`}
      </span>
      <a
        href="#r9"
        className="inline-flex items-center gap-1 text-[13px] whitespace-nowrap text-foreground underline underline-offset-4 transition-colors duration-150 hover:bg-[var(--ink-4)] max-sm:basis-full sm:ml-auto"
      >
        View all
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </a>
    </section>
  );
}
