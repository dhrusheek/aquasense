import { cn } from '@/lib/utils';

export interface ExplainListProps {
  title: string;
  steps: string[];
  verdict: string;
  className?: string;
}

/** The plain-language reading of the contention test: numbered steps, then the verdict in bold. */
export function ExplainList({ title, steps, verdict, className }: ExplainListProps) {
  return (
    <div data-slot="explain-list" className={cn('rounded-xl bg-[var(--ink-4)] p-4', className)}>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <ol className="mt-2 flex max-w-[76ch] flex-col gap-1.5 text-sm leading-normal text-foreground">
        {steps.map((step, i) => (
          <li key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-1">
            <span className="tabular font-mono text-[13px] leading-[21px] text-muted-foreground">{i + 1}.</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 max-w-[76ch] text-sm font-semibold text-foreground">{verdict}</p>
    </div>
  );
}
