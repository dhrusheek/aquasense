// One ESP32 on the r1 view: identity, role, status, live value, flag and its setup facts
// (port of the legacy `.node-card`, app.js 655-673 and nodeFlags 701-706).
import { KeyValue, type KeyValueItem } from '@/components/aq/KeyValue';
import { StatusChip } from '@/components/aq/StatusChip';
import { NodeGlyph } from '@/components/viz/NodeGlyph';
import { thresholdFlag } from '@/data/selectors';
import { twText } from '@/data/tempWarn';
import type { NodeId, NodeState } from '@/data/types';
import { SHORT_ROLE } from '@/lib/constants';
import { fmtAgo, fmtDur } from '@/lib/format';
import { nId } from '@/lib/safe';

/** Chip text is sentence case; the flag words arrive in lower case. */
function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface NodeSetupCardProps {
  id: NodeId;
  /** node(state, id); `{}` before the node has been heard. */
  node: NodeState;
  /** sensorText(): the live value and its unit. */
  value: { v: string; u: string };
  /** macAddr(): the ESP-NOW MAC learned from HELLO frames. */
  mac: string | null;
  /** Indices of the TDMA slots this node owns. */
  slots: number[];
  /** Wi-Fi channel shared by all nodes. */
  channel: string;
  /** The sink's IP on the laptop hotspot (shown on N4 only). */
  sinkIp: string;
}

function NodeStatus({ status }: { status: string | null | undefined }) {
  const s = String(status || '').toLowerCase();
  if (s === 'active') return <StatusChip tone="ok" dot className="ml-auto">Active</StatusChip>;
  if (s === 'inactive') return <StatusChip tone="bad" dot className="ml-auto">Inactive</StatusChip>;
  return <StatusChip tone="neutral" className="ml-auto">{status ? status : 'Unknown'}</StatusChip>;
}

export function NodeSetupCard({ id, node, value, mac, slots, channel, sinkIp }: NodeSetupCardProps) {
  // The card knows which node it is, so the flag reads correctly even before the node reports.
  const flag = thresholdFlag({ ...node, id }) ?? (id === 'N3' ? { label: 'Uncalibrated', tone: 'neutral' as const } : null);

  const items: KeyValueItem[] = [
    { k: 'Sensor', v: node.sensor || '—' },
    ...(node.unit ? [{ k: 'Unit', v: node.unit }] : []),
    ...(id === 'N1' ? [{ k: 'Alert threshold', v: twText(node.temp_warn), mono: true }] : []),
    { k: 'MAC', v: mac || '—', mono: true },
    ...(id === 'N4' ? [{ k: 'IP (hotspot)', v: sinkIp, mono: true }] : []),
    { k: 'Channel', v: channel, mono: true },
    { k: 'Uptime', v: fmtDur(node.uptime_s), mono: true },
    { k: 'Last heard', v: fmtAgo(node.last_seen_s), mono: true },
    { k: 'TDMA slot', v: slots.length ? slots.join(', ') : id === 'N4' ? 'listens' : '—', mono: true },
    { k: 'Next hop', v: id === 'N4' ? 'is the sink' : nId(node.next_hop), mono: true },
  ];

  return (
    <article
      data-slot="node-setup-card"
      data-node={id}
      aria-label={`${id} · ${SHORT_ROLE[id]}`}
      className="@container flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-card p-4 text-card-foreground sm:p-6"
    >
      {/* Avatar, title, status. In a narrow card the title drops to its own line under the avatar. */}
      <div className="flex flex-wrap items-center gap-3">
        <NodeGlyph id={id} size={28} label="inside" />
        <div className="order-last min-w-0 basis-full @[20rem]:order-none @[20rem]:flex-1 @[20rem]:basis-0">
          <h3 className="text-sm font-semibold text-foreground">{SHORT_ROLE[id]}</h3>
          <p className="text-[13px] text-muted-foreground">{node.role || '—'}</p>
        </div>
        <NodeStatus status={node.status} />
      </div>

      <p data-slot="node-value" className="flex flex-wrap items-baseline gap-x-2">
        <span className="tabular font-mono text-[28px] leading-9 font-medium text-foreground">{value.v}</span>
        <span className="font-mono text-[13px] text-muted-foreground">{value.u}</span>
      </p>

      {flag && (
        <div data-slot="node-flag">
          <StatusChip tone={flag.tone} size="sm">{sentence(flag.label)}</StatusChip>
        </div>
      )}

      <KeyValue items={items} className="border-t border-border pt-4" />
    </article>
  );
}
