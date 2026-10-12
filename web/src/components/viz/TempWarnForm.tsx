import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { KeyValue } from '@/components/aq/KeyValue';
import { StatusChip } from '@/components/aq/StatusChip';
import { Tray } from '@/components/aq/Tray';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setTempWarnPending, twText } from '@/data/tempWarn';
import { TEMP_WARN } from '@/lib/constants';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface TempWarnFormProps {
  /** node('N1').temp_warn, °C × 100. */
  tempWarn: number | null;
  /** tempC(node('N1').value). */
  liveC: number | null;
  /** node('N1').threshold. */
  flag: boolean | null;
  /** useTempWarnPending(): cleared when tempWarn === v or 30 s pass. */
  pending: { v: number; at: number } | null;
  online: boolean;
  /** ?mock: nothing is sent, a toast says so. */
  mock: boolean;
  /** POST /api/command {c:'TEMP_WARN', a:1, v}; reject with Error(message) on failure. */
  onSubmit: (v100: number) => Promise<{ id?: number } | null | undefined | void>;

  /* ---- additive ---- */
  /** Tray (or inline) title. Default `N1 over-temperature alert threshold`. */
  title?: string;
  /** Which view mounts the form (spec 03 §6, request 5); only labels the DOM. */
  source?: 'r1' | 'r6';
  /** Render the content only, with an inline heading, for use inside another Tray. Default false. */
  embedded?: boolean;
  /** Grid placement of the tray. */
  className?: string;
}

const TITLE = 'N1 over-temperature alert threshold';
const TOAST_ID = 'cmd-TEMP_WARN';

function fieldText(v100: number | null): string {
  return v100 === null ? '' : String(Math.round(v100) / 100);
}

/**
 * Sets N1's over-temperature alert threshold. The field follows the value N1 reports until the
 * user edits it; a sent value shows as pending until N1 reports it back.
 */
export function TempWarnForm({
  tempWarn, liveC, flag, pending, online, mock, onSubmit, title = TITLE, source, embedded = false, className,
}: TempWarnFormProps) {
  const uid = useId();
  const inputId = `${uid}-tw`, hintId = `${uid}-tw-hint`, errId = `${uid}-tw-err`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  // While a value is pending the field mirrors it: that is what N1 is about to report.
  const mirrored = fieldText(pending ? pending.v : tempWarn);
  const [typed, setTyped] = useState(mirrored);
  const [dirty, setDirty] = useState(false);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // The field mirrors the reported threshold only while it is neither focused nor edited.
  const text = focused || dirty ? typed : mirrored;

  // N1 confirmed the value: nothing is pending any more.
  useEffect(() => {
    if (pending && tempWarn === pending.v) setTempWarnPending(null);
  }, [pending, tempWarn]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const raw = text.trim();
    const c = raw === '' ? NaN : Number(raw);
    if (!Number.isFinite(c) || c < TEMP_WARN.minC || c > TEMP_WARN.maxC) {
      setError(raw === '' ? 'Enter a temperature in °C, from 0 to 150.' : 'Use a value from 0 to 150 °C.');
      inputRef.current?.focus();
      return;
    }
    setError('');
    const v = Math.round(c * 100);
    if (mock) {
      toast.message('Preview mode', {
        id: TOAST_ID,
        description: `“TEMP_WARN ${fmt(v / 100, 2)} °C” not sent (no server). With the server running N1 gets it in the next control slot.`,
      });
      return;
    }
    setBusy(true);
    try {
      const res = await onSubmit(v);
      setTempWarnPending({ v, at: performance.now() });
      setDirty(false);
      const id = res && typeof res === 'object' && res.id != null ? ` (#${res.id})` : '';
      toast.success(
        `Threshold ${fmt(v / 100, 2)} °C queued${id} → the sink broadcasts TEMP_WARN in the next control slot; N1 reports it back within about two superframes`,
        { id: TOAST_ID },
      );
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : String(err);
      setError(`Not sent: ${msg}`);
      toast.error(`Threshold not set: ${msg}`, { id: TOAST_ID });
    } finally {
      setBusy(false);
    }
  }

  const flagChip = flag === true ? <StatusChip tone="warn" size="sm">hot</StatusChip>
    : flag === false ? <StatusChip tone="neutral" size="sm">normal</StatusChip>
      : <StatusChip tone="neutral" size="sm">alert flag: —</StatusChip>;

  const body = (
    <form data-slot="temp-warn-form" data-source={source} noValidate onSubmit={(e) => void submit(e)} className="flex max-w-[560px] flex-col gap-5">
      <KeyValue
        items={[
          {
            k: 'Current threshold',
            v: (
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="tabular font-mono">{twText(tempWarn)}</span>
                {tempWarn === TEMP_WARN.def && <span className="text-[13px] text-muted-foreground">default</span>}
                {pending && (
                  <StatusChip tone="info" size="sm" role="status" aria-live="polite">
                    sent {fmt(pending.v / 100, 2)} °C · waiting for N1
                  </StatusChip>
                )}
              </span>
            ),
          },
          {
            k: 'Live N1 reading',
            v: (
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="tabular font-mono">{liveC === null ? '—' : fmt(liveC, 2, '°C')}</span>
                {flagChip}
              </span>
            ),
          },
        ]}
      />

      <div data-slot="field" data-invalid={error ? true : undefined} className="flex flex-col gap-2">
        <Label htmlFor={inputId}>Alert threshold (°C)</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            ref={inputRef}
            id={inputId}
            name="temp_warn"
            type="number"
            inputMode="decimal"
            step={TEMP_WARN.step}
            min={TEMP_WARN.minC}
            max={TEMP_WARN.maxC}
            placeholder="60"
            autoComplete="off"
            value={text}
            data-dirty={dirty || undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${hintId} ${errId}`}
            onChange={(e) => { setTyped(e.target.value); setDirty(true); if (error) setError(''); }}
            onFocus={() => { if (!dirty) setTyped(mirrored); setFocused(true); }}
            onBlur={() => setFocused(false)}
            className="tabular w-32 font-mono"
          />
          <Button
            type="submit"
            size="lg"
            data-slot="temp-warn-submit"
            disabled={busy || !online}
            aria-busy={busy || undefined}
            title={!online ? 'Dashboard is offline' : undefined}
          >
            {busy && <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />}
            Set threshold
          </Button>
        </div>
        <span id={hintId} className="text-[13px] text-muted-foreground">Set it just below the live reading to make the pond light blink red.</span>
        <span id={errId} role="alert" className={cn('text-[13px] text-bad', !error && 'hidden')}>{error}</span>
      </div>
    </form>
  );

  if (embedded) {
    return (
      <div className={cn('flex flex-col gap-4', className)}>
        <h3 className="min-w-0 text-sm font-semibold text-foreground">{title}</h3>
        {body}
      </div>
    );
  }
  return (
    <Tray title={title} className={className}>
      {body}
    </Tray>
  );
}
