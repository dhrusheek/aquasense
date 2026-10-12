import { useState, type ReactNode } from 'react';
import { Lightbulb, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { StatusChip } from '@/components/aq/StatusChip';
import { Tray } from '@/components/aq/Tray';
import { Button } from '@/components/ui/button';
import { LIGHT, RELEASE } from '@/lib/constants';
import { fmtAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import './viz.css';

export type LightCardState = 'green' | 'red' | 'hot' | 'stale' | 'test' | 'off';

export interface LightCardProps {
  /**
   * Overview: lamp, state word, reason and the button; nothing else.
   * Full (r1) adds the `since` · GPIO line and the rule table.
   */
  compact: boolean;
  /** lightOf(state). */
  light: {
    state: LightCardState;
    reason: string;
    since: number | null;
    pins: { green?: number | null; red?: number | null };
  };
  /** Network clock in ms; null before the first fetch. */
  netNow: number | null;
  online: boolean;
  /** ?mock: nothing is sent, the button explains itself. */
  mock: boolean;
  /** POST /api/command {c:'LIGHT_TEST'}; resolve the reply (its `id` is quoted in the toast), reject with Error(message) on failure. */
  onTest: () => Promise<unknown>;

  /* ---- additive ---- */
  /** Tray (or inline) title. Default `Pond status light`. */
  title?: string;
  /** Render the content only, with an inline heading, for use inside another Tray. Default false. */
  embedded?: boolean;
  /** Grid placement of the tray, e.g. `col-span-12 lg:col-span-8`. */
  className?: string;
}

const TITLE = 'Pond status light';
/** Priority order of spec §9.3, top to bottom. */
const RULE_ORDER: LightCardState[] = ['test', 'off', 'stale', 'red', 'hot', 'green'];
const TOAST_ID = 'cmd-LIGHT_TEST';

type LampColour = 'red' | 'green';
// Lit = a solid round lens in `--bad` / `--ok` with a card-coloured letter; unlit = an ink-4 lens with a 1 px ink-3 rim
// (`.aq-lamp`, viz.css). `--lamp` feeds the blink keyframes. There is no yellow lamp: the sink has two LEDs.
const LAMPS: { colour: LampColour; letter: string; lamp: string }[] = [
  { colour: 'red', letter: 'R', lamp: 'var(--bad)' },
  { colour: 'green', letter: 'G', lamp: 'var(--ok)' },
];

/** Which lamps are lit (the resting state) and how they animate, per light state. */
function lampMode(state: LightCardState, colour: LampColour): { lit: boolean; anim?: string } {
  if (state === 'hot') return colour === 'red' ? { lit: true, anim: 'aq-lamp-blink' } : { lit: false };
  if (state === 'stale') return colour === 'green' ? { lit: true, anim: 'aq-lamp-blink' } : { lit: false };
  if (state === 'test') return { lit: true, anim: 'aq-lamp-cycle' };
  return { lit: state === colour };
}

/**
 * The two LEDs on the sink, as flat round lenses: red and green. The one place colour is used at size.
 * `hot` blinks the red lens and `stale` the green one; `test` lights red, then green (1 s each).
 * Off = an ink-4 lens with its letter; lit = a solid lens with a card-coloured letter.
 */
export function Lamp({ state, horizontal, className }: { state: LightCardState; horizontal: boolean; className?: string }) {
  return (
    <div
      role="img"
      aria-label={`Status light ${LIGHT[state].label}`}
      data-slot="lamp"
      data-state={state}
      className={cn('flex shrink-0 gap-2.5', horizontal ? 'flex-row' : 'flex-col', className)}
    >
      {LAMPS.map((l) => {
        const m = lampMode(state, l.colour);
        return (
          <span
            key={l.colour}
            aria-hidden="true"
            data-lamp={l.colour}
            data-lit={m.lit || undefined}
            className={cn(
              'aq-lamp flex items-center justify-center font-mono text-2xs leading-none font-bold',
              horizontal ? 'size-8' : 'size-9',
              m.anim,
            )}
            style={{ '--lamp': l.lamp } as React.CSSProperties}
          >
            {l.letter}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Pond status light at N4: the lamp, its state and reason, and a button that makes N4 cycle its
 * LEDs. No subtitle; the full variant ends its `since` line with the two GPIO pins the sink reports.
 */
export function LightCard({ compact, light, netNow, online, mock, onTest, title = TITLE, embedded = false, className }: LightCardProps) {
  const [pending, setPending] = useState(false);
  const meta = LIGHT[light.state];
  // Before the first uplink there is no clock and no light report: say so instead of "Off".
  const waiting = netNow === null && light.since === null && !light.reason;
  // Full variant only, and only once the sink has reported when the light last changed.
  const since = !compact && light.since !== null && netNow !== null
    ? 'since ' + fmtAgo((netNow - light.since) / 1000).replace(' ago', '')
    : null;
  // Full variant only: green / red, as in `light.pins`.
  const gpio = !compact && typeof light.pins.green === 'number' && typeof light.pins.red === 'number'
    ? `GPIO ${light.pins.green}/${light.pins.red}`
    : null;
  const sinceLine = [since, gpio].filter(Boolean).join(' · ');

  async function test() {
    if (pending) return;
    if (mock) {
      if (RELEASE) {
        toast.message('Demo pond', { id: TOAST_ID, description: 'The light test runs on your own dock node; it is not sent from the demo.' });
        return;
      }
      toast.message('Preview mode: “LIGHT_TEST” not sent (no server). With the server running N4 cycles red, then green.', { id: TOAST_ID });
      return;
    }
    setPending(true);
    try {
      const res = await onTest();
      // The legacy sentence (app.js 1629-1641), command id included.
      const id = res !== null && typeof res === 'object' && 'id' in res && res.id != null ? ` (#${String(res.id)})` : '';
      toast.success(`Light test queued${id} → N4 cycles red, then green (1 s each) after its next uplink`, { id: TOAST_ID });
    } catch (e) {
      toast.error(`Light test not sent: ${e instanceof Error && e.message ? e.message : String(e)}`, { id: TOAST_ID });
    } finally {
      setPending(false);
    }
  }

  const button = (
    <Button
      type="button"
      variant="outline"
      size="lg"
      data-slot="light-test"
      disabled={pending || !online}
      aria-busy={pending || undefined}
      title={!online ? 'Dashboard is offline' : undefined}
      onClick={() => void test()}
    >
      {pending
        ? <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
        : <Lightbulb aria-hidden="true" className="size-4" />}
      Test light
    </Button>
  );

  const body: ReactNode = (
    <div data-slot="light-card" data-compact={compact || undefined} className="flex flex-col gap-5">
      <div className={cn('flex gap-4', compact ? 'flex-wrap items-center' : 'items-start')}>
        <Lamp state={waiting ? 'off' : light.state} horizontal={compact} />
        <div className={cn('flex min-w-0 flex-col', compact ? 'gap-0.5' : 'gap-1.5')}>
          {compact ? (
            <p aria-live="polite" className="text-sm leading-5 font-semibold text-foreground">{waiting ? '—' : meta.label}</p>
          ) : (
            <div>
              {waiting
                ? <StatusChip tone="neutral" aria-live="polite">—</StatusChip>
                : <StatusChip tone={meta.tone} aria-live="polite">{meta.label}</StatusChip>}
            </div>
          )}
          <p className={compact ? 'text-[13px] text-muted-foreground' : 'text-sm text-foreground'}>
            {waiting ? 'waiting for the first uplink' : light.reason || meta.rule}
          </p>
          {sinceLine && <p className="tabular font-mono text-[13px] text-muted-foreground">{sinceLine}</p>}
        </div>
      </div>

      {!compact && (
        <ul data-slot="light-rules" className="flex flex-col divide-y divide-border border-t border-border">
          {RULE_ORDER.map((k) => (
            <li key={k} className="flex items-baseline gap-3 py-2">
              <StatusChip tone={LIGHT[k].tone} size="sm" className="w-28 justify-center">{LIGHT[k].label.split(' · ')[0]}</StatusChip>
              <span className="min-w-0 text-sm text-foreground">{LIGHT[k].rule}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  if (embedded) {
    return (
      <div className={cn('flex flex-col gap-4', className)}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <h3 className="min-w-0 text-sm font-semibold text-foreground">{title}</h3>
          {button}
        </div>
        {body}
      </div>
    );
  }
  return (
    <Tray title={title} actions={button} className={className}>
      {body}
    </Tray>
  );
}
