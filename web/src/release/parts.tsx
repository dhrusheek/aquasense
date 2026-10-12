// Small shared pieces of the five release pages: the page title, a plain card and the link buttons.
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { LINKS } from './links';

/** The page's single <h1>, set like ViewHeader's, with an optional grey sentence under it. */
export function PageTitle({ title, note }: { title: string; note?: ReactNode }) {
  return (
    <div data-slot="view-header" className="mb-8 flex flex-col gap-2">
      {/* tabIndex -1: the router moves focus here on navigation. */}
      <h1 id="view-title" tabIndex={-1} className="font-sans text-2xl leading-8 font-semibold text-foreground outline-none sm:text-[26px] sm:leading-9">
        {title}
      </h1>
      {note && <p className="max-w-[72ch] text-sm leading-6 text-muted-foreground">{note}</p>}
    </div>
  );
}

/** One idea per card: an optional icon, a heading and a short paragraph. */
export function IdeaCard({ icon, title, children }: { icon?: ReactNode; title: string; children: ReactNode }) {
  return (
    <article className="surface-card flex min-w-0 flex-col gap-3 p-4 text-card-foreground sm:p-6">
      {icon && <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full border border-ink-3 text-foreground [&_svg]:size-4">{icon}</span>}
      <h3 className="text-[15px] leading-6 font-semibold text-foreground">{title}</h3>
      <p className="max-w-[60ch] text-sm leading-6 text-muted-foreground">{children}</p>
    </article>
  );
}

export function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return <h2 id={id} className="text-xl leading-7 font-semibold tracking-[-0.01em] text-foreground">{children}</h2>;
}

/** "Get the source" and "Follow on X": each renders only when its link is set. */
export function LinkButtons({ contact = false }: { contact?: boolean }) {
  const items: { href: string; label: string }[] = [
    { href: LINKS.source, label: 'Get the source' },
    { href: LINKS.x, label: 'Follow on X' },
    ...(contact ? [{ href: LINKS.contact, label: 'Write to me' }] : []),
  ].filter((i) => i.href);
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((i) => (
        <Button key={i.label} asChild variant="outline" size="lg" className="rounded-full">
          <a href={i.href} target="_blank" rel="noreferrer noopener">{i.label}</a>
        </Button>
      ))}
    </div>
  );
}
