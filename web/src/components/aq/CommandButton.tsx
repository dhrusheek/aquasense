import { useLayoutEffect, useEffect, useRef, useState, type ReactNode } from 'react';
import { paint, register } from '@/components/ascii/engine';
import { useReducedMotion } from '@/components/viz/hooks';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useCommand, useOnline } from '@/data/hooks';
import type { Command, CommandOk } from '@/data/types';
import { cn } from '@/lib/utils';

export interface CommandButtonProps {
  /** The exact object posted to POST /api/command. */
  command: Command;
  label: string;
  /** Leading 16 px icon. */
  icon?: ReactNode;
  /** `outline` (default): 1 px ink-3 outline. `default`: ink fill. `destructive`: RESET_STATS and link failures. */
  variant?: 'default' | 'outline' | 'ghost' | 'destructive';
  size?: 'default' | 'sm';
  /** Ask this question in a dialog before sending. */
  confirm?: string;
  /** Text of the dialog's confirm button: a short verb. Default: the first word of `label` ("Reset statistics" → "Reset"). */
  confirmLabel?: string;
  /** Success toast text; default is the legacy "Command queued (#id) → …" sentence. */
  success?: (res: CommandOk) => string;
  /** Second sentence of the mock-mode toast. */
  previewNote?: string;
  /** Disable while the dashboard is offline (default true). */
  requireOnline?: boolean;
  /** Keep the button disabled this long after the reply (default 0; the legacy page used 3000). */
  cooldownMs?: number;
  disabled?: boolean;
  /** Called after the reply: the server answer, or null on preview / failure. */
  onDone?: (res: CommandOk | null) => void;
  className?: string;
}

const BRAILLE = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const brailleFrame = (frame: number) => BRAILLE[frame % BRAILLE.length];

/** Braille spinner for the icon slot, 80 ms per frame, driven by the shared ascii loop. 1ch wide. */
function BrailleSpinner() {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced) {
      paint(el, '⠿');
      return;
    }
    const stop = register(el, brailleFrame, 12.5, {}, { cols: 1, rows: 1 });
    return () => { stop(); };
  }, [reduced]);
  return <span ref={ref} aria-hidden="true" className="inline-block w-[1ch] text-center font-mono leading-none" />;
}

// Fill, outline and destructive styles come from the Button variants; only the shared padding is set here.

/** A button that queues one command for the sink, with pending, offline, confirm and toast handling. */
export function CommandButton({
  command, label, icon, variant = 'outline', size = 'default', confirm, confirmLabel, success, previewNote,
  requireOnline = true, cooldownMs = 0, disabled = false, onDone, className,
}: CommandButtonProps) {
  const { pending, send } = useCommand();
  const online = useOnline();
  const [asking, setAsking] = useState(false);
  const [cooling, setCooling] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const offline = requireOnline && !online;
  const blocked = disabled || pending || cooling || offline;

  async function run() {
    const res = await send(command, { success, previewNote });
    if (cooldownMs > 0) {
      setCooling(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCooling(false), cooldownMs);
    }
    onDone?.(res);
  }

  return (
    <>
      <Button
        type="button"
        data-slot="command-button"
        data-command={command.c}
        variant={variant}
        size={size === 'sm' ? 'sm' : 'lg'}
        disabled={blocked}
        aria-busy={pending || undefined}
        title={offline ? 'Dashboard is offline' : undefined}
        onClick={() => (confirm ? setAsking(true) : void run())}
        className={cn('px-4 transition-colors duration-150', className)}
      >
        {pending
          ? <span aria-hidden="true" className="inline-flex size-4 items-center justify-center"><BrailleSpinner /></span>
          : icon != null && <span aria-hidden="true" className="inline-flex [&_svg]:size-4">{icon}</span>}
        {label}
      </Button>

      {confirm && (
        <Dialog open={asking} onOpenChange={setAsking}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>{label}</DialogTitle>
              <DialogDescription>{confirm}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" size="lg" className="px-4">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant={variant === 'destructive' ? 'destructive' : 'default'}
                size="lg"
                className="px-4"
                onClick={() => { setAsking(false); void run(); }}
              >
                {confirmLabel ?? (label.trim().split(/\s+/)[0] || label)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
