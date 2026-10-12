// #connect — run the dashboard yourself and point the dock node at it.
import { LINKS } from './links';
import { Box, Btn, Decode, Grid } from '@/release/ui';

const JSON_LINES = [
  '{',
  '  "source": "hardware",',
  '  "nodes": [',
  '    { "id": "N1", "value": 4812, "status": "active" },',
  '    { "id": "N2", "value": 2610, "status": "active" },',
  '    ...',
  '  ],',
  '  "light": { "state": "green" }',
  '}',
];

export default function Connect() {
  return (
    <>
      <Decode as="h1">Connect your floats</Decode>
      <p className="cy-intro">This website shows a demo pond. Your readings stay on your own laptop; nothing is uploaded.</p>
      <Grid>
        <Box title="1. Run the dashboard" span={6}>
          <p>Run this on a laptop. It opens the dashboard and needs no internet.</p>
          <pre className="cy-pre cy-term font-mono">./start.sh</pre>
          <p>Then open <span className="font-mono">http://127.0.0.1:5050</span></p>
        </Box>
        <Box title="2. Point the dock node at it" span={6}>
          <p>
            Set <span className="font-mono">UPLINK_SSID</span> and <span className="font-mono">UPLINK_PASS</span> in config.h to your laptop hotspot. Or plug the dock node into the laptop by USB and the serial bridge does the rest.
          </p>
        </Box>
        <Box title="3. What the dock node sends" span={12}>
          <pre className="cy-pre cy-term">{JSON_LINES.join('\n')}{' '}<span className="cy-cursor" aria-hidden="true" /></pre>
        </Box>
      </Grid>
      {LINKS.source ? <p><Btn primary href={LINKS.source}>Get the source</Btn></p> : null}
    </>
  );
}
