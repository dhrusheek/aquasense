// The Overview's "Live readings" rows (spec 05 §4.4): one line per sensing node, as plain data.
import { node, nodes, sensorText, thresholdFlag } from '@/data/selectors';
import type { Snapshot } from '@/data/store';
import type { Tone } from '@/data/types';

export const READING_NODES = ['N1', 'N2', 'N3'] as const;
export type ReadingNode = (typeof READING_NODES)[number];

/** Short labels; the node id beside each one says which board it is. */
export const READING_SHORT: Record<ReadingNode, string> = {
  N1: 'Temperature',
  N2: 'Turbidity',
  N3: 'Temperature (cluster head)',
};

export interface Reading {
  id: ReadingNode;
  label: string;
  /** Formatted value, "—" when the node has not reported one. */
  value: string;
  unit: string;
  /** Normal / Hot, Clear / Turbid, Uncalibrated; Inactive (bad) replaces it when the node is down. */
  flag: { label: string; tone: Tone };
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function flagOf(id: ReadingNode, n: ReturnType<typeof node>): Reading['flag'] {
  const status = String(n.status || '').toLowerCase();
  if (status && status !== 'active') return { label: 'Inactive', tone: 'bad' };
  if (id === 'N3') return { label: 'Uncalibrated', tone: 'neutral' };
  if (n.threshold !== true && n.threshold !== false) return { label: 'No flag yet', tone: 'neutral' };
  const f = thresholdFlag({ ...n, id });
  return f ? { label: sentence(f.label), tone: f.tone } : { label: 'No flag yet', tone: 'neutral' };
}

/** The three rows, in node order; empty before the sink's first uplink. */
export function readings(s: Snapshot): Reading[] {
  if (!nodes(s).length) return [];
  return READING_NODES.map((id) => {
    const n = node(s, id);
    const v = sensorText(s, { ...n, id });
    return {
      id,
      label: READING_SHORT[id],
      value: v.v,
      // sensorText says "raw ADC"; the row has room for the short form
      unit: v.u === 'raw ADC' ? 'ADC' : v.u,
      flag: flagOf(id, n),
    };
  });
}
