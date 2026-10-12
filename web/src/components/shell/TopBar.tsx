import { VIEWS, type ViewId } from '@/app/routes';
import { ThemeToggle } from '@/components/shell/ThemeToggle';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useSnapshot } from '@/data/hooks';
import { onlineText, sourceBadge } from '@/data/selectors';
import { StatusChip } from '@/components/aq/StatusChip';
import { RELEASE, SIM } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * Sticky top bar: sidebar trigger, view title, online indicator, superframe number, theme toggle.
 * Everything else that used to live here (data source, slot strip) is on the System page.
 */
export function TopBar({ view }: { view: ViewId }) {
  const s = useSnapshot();
  const online = onlineText(s);
  const sf = s.data?.sf;
  const isOn = online.tone === 'ok';
  const isOff = online.short === 'Offline';

  return (
    <header data-slot="top-bar" className="surface-page sticky top-0 z-10 h-14 shrink-0">
      <div className="flex h-full items-center gap-3 px-4 sm:px-6 lg:px-8">
        {/* Collapses the sidebar to its icon rail from 900 px up; opens the drawer below. */}
        <SidebarTrigger
          aria-label="Toggle navigation"
          title="Toggle navigation"
          className="-ml-2 size-10 shrink-0 transition-colors duration-150"
        />

        <p data-slot="top-bar-title" className="min-w-0 flex-1 truncate font-sans text-sm font-medium text-foreground">{VIEWS[view].title}</p>

        {/* The word changes only with the state, so the live region speaks once; the age is in the title. */}
        <span
          data-slot="top-bar-online"
          data-state={isOn ? 'online' : isOff ? 'offline' : 'connecting'}
          role="status"
          aria-live="polite"
          title={online.text}
          className="flex shrink-0 items-center gap-1.5 font-sans text-[13px] text-muted-foreground"
        >
          <span
            aria-hidden="true"
            className={cn('size-1.5 shrink-0 rounded-full', isOn ? 'bg-ok' : isOff ? 'bg-bad' : 'border border-ink-2')}
          />
          <span>{online.short}</span>
        </span>

        {RELEASE && SIM && <StatusChip tone="neutral" size="sm">{sourceBadge(s).text}</StatusChip>}

        {!RELEASE && <span
          data-slot="top-bar-sf"
          title="Superframe number"
          className="tabular hidden shrink-0 font-mono text-[13px] text-muted-foreground sm:inline"
        >
          SF {sf != null ? `#${sf}` : '—'}
        </span>}

        <ThemeToggle />
      </div>
    </header>
  );
}
