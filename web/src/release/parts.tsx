// Small shared pieces of the five release pages: the page title, a plain card and the link buttons.
import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { ArtScene } from '@/components/art';
import { cn } from '@/lib/utils';
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
export function IdeaCard({ icon, title, media, children }: { icon?: ReactNode; title: string; media?: ReactNode; children: ReactNode }) {
  return (
    <article className="surface-card flex min-w-0 flex-col gap-3 overflow-hidden p-0 text-card-foreground">
      {media}
      <div className="flex min-w-0 flex-col gap-3 p-4 sm:p-6">
      {icon && <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full border border-ink-3 text-foreground [&_svg]:size-4">{icon}</span>}
      <h3 className="text-[15px] leading-6 font-semibold text-foreground">{title}</h3>
      <p className="max-w-[60ch] text-sm leading-6 text-muted-foreground">{children}</p>
      </div>
    </article>
  );
}

/** The art area of a card: `card` sits flush at the top (16:9), `band` stands alone (3:1, 2:1 on phones), `thumb` is a square. */
export function CardMedia({ kind = 'card', ground, className, children }: { kind?: 'card' | 'band' | 'thumb'; ground?: 'night'; className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center justify-center overflow-hidden',
        ground === 'night' ? 'bg-deep [&_.ascii]:!text-[color:var(--n4)] dark:[&_.ascii]:!text-[color:var(--n3)]' : 'bg-card',
        kind === 'card' && 'aspect-[16/9] w-full rounded-t-[16px]',
        kind === 'band' && 'aspect-[2/1] w-full rounded-[16px] border border-ink-3 sm:aspect-[3/1]',
        kind === 'thumb' && 'aspect-square rounded-xl border border-ink-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A Tray-looking section with a media area flush above its title. */
export function MediaTray({ title, media, className, children }: { title: string; media: ReactNode; className?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-slot="tray" className={cn('surface-tray flex min-w-0 flex-col overflow-hidden', className)}>
      {media}
      <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-6">
        <h2 id={id} className="tray-title">{title}</h2>
        <div className="flex min-w-0 flex-1 flex-col gap-4 text-card-foreground">{children}</div>
      </div>
    </section>
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

/** Empty state with a still dotted pond above its sentence. */
export function ArtEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <CardMedia kind="band" className="aspect-[3/1] w-full max-w-[260px] sm:aspect-[3/1]">
        <ArtScene scene="waves" mode="dots" tint="ink" aspect="3/1" animate="none" cell="sm" className="h-full w-full" />
      </CardMedia>
      {children}
    </div>
  );
}

/** Scales its child down (never up) so it fits the media box without clipping. */
export function FitBox({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const fit = () => {
      const box = o.parentElement;
      if (!box) return;
      const k = Math.min(1, box.clientWidth / i.offsetWidth, box.clientHeight / i.offsetHeight);
      i.style.transform = k < 1 ? `scale(${k})` : '';
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (o.parentElement) ro.observe(o.parentElement);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} className="flex size-full items-center justify-center overflow-hidden">
      <div ref={inner} className="shrink-0 origin-center">{children}</div>
    </div>
  );
}
