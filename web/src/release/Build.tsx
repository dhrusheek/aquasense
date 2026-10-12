// #build — parts, wiring per node, flashing and placing the floats.
import { BASE } from '@/data/api';
import { KeyValue } from '@/components/aq/KeyValue';
import { Tray } from '@/components/aq/Tray';
import { PageTitle } from './parts';

const PARTS = [
  '4 × ESP32 DevKit V1 (30 pin)',
  '1 × turbidity probe with LM393 board',
  '2 × LEDs (red, green) and 2 resistors',
  '1 × breadboard and jumper wires',
  'USB cables that carry data',
  'Optional: a small USB solar power bank',
];

interface Wire { id: string; name: string; img: string; alt: string; pins: { k: string; v: string }[]; note?: string }

const WIRES: Wire[] = [
  { id: 'N1', name: 'Float 1', img: 'wiring_N1.png', alt: 'Wiring diagram for Float 1: a bare ESP32 on a USB cable', pins: [], note: 'No wiring. It reads the board temperature from inside the ESP32 chip and needs only USB power.' },
  {
    id: 'N2', name: 'Float 2', img: 'wiring_N2.png', alt: 'Wiring diagram for Float 2: turbidity module wired to the ESP32',
    pins: [
      { k: 'V', v: '3V3 (never 5 V)' },
      { k: 'G', v: 'GND' },
      { k: 'A', v: 'GPIO34' },
      { k: 'D', v: 'GPIO27' },
    ],
  },
  { id: 'N3', name: 'Bank node', img: 'wiring_N3.png', alt: 'Wiring diagram for the bank node: a bare ESP32 on a USB cable', pins: [], note: 'No wiring. Board temperature comes from the ESP32 chip.' },
  {
    id: 'N4', name: 'Dock node', img: 'wiring_N4.png', alt: 'Wiring diagram for the dock node: green and red LEDs with resistors on a breadboard',
    pins: [
      { k: 'Green LED', v: 'GPIO25, via a resistor' },
      { k: 'Red LED', v: 'GPIO27, via a resistor' },
      { k: 'Both cathodes', v: 'GND' },
    ],
  },
];

const FLASH = [
  'Install the ESP32 core in the Arduino IDE.',
  'Open firmware/wsn_node.',
  'In config.h set NODE_ID to 1, 2, 3 or 4 for each board.',
  'Choose the Huge APP partition scheme.',
  'Flash each board in turn.',
];

export default function Build() {
  return (
    <>
      <PageTitle title="Build the floats yourself" />
      <div className="flex max-w-[1100px] flex-col gap-6">
        <Tray title="Parts">
          <ul className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm leading-6 text-foreground sm:grid-cols-2">
            {PARTS.map((p) => <li key={p} className="border-b border-ink-3 py-1.5">{p}</li>)}
          </ul>
          <p className="text-sm text-muted-foreground">
            About <span className="tabular font-mono text-foreground">₹3,000</span> (≈ <span className="tabular font-mono text-foreground">$35</span>) in parts for all four nodes, approximate.
          </p>
        </Tray>

        <section aria-labelledby="bd-wiring" className="flex flex-col gap-4">
          <h2 id="bd-wiring" className="text-xl leading-7 font-semibold tracking-[-0.01em] text-foreground">Wiring</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {WIRES.map((w) => (
              <article key={w.id} aria-label={w.name} className="surface-card flex min-w-0 flex-col gap-4 p-4 sm:p-6">
                <h3 className="text-[15px] leading-6 font-semibold text-foreground">{w.name} · <span className="tabular font-mono">{w.id}</span></h3>
                <img src={`${BASE}guide/${w.img}`} alt={w.alt} loading="lazy" className="h-auto w-full rounded-xl bg-white object-contain" />
                {w.pins.length ? (
                  <KeyValue items={w.pins.map((p) => ({ ...p, mono: true }))} align="left" />
                ) : (
                  <p className="text-sm leading-6 text-muted-foreground">{w.note}</p>
                )}
              </article>
            ))}
          </div>
        </section>

        <Tray title="Flash the firmware">
          <ol className="flex list-none flex-col gap-3">
            {FLASH.map((t, i) => (
              <li key={t} className="flex items-start gap-3 text-sm leading-6 text-foreground">
                <span aria-hidden="true" className="tabular flex size-6 shrink-0 items-center justify-center rounded-full border border-ink-3 font-mono text-xs">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
        </Tray>

        <Tray title="Place them">
          <img src={`${BASE}guide/network_topology.png`} alt="Layout of the four nodes: two floats in the water, the bank node and the dock node on the shore" loading="lazy" className="mx-auto h-auto max-h-[480px] w-full max-w-[720px] rounded-xl bg-white object-contain" />
          <p className="max-w-[60ch] text-sm leading-6 text-muted-foreground">The bank node and the dock node go on the shore; the two floats go in the water, all within radio range of each other.</p>
        </Tray>
      </div>
    </>
  );
}
