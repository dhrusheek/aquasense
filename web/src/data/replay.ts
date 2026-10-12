// Simulation source for the static (Cloudflare Pages) build: replays a recorded run of the real
// network simulator (server/record_replay.py -> sim_frames.json) in a loop. One frame is one
// superframe (3 s); between frames net_time advances once a second like the live feed does.
// The recording scripts the scenarios: turbid water, link failures, nodes going offline, and so on.
import { toast } from 'sonner';
import { mockUrl } from '@/data/api';
import type { State } from '@/data/types';
import { RELEASE } from '@/lib/constants';
import { num } from '@/lib/safe';

export interface ReplaySource {
  next(): Promise<State>;
}

type Frame = State & { scenario?: string };

export function createReplaySource(file = 'sim_frames.json'): ReplaySource {
  let frames: Frame[] | null = null;
  let tick = 0;
  let lastScenario = '';

  return {
    async next() {
      if (!frames) {
        const r = await fetch(mockUrl(file), { cache: 'force-cache' });
        if (!r.ok) throw new Error(file + ' HTTP ' + r.status);
        const d: unknown = await r.json();
        if (!Array.isArray(d) || !d.length) throw new Error('empty simulation recording');
        frames = d as Frame[];
      }
      const k = tick++;
      const base = JSON.parse(JSON.stringify(frames[Math.floor(k / 3) % frames.length])) as Frame;
      const sub = k % 3;
      // net_time and age stay continuous between the three polls of one superframe.
      const age = Math.round((0.2 + sub * 1.0) * 10) / 10;
      base.net_time = (num(base.net_time) || 0) + sub * 1000;
      if (base.derived) {
        base.derived.age_s = age;
        base.derived.online = true;
      }
      const sc = base.scenario || '';
      if (sc && sc !== lastScenario) {
        if (lastScenario && (!RELEASE || location.hash.replace(/^#\/?/, '').split(/[?/]/)[0] === 'live')) toast.message('Simulation scenario', { id: 'sim-scenario', description: sc, duration: 6000 });
        lastScenario = sc;
      }
      return base;
    },
  };
}
