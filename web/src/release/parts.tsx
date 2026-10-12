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
