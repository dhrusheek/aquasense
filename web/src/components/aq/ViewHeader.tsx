import type { ReactNode } from 'react';
import { VIEWS, type ViewId } from '@/app/routes';
import type { AsciiProps } from '@/components/ascii/Ascii';
import { cn } from '@/lib/utils';

export interface ViewHeaderProps {
  view: ViewId;
  /** Right-aligned from 900 px up: a CommandButton, an export link. */
  aside?: ReactNode;
  /** Kept for call sites; the ASCII title motif is withdrawn (spec 08 §4), so this is ignored. */
  motifParams?: AsciiProps['params'];
  className?: string;
}

/**
 * First child of every view: the <h1>, and, on rubric views, the one sentence
 * naming the criterion the view proves. Carries the 40 px gap to the first tray.
 */
export function ViewHeader({ view, aside, className }: ViewHeaderProps) {
  const v = VIEWS[view];
  const criterion = v.group === 'rubric' && v.n !== null ? `Rubric ${v.n} · ${v.marks ?? ''} — ${v.proves ?? ''}` : null;
  return (
    // A <div>, not a <header>: the page has exactly one <header> landmark, the top bar.
    <div data-slot="view-header" className={cn('mb-8 flex flex-col gap-2', className)}>
      <div className="flex flex-col gap-3 min-[900px]:flex-row min-[900px]:items-start min-[900px]:justify-between">
        <div className="flex min-w-0 flex-wrap items-center">
          {/* tabIndex -1: the router moves focus here on navigation (see ViewRouter). */}
          <h1 id="view-title" tabIndex={-1} className="font-sans text-2xl leading-8 font-semibold text-foreground outline-none sm:text-[26px] sm:leading-9">
            {v.title}
          </h1>
        </div>
        {aside != null && aside !== false && (
          <div data-slot="view-header-aside" className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div>
        )}
      </div>
      {criterion && (
        <p data-slot="view-criterion" className="max-w-[72ch] font-sans text-sm leading-6 text-muted-foreground">{criterion}</p>
      )}
    </div>
  );
}
