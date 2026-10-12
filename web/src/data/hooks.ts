// React bindings for the store: snapshot, selectors, tickers and commands.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { postCommand } from '@/data/api';
import { isOnline, netNow } from '@/data/selectors';
import { store, type Snapshot } from '@/data/store';
import type { Command, CommandOk, State } from '@/data/types';
import { SIM } from '@/lib/constants';

/** The current store snapshot; re-renders on every poll (1 Hz). */
export function useSnapshot(): Snapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** `sel(useSnapshot())`. Fine at 1 Hz; no memoisation needed. */
export function useSelector<T>(sel: (s: Snapshot) => T): T {
  return sel(useSnapshot());
}

/** The latest state document, or null before the first successful poll. */
export function useAppState(): State | null {
  return useSnapshot().data;
}
/** Spec name for useAppState (a plain `useState` would shadow React's). */
export const useState_ = useAppState;

/**
 * Re-render every `ms` milliseconds; returns performance.now() at the last tick.
 * The interval is cleared on unmount and paused while the tab is hidden.
 */
export function useTicker(ms: number): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    let id: number | undefined;
    const start = () => {
      if (id === undefined) id = window.setInterval(() => setNow(performance.now()), ms);
    };
    const stop = () => {
      if (id !== undefined) { window.clearInterval(id); id = undefined; }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else { setNow(performance.now()); start(); }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ms]);
  return now;
}

/** Network time in ms, refreshed every `ms` (default 250); null before the first fetch. */
export function useNetNow(ms: number = 250): number | null {
  useTicker(ms);
  return netNow(useSnapshot());
}

/** Last poll succeeded and the sink is not reported silent. */
export function useOnline(): boolean {
  return isOnline(useSnapshot());
}

export interface SendOptions {
  /** Success toast text; default is the legacy "Command queued (#id) → …" sentence. */
  success?: (res: CommandOk) => string;
  /** Second sentence of the mock-mode toast; default "With the server running it is queued for the sink." */
  previewNote?: string;
}

/**
 * Post a command to the sink (POST /api/command) with the legacy toasts (app.js 1613-1623).
 * In ?mock mode nothing is sent. `send` never rejects: it resolves the reply, or null on preview / failure.
 */
export function useCommand(): {
  pending: boolean;
  send(cmd: Command, opts?: SendOptions): Promise<CommandOk | null>;
} {
  const [pending, setPending] = useState(false);
  const send = useCallback(async (cmd: Command, opts?: SendOptions): Promise<CommandOk | null> => {
    // A stable id per command name, so repeated clicks replace the toast instead of stacking.
    const id = `cmd-${cmd.c}`;
    if (store.getSnapshot().mock) {
      toast.message(SIM ? 'Simulation' : 'Preview mode', {
        id,
        description: SIM ? `“${cmd.c}” is not sent. This is a simulation and the scenarios run on their own.` : `“${cmd.c}” not sent (no server). ${opts?.previewNote ?? 'With the server running it is queued for the sink.'}`,
      });
      return null;
    }
    setPending(true);
    try {
      const res = await postCommand(cmd);
      toast.success(
        opts?.success?.(res)
          ?? `Command queued${res.id != null ? ` (#${res.id})` : ''} → sink will broadcast it in the next control slot`,
        { id },
      );
      return res;
    } catch (e) {
      toast.error(`Command failed: ${e instanceof Error && e.message ? e.message : String(e)}`, { id });
      return null;
    } finally {
      setPending(false);
    }
  }, []);
  return { pending, send };
}
