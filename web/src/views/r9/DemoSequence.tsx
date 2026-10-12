import { ArrowRight, Check } from 'lucide-react';
import { VIEWS, type ViewId } from '@/app/routes';
import { StatusChip } from '@/components/aq/StatusChip';
import { cn } from '@/lib/utils';

export interface DemoSequenceStep {
  /** Step name; also the key into derived.demo_flow. */
  k: string;
  /** The rubric view that shows this step. */
  v: ViewId;
  /** Firmware module that implements it; shown as the row's tooltip. */
  mod: string;
  /** What to look for. */
  see: string;
  done: boolean;
}

export interface DemoSequenceProps {
  steps: DemoSequenceStep[];
  className?: string;
}

/**
 * The integrated demonstration sequence as a numbered list. Each row is one link to the view that
 * shows the step, so the whole row is clickable and Tab stops once per step.
 */
export function DemoSequence({ steps, className }: DemoSequenceProps) {
  const last = steps.length - 1;
  const next = steps.findIndex((s) => !s.done);
  return (
    <ol data-slot="demo-sequence" className={cn('flex flex-col', className)}>
      {steps.map((st, i) => (
        <li key={st.k} data-done={st.done || undefined} className="border-b border-border last:border-b-0">
          <a
            href={`#${st.v}`}
            title={st.mod}
            className="group -mx-2 grid rounded-lg grid-cols-[32px_minmax(0,1fr)] gap-x-3 gap-y-2 px-2 py-3 transition-colors duration-150 hover:bg-accent sm:grid-cols-[32px_minmax(0,1fr)_auto]"
          >
            {/* number cell on the rail that joins the steps; on a phone it also spans the meta row */}
            <span aria-hidden="true" className="relative row-span-2 flex justify-center self-stretch sm:row-span-1">
              {steps.length > 1 && (
                <span
                  className={cn(
                    'absolute left-1/2 w-px -translate-x-1/2 bg-border',
                    i === 0 ? 'top-3.5' : '-top-3',
                    i === last ? 'h-6.5' : '-bottom-3',
                  )}
                />
              )}
              <span
                className={cn(
                  'tabular relative flex size-7 items-center justify-center rounded-full border font-mono text-[13px] leading-none',
                  st.done
                    ? 'border-foreground bg-foreground text-card'
                    : i === next
                      ? 'border-2 border-foreground bg-card text-foreground'
                      : 'border-border bg-card text-muted-foreground',
                )}
              >
                {st.done ? <Check className="size-4" strokeWidth={3} /> : i + 1}
              </span>
            </span>

            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">
                <span className="sr-only">Step {i + 1}: </span>
                {st.k}
              </span>
              <span className="max-w-[72ch] text-[13px] text-muted-foreground">{st.see}</span>
            </span>

            {/* meta: under the text on a phone, a right-aligned column from 640 px */}
            <span className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:col-start-3 sm:flex-col sm:flex-nowrap sm:items-end">
              {st.done
                ? <StatusChip tone="ok" size="sm">Shown</StatusChip>
                : <StatusChip tone="neutral" size="sm">Pending</StatusChip>}
              <span className="inline-flex items-center gap-1 text-[13px] font-medium whitespace-nowrap text-foreground underline-offset-4 group-hover:underline group-focus-visible:underline">
                Open view
                <span className="sr-only">: {VIEWS[st.v].title}</span>
                <ArrowRight aria-hidden="true" className="size-3.5 shrink-0" />
              </span>
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}
