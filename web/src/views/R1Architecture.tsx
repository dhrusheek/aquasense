// #r1 — WSN Architecture & ESP32 Setup (port of app.js V.r1 640-700, spec 02 §1).
// Row 1: one setup card per ESP32. Row 2: the pond status light, the N1 alert threshold and the light
// history. Row 3: addressing beside the allowed topology. Row 4: the wiring of each board.
import { Tray } from '@/components/aq/Tray';
import { ViewHeader } from '@/components/aq/ViewHeader';
import { LightCard } from '@/components/viz/LightCard';
import { TempWarnForm } from '@/components/viz/TempWarnForm';
import { postCommand } from '@/data/api';
import { useSnapshot } from '@/data/hooks';
import { derived, isOnline, lightOf, macAddr, netNow, node, schedule, sensorText } from '@/data/selectors';
import { useTempWarnPending } from '@/data/tempWarn';
import type { LightHist, NodeId } from '@/data/types';
import { NODE_IDS, SHORT_ROLE, WIRING } from '@/lib/constants';
import { tempC } from '@/lib/format';
import { arr, get, nNum, num } from '@/lib/safe';
import { NodeSetupCard } from './r1/NodeSetupCard';
import { AddressingTable, AllowedTopologyTable, LightHistoryTable } from './r1/tables';
import { WiringList } from './r1/WiringList';

const testLight = () => postCommand({ c: 'LIGHT_TEST' });
const setTempWarn = (v: number) => postCommand({ c: 'TEMP_WARN', a: 1, v });

/** Four cards across from 1280 px, two from 640 px, one on a phone. */
const FOUR_UP = 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4';

export default function R1Architecture() {
  const s = useSnapshot();
  const d = s.data;
  const now = netNow(s);
  const online = isOnline(s);

  const channel = String(get<unknown>(d, 'channel', '—'));
  const sinkIp = String(get<unknown>(d, 'sink_ip', '—'));

  // TDMA slots each node owns: the indices i where schedule.slots[i] is that node's number.
  const slotOwners = arr(schedule(s).slots);
  const owned = {} as Record<NodeId, number[]>;
  NODE_IDS.forEach((id) => {
    const k = nNum(id);
    owned[id] = slotOwners.flatMap((o, i) => (num(o) === k ? [i] : []));
  });

  const n1 = node(s, 'N1');
  const tempWarn = num(n1.temp_warn);
  const pending = useTempWarnPending(tempWarn);

  const active = NODE_IDS.filter((id) => String(node(s, id).status || '').toLowerCase() === 'active').length;
  const lightHistory = arr<LightHist>(derived(s).light_history).slice().reverse();

  return (
    <>
      <ViewHeader view="r1" />
      <div className="flex flex-col gap-10">
        {/* Row 1 */}
        <Tray title="Nodes" meta={`${active} / ${NODE_IDS.length} active`} bare>
          <div className={FOUR_UP}>
            {NODE_IDS.map((id) => {
              // The card knows its node, so the value and the sink's MAC resolve before the first uplink too.
              const n = { ...node(s, id), id };
              return (
                <NodeSetupCard
                  key={id}
                  id={id}
                  node={n}
                  value={sensorText(s, n)}
                  mac={macAddr(s, n)}
                  slots={owned[id]}
                  channel={channel}
                  sinkIp={sinkIp}
                />
              );
            })}
          </div>
        </Tray>

        {/* Row 2 */}
        <div className="grid grid-cols-12 gap-4">
          <LightCard
            title="Pond status light"
            compact={false}
            light={lightOf(s)}
            netNow={now}
            online={online}
            mock={s.mock}
            onTest={testLight}
            className="col-span-12 xl:col-span-8"
          />
          <TempWarnForm
            title="N1 alert threshold"
            source="r1"
            tempWarn={tempWarn}
            liveC={tempC(n1.value)}
            flag={typeof n1.threshold === 'boolean' ? n1.threshold : null}
            pending={pending}
            online={online}
            mock={s.mock}
            onSubmit={setTempWarn}
            className="col-span-12 xl:col-span-4"
          />
          <Tray title="Status light history" className="col-span-12">
            <LightHistoryTable rows={lightHistory} now={now} />
          </Tray>
        </div>

        {/* Row 3 */}
        <div className="grid grid-cols-12 gap-4">
          <Tray title="Addressing" className="col-span-12">
            <AddressingTable s={s} owned={owned} sinkIp={sinkIp} />
          </Tray>
          <Tray title="Allowed topology (simulated radio range)" className="col-span-12">
            <AllowedTopologyTable s={s} />
          </Tray>
        </div>

        {/* Row 4 */}
        <Tray
          title="Wiring summary"
          description="ESP32 DevKit V1, one sketch, role by NODE_ID; external parts: turbidity module and two LEDs."
          bare
        >
          <div className={FOUR_UP}>
            {NODE_IDS.map((id) => (
              <WiringList key={id} node={id} title={`${id} · ${SHORT_ROLE[id]}`} items={WIRING[id]} />
            ))}
          </div>
        </Tray>
      </div>
    </>
  );
}
