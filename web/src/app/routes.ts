// View registry: ids, titles, rubric marks, the criterion each rubric view proves, and the ASCII
// motif shown beside the title (spec 05 §3.1). Rubric text is ported from server/static/app.js 38-49.
import {
  Activity, Antenna, BookOpen, Cpu, Gauge, Layers, LayoutDashboard, ListChecks, ListTree, LocateFixed, Plug, RadioTower, Route,
  Server, Share2, Timer, Waves, Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { AsciiName } from '@/components/ascii/anims';
import { RELEASE } from '@/lib/constants';

export type ViewId =
  | 'home' | 'overview' | 'events' | 'system'
  | 'r1' | 'r2' | 'r3' | 'r4' | 'r5' | 'r6' | 'r7' | 'r8' | 'r9'
  | 'story' | 'live' | 'floats' | 'build' | 'connect';

/** The five pages of the public release site (only navigable when RELEASE). */
export type ReleaseId = 'story' | 'live' | 'floats' | 'build' | 'connect';
export const RELEASE_IDS: ReleaseId[] = ['story', 'live', 'floats', 'build', 'connect'];
export const isReleaseId = (x: string): x is ReleaseId => (RELEASE_IDS as string[]).includes(x);

export interface ViewDef {
  id: ViewId;
  /** Rubric number, null for the four pages. */
  n: number | null;
  /** Full title: the view's <h1>, the top bar and document.title. */
  title: string;
  /** Sidebar label. */
  shortTitle: string;
  /** "2 marks"; empty for the four pages. */
  marks?: string;
  /** The rubric criterion this view proves: one sentence under the title of a rubric view (pages show none). */
  proves?: string;
  icon: LucideIcon;
  /** ASCII animation beside the title. `home` names its hero (`ripple`); ViewHeader draws none there. */
  motif: AsciiName;
  group: 'pages' | 'rubric';
}

/** Every view, in sidebar order: the four pages, then the nine rubric views. */
export const VIEW_IDS: ViewId[] = RELEASE ? [...RELEASE_IDS] : [
  'home', 'overview', 'events', 'system', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9',
];

/** The four pages that are not rubric views. */
export const PAGE_IDS: ViewId[] = RELEASE ? [...RELEASE_IDS] : ['home', 'overview', 'events', 'system'];

/** The nine rubric views, in sidebar order. */
export const RUBRIC_IDS: ViewId[] = RELEASE ? [] : ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9'];

const LEGACY_VIEWS = {
  home: { id: 'home', n: null, title: 'Home', shortTitle: 'Home', marks: '', proves: '', icon: Waves, motif: 'ripple', group: 'pages' },
  overview: { id: 'overview', n: null, title: 'Overview', shortTitle: 'Overview', marks: '', icon: LayoutDashboard, motif: 'route', group: 'pages',
    proves: 'The integrated system runs end-to-end: a real-time dashboard of node status, BLE localization, sensor data, routing path, aggregated data, MAC activity and key performance metrics.' },
  events: { id: 'events', n: null, title: 'Events', shortTitle: 'Events', marks: '', proves: '', icon: Activity, motif: 'ticker', group: 'pages' },
  system: { id: 'system', n: null, title: 'System', shortTitle: 'System', marks: '', proves: '', icon: Server, motif: 'grid', group: 'pages' },
  r1: { id: 'r1', n: 1, title: 'WSN Architecture & ESP32 Setup', shortTitle: 'Architecture & ESP32 Setup', marks: '2 marks', icon: Cpu, motif: 'boot', group: 'rubric',
    proves: '4 ESP32 nodes configured correctly; sensor, cluster-head/aggregator, router and sink roles clearly implemented; proper network topology and addressing.' },
  r2: { id: 'r2', n: 2, title: 'BLE-Based Localization', shortTitle: 'BLE Localization', marks: '3 marks', icon: RadioTower, motif: 'radio', group: 'rubric',
    proves: 'BLE advertising/scanning, RSSI measurement, distance estimation, nearest-node identification and localization-error calculation.' },
  r3: { id: 'r3', n: 3, title: 'Wi-Fi MAC Protocol', shortTitle: 'Wi-Fi MAC Protocol', marks: '3 marks', icon: Antenna, motif: 'backoff', group: 'rubric',
    proves: 'Channel sensing, back-off mechanism, ACK, timeout, retransmission and collision-handling implemented and demonstrated.' },
  r4: { id: 'r4', n: 4, title: 'Dynamic Schedule-Based Communication', shortTitle: 'Dynamic Schedule', marks: '2 marks', icon: Timer, motif: 'slots', group: 'rubric',
    proves: 'TDMA-style slot allocation, dynamic schedule update, unused-slot handling and sleep/wake operation.' },
  r5: { id: 'r5', n: 5, title: 'Broadcast & Unicast Communication', shortTitle: 'Broadcast & Unicast', marks: '1 mark', icon: Share2, motif: 'fanout', group: 'rubric',
    proves: 'Correct broadcast of control/schedule messages and reliable unicast sensor-data transmission with destination/ACK handling.' },
  r6: { id: 'r6', n: 6, title: 'Data Aggregation', shortTitle: 'Data Aggregation', marks: '2 marks', icon: Layers, motif: 'fanin', group: 'rubric',
    proves: 'Aggregator receives data from multiple nodes, applies aggregation function and demonstrates reduction in transmitted data.' },
  r7: { id: 'r7', n: 7, title: 'Adaptive Multi-Hop Routing', shortTitle: 'Adaptive Routing', marks: '2 marks', icon: Route, motif: 'route', group: 'rubric',
    proves: 'Neighbor discovery/table, route metric, multi-hop forwarding, route selection and alternate-route recovery after link failure.' },
  r8: { id: 'r8', n: 8, title: 'Performance Analysis', shortTitle: 'Performance Analysis', marks: '2 marks', icon: Gauge, motif: 'bars', group: 'rubric',
    proves: 'Minimum 4 metrics measured and analyzed: PDR, packet loss, delay, throughput, retransmission, localization error, etc. (all 7 are measured here).' },
  r9: { id: 'r9', n: 9, title: 'Technical Demonstration & Viva', shortTitle: 'Demonstration & Viva', marks: '3 marks', icon: ListTree, motif: 'steps', group: 'rubric',
    proves: 'Technical explanation and viva: the integrated sequence BLE Discovery → … → Performance Analysis, shown live.' },
} as unknown as Record<Exclude<ViewId, ReleaseId>, ViewDef>;

const RELEASE_VIEWS = {
  story: { id: 'story', n: null, title: 'Story', shortTitle: 'Story', icon: BookOpen, motif: 'ripple', group: 'pages' },
  live: { id: 'live', n: null, title: 'Live pond', shortTitle: 'Live pond', icon: Waves, motif: 'route', group: 'pages' },
  floats: { id: 'floats', n: null, title: 'Floats', shortTitle: 'Floats', icon: LocateFixed, motif: 'radio', group: 'pages' },
  build: { id: 'build', n: null, title: 'Build guide', shortTitle: 'Build guide', icon: Wrench, motif: 'boot', group: 'pages' },
  connect: { id: 'connect', n: null, title: 'Connect', shortTitle: 'Connect', icon: Plug, motif: 'fanin', group: 'pages' },
} as Record<ReleaseId, ViewDef>;

/** Release build: only the five release pages exist, so the dashboard's rubric text is dead code and is dropped. */
export const VIEWS = (RELEASE ? RELEASE_VIEWS : { ...LEGACY_VIEWS, ...RELEASE_VIEWS }) as Record<ViewId, ViewDef>;

/**
 * The first sidebar group, in order. `r9` appears here as "Demo flow" and again in the rubric group
 * as "9 · Demonstration & Viva": it is one page, so both links are current on #r9.
 */
const EVAL_NAV: { id: ViewId; label: string; icon: LucideIcon }[] = RELEASE ? [] : [
  { id: 'home', label: 'Home', icon: Waves },
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'r9', label: 'Demo flow', icon: ListChecks },
  { id: 'events', label: 'Events', icon: Activity },
  { id: 'system', label: 'System', icon: Server },
];
const RELEASE_NAV: { id: ViewId; label: string; icon: LucideIcon }[] = RELEASE_IDS.map((id) => ({ id, label: VIEWS[id].title, icon: VIEWS[id].icon }));
export const NAV_PAGES = RELEASE ? RELEASE_NAV : EVAL_NAV;

/** Hashes that redirect (replaceState) to a view. */
export const HASH_ALIASES: Record<string, ViewId> = RELEASE ? { demo: 'live' } : { demo: 'r9' };

export function isViewId(x: string): x is ViewId {
  return Object.prototype.hasOwnProperty.call(VIEWS, x);
}
