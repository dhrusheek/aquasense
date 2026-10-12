import { cn } from '@/lib/utils';

/** A piece of formula text: plain, highlighted (`hl`: a live value) or dimmed (`dim`: a side note). */
export type FormulaSegment = string | { hl: string } | { dim: string };

export interface FormulaBlockProps {
  /**
   * The formula, top to bottom. Each plain string is a line (it may also contain "\n" itself).
   * `{ hl }` and `{ dim }` segments stay on the line of the text before them, so
   * `['d = ', { hl: '48 cm' }]` is one line and `['a = b', 'c = d']` is two.
   */
  lines: FormulaSegment[];
  className?: string;
}

/**
 * A formula in mono, kept verbatim (white-space: pre). Wide formulas scroll inside the block,
 * never the page.
 */
export function FormulaBlock({ lines, className }: FormulaBlockProps) {
  return (
    <pre
      data-slot="formula-block"
      tabIndex={0}
      className={cn(
        'max-w-full overflow-x-auto rounded-xl bg-ink-4 p-4 font-mono text-[13px] leading-[1.7] text-card-foreground',
        className,
      )}
    >
      {lines.map((seg, i) => {
        // A line break goes between two consecutive plain strings; inline segments never add one.
        const prev = i > 0 ? lines[i - 1] : null;
        const breakBefore = typeof seg === 'string' && typeof prev === 'string' && !prev.endsWith('\n');
        if (typeof seg === 'string') return <span key={i}>{breakBefore ? '\n' : ''}{seg}</span>;
        if ('hl' in seg) {
          return <span key={i} className="rounded-md border border-ink-3 bg-card px-1 font-medium text-foreground">{seg.hl}</span>;
        }
        return <span key={i} className="text-muted-foreground">{seg.dim}</span>;
      })}
    </pre>
  );
}
