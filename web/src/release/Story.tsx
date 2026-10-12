// #story: the release landing page, cyber skin. Hero, dock log, spec grid, how it works, free.
import { AsciiScene } from '@/components/asciiart/AsciiScene';
import { Ascii } from '@/components/ascii/Ascii';
import { useSnapshot } from '@/data/hooks';
import { lightOf } from '@/data/selectors';
import { AUTHOR, LINKS } from './links';
import { Box, Btn, Decode, Dim, Divider, Grid, Typewriter } from './ui';

const PROBLEM: { title: string; text: string }[] = [
  { title: 'The sign', text: 'When the pond water turns turbid, the fish move into the shallows. That is the easiest time to fish.' },
  { title: 'The gap', text: 'There was no cheap way to know when it happens, or where the floats had drifted to.' },
  { title: 'The constraint', text: 'Little capital. Nothing to subscribe to. It had to be buildable by hand.' },
];

const FLOAT_POWER = 'USB; a small USB solar power bank keeps a float running';

const NODES: { name: string; id: string; swatch: string; where: string; does: string; power: string }[] = [
  { name: 'Float 1', id: 'N1', swatch: 'bg-[var(--n1)]', where: 'In the water', does: 'Reports board temperature.', power: FLOAT_POWER },
  { name: 'Float 2', id: 'N2', swatch: 'bg-[var(--n2)]', where: 'In the water', does: 'Measures water turbidity.', power: FLOAT_POWER },
  { name: 'Bank node', id: 'N3', swatch: 'bg-[var(--n3)]', where: 'On the bank', does: 'Gathers the floats’ readings and reports board temperature.', power: 'USB' },
  { name: 'Dock node', id: 'N4', swatch: 'bg-[var(--n4)]', where: 'At the dock', does: 'Shows green or red and feeds the dashboard.', power: 'USB' },
];

const STEPS: { head: string; anim: 'radio' | 'route' | 'pulse'; text: string }[] = [
  { head: 'Sense', anim: 'radio', text: 'Float 2 measures turbidity; Float 1 and the bank node report board temperature.' },
  { head: 'Relay', anim: 'route', text: 'The nodes pass readings along their own radio mesh; if a link fails they route around it.' },
  { head: 'Show', anim: 'pulse', text: 'The dock node shows green or red and feeds the dashboard on your laptop.' },
];

export default function Story() {
  const state = lightOf(useSnapshot()).state;
  return (
    <div className="flex flex-col gap-10">
      <section aria-label="AquaSense" data-slot="home-hero" className="cy-hero cy-bleed">
        <AsciiScene state={state} />
        <div className="cy-hero-wrap">
          <div className="cy-plate cy-plate--hero">
            <Decode as="h1" className="cy-h1 cy-h1--hero cy-plate-title">AquaSense</Decode>
            <Typewriter className="cy-plate-sub" text="A free, open pond sensor network built for fishermen with little capital." />
          </div>
          <div className="cy-hero-cta">
            <Btn primary href="#live">See the live pond</Btn>
            <Btn href="#build">Build your own</Btn>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-10">
        <section className="flex flex-col gap-4">
          <Decode as="h2" className="cy-h2">The problem they brought</Decode>
          <Grid>
            {PROBLEM.map((p) => (
              <Box key={p.title} as="article" titleAs="h3" title={p.title} span={4}>
                <p className="max-w-[60ch]">{p.text}</p>
              </Box>
            ))}
          </Grid>
        </section>

        <Divider />

        <section className="flex flex-col gap-4">
          <Decode as="h2" className="cy-h2">What was built for them</Decode>
          <Grid>
            {NODES.map((n) => (
              <Box key={n.id} as="article" titleAs="h3" title={n.name} span={3} dim={n.id} className="cy-box--dimfoot">
                <span aria-hidden="true" className={`block size-4 border border-[var(--cy-ink)] ${n.swatch}`} />
                <p><Dim>{n.where}</Dim></p>
                <p>{n.does}</p>
                <p><Dim>{n.power}</Dim></p>
              </Box>
            ))}
          </Grid>
          <Dim>fig. 1 · the four nodes</Dim>
          <p className="max-w-[68ch]">Their own radio: time slots so floats sleep, routing that heals when a link fails.</p>
        </section>

        <Divider />

        <section className="flex flex-col gap-4">
          <Decode as="h2" className="cy-h2">How it works</Decode>
          <Grid>
            {STEPS.map((st, i) => (
              <Box key={st.head} as="article" titleAs="h3" title={st.head} span={4} dim={`fig. ${i + 2}`}>
                <div className="cy-screen"><Ascii anim={st.anim} size="lg" /></div>
                <p>{st.text}</p>
              </Box>
            ))}
          </Grid>
        </section>

        <Divider />

        <Box title="Free, for the fishing community">
          <p className="max-w-[60ch]">Open hardware and open source. No fees, no accounts, and no data leaves your laptop.</p>
          {LINKS.contact && (
            <p className="max-w-[60ch]">
              If you fish or farm a pond and want help setting it up, <a href={LINKS.contact}>write to me</a>.
            </p>
          )}
          <p className="max-w-[60ch]">Designed and built end to end by {AUTHOR}: hardware, firmware, radio protocol, server and dashboard.</p>
          {LINKS.source && <div><Btn href={LINKS.source}>Get the source</Btn></div>}
        </Box>
      </div>
    </div>
  );
}
