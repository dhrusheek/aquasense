export interface CheatCardProps {
  /** Rubric number, 1-8. */
  n: number;
  title: string;
  /** The key numbers of this rubric item, live. */
  live: string;
  text: string;
  /** Firmware modules, e.g. "ble_loc.h · sink.h". */
  code: string;
  /** The rubric view, e.g. "#r2". */
  href: string;
}

/** One viva card: rubric number, title, a live value, the explanation and the modules to open. */
export function CheatCard({ n, title, live, text, code, href }: CheatCardProps) {
  return (
    <article data-slot="cheat-card" className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border bg-card p-5 text-card-foreground max-sm:p-4">
      <div className="flex flex-col items-start gap-0.5">
        <a
          href={href}
          aria-label={`Rubric ${n}: open the ${title} view`}
          className="text-[13px] text-muted-foreground underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline"
        >
          Rubric {n}
        </a>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <p className="tabular font-mono text-[13px] wrap-break-word text-foreground">{live}</p>
      <p className="text-[13px] text-muted-foreground">{text}</p>
      <p>
        <span className="inline-block rounded-full bg-[var(--ink-4)] px-2.5 py-0.5 font-mono text-xs leading-5 text-muted-foreground">{code}</span>
      </p>
    </article>
  );
}
