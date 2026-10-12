// #build — parts, wiring per node, an interactive flash checklist and placing the floats.
import { useEffect, useState } from 'react';
import { BASE } from '@/data/api';
import { Box, Decode, Dim, Grid, Progress, Table } from '@/release/ui';

const PARTS: string[][] = [
  ['ESP32 DevKit V1 (30 pin)', '4'],
  ['Turbidity probe with LM393 board', '1'],
  ['LEDs (red, green) and resistors', '2 + 2'],
  ['Breadboard and jumper wires', '1 set'],
  ['USB cables that carry data', 'one per node'],
  ['Small USB solar power bank (optional)', 'as needed'],
];

interface Wire { id: string; name: string; img: string; alt: string; pins: string[][]; note?: string }

const WIRES: Wire[] = [
  { id: 'N1', name: 'Float 1', img: 'wiring_N1.png', alt: 'Wiring diagram for Float 1: a bare ESP32 on a USB cable', pins: [], note: 'No wiring. It reads the board temperature from inside the ESP32 chip and needs only USB power.' },
  {
    id: 'N2', name: 'Float 2', img: 'wiring_N2.png', alt: 'Wiring diagram for Float 2: turbidity module wired to the ESP32',
    pins: [['V', '3V3 (never 5 V)'], ['G', 'GND'], ['A', 'GPIO34'], ['D', 'GPIO27']],
  },
  { id: 'N3', name: 'Bank node', img: 'wiring_N3.png', alt: 'Wiring diagram for the bank node: a bare ESP32 on a USB cable', pins: [], note: 'No wiring. Board temperature comes from the ESP32 chip.' },
  {
    id: 'N4', name: 'Dock node', img: 'wiring_N4.png', alt: 'Wiring diagram for the dock node: green and red LEDs with resistors on a breadboard',
    pins: [['Green LED', 'GPIO25, via a resistor'], ['Red LED', 'GPIO27, via a resistor'], ['Both cathodes', 'GND']],
  },
];

const FLASH = [
  'Install the ESP32 core in the Arduino IDE.',
  'Open firmware/wsn_node.',
  'In config.h set NODE_ID to 1, 2, 3 or 4 for each board.',
  'Choose the Huge APP partition scheme.',
  'Flash each board in turn.',
  'Create the Python venv once: python3 -m venv .venv && .venv/bin/pip install -r server/requirements.txt',
];

const KEY = 'aq-build-steps';

function load(): boolean[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (Array.isArray(v)) return FLASH.map((_, i) => v[i] === true);
  } catch { /* storage blocked or corrupt */ }
  return FLASH.map(() => false);
}

export default function Build() {
  const [done, setDone] = useState<boolean[]>(load);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(done)); } catch { /* ignore */ }
  }, [done]);
  const count = done.filter(Boolean).length;

  return (
    <>
      <div className="cy-plate" aria-hidden="true">
        <span className="cy-plate-tab" />
        <p className="cy-plate-title">AquaSense</p>
        <p className="cy-plate-sub">build guide, four nodes, one pond</p>
      </div>
      <Decode as="h1">Build the floats yourself</Decode>
      <Grid>
        <Box title="Parts" span={12}>
          <Table cols={['Part', 'Quantity']} rows={PARTS.map(([p, q]) => [p, <span key={p} className="font-mono">{q}</span>])} />
          <p><Dim>About ₹3,000 (≈ $35) in parts for all four nodes, approximate.</Dim></p>
        </Box>

        <Box title="Wiring" span={12}>
          <Grid>
            {WIRES.map((w, i) => (
              <Box key={w.id} as="article" titleAs="h3" title={`${w.name} · ${w.id}`} span={6} className="cy-span-phone-12">
                <a href={`${BASE}guide/${w.img}`} target="_blank" rel="noreferrer"><img src={`${BASE}guide/${w.img}`} alt={w.alt} loading="lazy" className="cy-fig h-auto w-full object-contain" /></a>
                <p><Dim>fig. {i + 2} · </Dim><a href={`${BASE}guide/${w.img}`} target="_blank" rel="noreferrer"><Dim>open full size</Dim></a></p>
                {w.pins.length ? <Table cols={['Pin', 'Connects to']} rows={w.pins.map(([k, v]) => [k, <span key={k} className="font-mono">{v}</span>])} /> : <p>{w.note}</p>}
              </Box>
            ))}
          </Grid>
        </Box>

        <Box title="Flash the firmware" span={12}>
          <Progress value={count} max={FLASH.length} label="steps done" />
          <ul className="flex list-none flex-col gap-2 p-0">
            {FLASH.map((t, i) => (
              <li key={t}>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={done[i]}
                    onChange={() => setDone((d) => d.map((v, j) => (j === i ? !v : v)))}
                    className="mt-1 size-5 shrink-0"
                  />
                  <span className="font-mono">{t}</span>
                </label>
              </li>
            ))}
          </ul>
        </Box>

        <Box title="Place them" span={12}>
          <img src={`${BASE}guide/network_topology.png`} alt="Layout of the four nodes: two floats in the water, the bank node and the dock node on the shore" loading="lazy" className="cy-fig h-auto max-h-[480px] w-full max-w-[720px] object-contain" />
          <p><Dim>fig. 6 · the four nodes in range of each other</Dim></p>
          <p>The bank node and the dock node go on the shore; the two floats go in the water, all within radio range of each other.</p>
        </Box>
      </Grid>
    </>
  );
}
