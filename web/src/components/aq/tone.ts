// The one place a Tone becomes classes (spec 08 §3). One ink: ok / warn / info / neutral / water are a 1 px ink-3
// outline with ink-2 text, bad is `--bad`. Only the status dot of `ok` is green.
import type { Tone } from '@/data/types';

/** A status tone, or the accent. */
export type ChipTone = Tone | 'water';

/** Chip surface: `chip-g` (flat, 1 px outline in `--chip-c`) with ink text; `bad` in `--bad`. */
export const TONE_CHIP: Record<ChipTone, string> = {
  ok: 'chip-g [--chip-c:var(--ink-3)] text-muted-foreground',
  warn: 'chip-g [--chip-c:var(--ink-3)] text-muted-foreground',
  bad: 'chip-g [--chip-c:var(--bad)] text-bad-ink',
  info: 'chip-g [--chip-c:var(--ink-3)] text-muted-foreground',
  neutral: 'chip-g [--chip-c:var(--ink-3)] text-muted-foreground',
  water: 'chip-g [--chip-c:var(--ink-3)] text-muted-foreground',
};

/** Text colour that passes AA on the ground: ink, ink-2 for neutral, `--bad` for a failure. */
export const TONE_TEXT: Record<ChipTone, string> = {
  ok: 'text-foreground',
  warn: 'text-foreground',
  bad: 'text-bad-ink',
  info: 'text-foreground',
  neutral: 'text-muted-foreground',
  water: 'text-foreground',
};

/** Round mark for dots and the tone dot: `--ok`, outlined (warn), `--bad`. Size and `rounded-full` come from the caller. */
export const TONE_DOT: Record<ChipTone, string> = {
  ok: 'bg-ok rounded-full',
  warn: 'border border-foreground rounded-full',
  bad: 'bg-bad rounded-full',
  info: 'bg-foreground rounded-full',
  neutral: 'border border-ink-2 rounded-full',
  water: 'bg-foreground rounded-full',
};

/** What a status tone means in words, for screen readers (colour is never the only cue). */
export const TONE_WORD: Record<ChipTone, string> = {
  ok: 'good',
  warn: 'warning',
  bad: 'poor',
  info: 'info',
  neutral: 'neutral',
  water: 'selected',
};
