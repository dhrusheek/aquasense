import type { ReactNode } from 'react';
import { TONE_CHIP, TONE_DOT, type ChipTone } from '@/components/aq/tone';
import { cn } from '@/lib/utils';

export interface StatusChipProps {
  /** ok / warn / bad / info / neutral are status; `water` is the accent (a selection, a link). */
  tone: ChipTone;
  children: ReactNode;
  /** Leading 6 px round dot: `--ok`, outlined (warn), `--bad`. Use this, never a "●" typed into the label. */
  dot?: boolean;
  /** 2 s opacity pulse on the dot; only for the live online pill. Off under reduced motion. */
  pulse?: boolean;
  /** Kept for call sites: chips are always sans 12. */
  mono?: boolean;
  size?: 'sm' | 'md';
  /** `inverse` = ink fill, ground text: the current row / current version. */
  variant?: 'soft' | 'inverse';
  title?: string;
  className?: string;
  role?: string;
  'aria-live'?: 'polite' | 'off';
}

/** A small status label: sans 12 pill, 1 px outline. `bad` is `--bad`, `inverse` is ink fill with card text. */
export function StatusChip({
  tone, children, dot = false, pulse = false, size = 'md', variant = 'soft',
  title, className, role, 'aria-live': ariaLive,
}: StatusChipProps) {
  return (
    <span
      data-slot="status-chip"
      data-tone={tone}
      data-variant={variant}
      title={title}
      role={role}
      aria-live={ariaLive}
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full border px-2.5 align-middle font-sans text-xs leading-none font-medium whitespace-nowrap tabular',
        size === 'sm' ? 'h-5' : 'h-[22px]',
        variant === 'inverse' ? 'bg-foreground border-foreground text-primary-foreground' : TONE_CHIP[tone],
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cn('size-1.5 shrink-0 rounded-full', variant === 'inverse' ? 'bg-primary-foreground' : TONE_DOT[tone], pulse && 'motion-safe:animate-pulse')}
        />
      )}
      {children}
    </span>
  );
}
