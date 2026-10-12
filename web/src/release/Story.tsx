// #story — the release landing page: the problem, what was built for it, how it works, and that it is free.
import { Cpu, Lightbulb, LayoutDashboard, Radio, RadioTower, Waves, Monitor, ArrowRight } from 'lucide-react';
import { Ascii } from '@/components/ascii/Ascii';
import { ArtImage, ArtScene } from '@/components/art';
import { BASE } from '@/data/api';
import { AsciiScene } from '@/components/asciiart/AsciiScene';
import { useSnapshot } from '@/data/hooks';
import { lightOf } from '@/data/selectors';
import { AUTHOR, LINKS } from './links';
import { CardMedia, FitBox, IdeaCard, LinkButtons, SectionTitle } from './parts';

const ACTION = 'inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

const PROBLEM: { title: string; text: string }[] = [
  { title: 'The sign', text: 'When the pond water turns turbid, the fish move into the shallows. That is the easiest time to fish.' },
  { title: 'The gap', text: 'There was no cheap way to know when it happens, or where the floats had drifted to.' },
  { title: 'The constraint', text: 'Little capital. Nothing to subscribe to. It had to be buildable by hand.' },
];

const BUILT: { icon: React.ReactNode; title: string; text: string }[] = [
  { icon: <Cpu />, title: 'Four small nodes', text: 'Two floats in the water, one on the bank, one at the dock. They sense water turbidity and board temperature on USB power. A small USB solar power bank keeps a float running.' },
  { icon: <Radio />, title: 'A radio mesh of their own', text: 'A self-built radio protocol with time slots and aggregation. Routing heals itself when a link fails.' },
  { icon: <Lightbulb />, title: 'A light at the dock', text: 'Green means the water is calm. Red means the water is turbid.' },
  { icon: <LayoutDashboard />, title: 'A dashboard', text: 'Live readings, float positions and alerts. It runs on a laptop and needs no account.' },
];

const STEPS: { icon: React.ReactNode; head: string; text: string }[] = [
  { icon: <Waves />, head: 'Sense', text: 'Float 2 measures turbidity; Float 1 and the bank node report board temperature.' },
  { icon: <RadioTower />, head: 'Relay', text: 'The nodes pass readings along their own radio mesh; if a link fails they route around it.' },
  { icon: <Monitor />, head: 'Show', text: 'The dock node shows green or red and feeds the dashboard on your laptop.' },
];

const photo = (file: string, alt: string, mode: 'dots' | 'ascii', cell: 'sm' | 'md' = 'md') => (
  <CardMedia><ArtImage src={`${BASE}art/${file}`} mode={mode} tint="night" aspect="16/9" cell={cell} alt={alt} animate="scan" className="h-full w-full rounded-none" /></CardMedia>
);
const scene = (s: 'turbid' | 'float' | 'mesh' | 'lamp', lamp?: 'green' | 'red') => (
  <CardMedia><ArtScene scene={s} mode="ascii" tint="night" state={lamp} animate="scan" className="h-full w-full rounded-none" /></CardMedia>
);

const YEAR = new Date().getFullYear();

export default function Story() {
  const state = lightOf(useSnapshot()).state;
  const lamp = state === 'red' ? 'red' : 'green';
  const problemMedia = [
    scene('turbid'),
    scene('float'),
    photo('breadboard_leds.jpg', 'A breadboard with a red and a green LED, resistors and jumper wires.', 'dots'),
  ];
  const builtMedia = [
    photo('esp32_devkit_v1.jpg', 'Four ESP32 DevKit V1 boards, the small radio microcontrollers used as nodes.', 'ascii', 'sm'),
    scene('mesh'),
    scene('lamp', lamp),
    <CardMedia key="dash" ground="night"><FitBox><Ascii anim="ripple" ink="mono" size="xs" /></FitBox></CardMedia>,
  ];
  return (
    <div className="flex flex-col gap-16">
      <div
        data-slot="home-hero"
        className="surface-card relative isolate -mx-4 -mt-6 h-[calc(100svh-3.5rem)] min-h-[480px] overflow-hidden before:pointer-events-none before:absolute before:inset-0 before:z-[1] before:bg-[image:var(--g-vignette)] before:content-[''] sm:-mx-6 lg:-mx-8"
      >
        <AsciiScene state={state} />
        <div className="absolute top-5 left-4 z-[2] flex flex-col gap-4 sm:left-6 min-[900px]:top-8 lg:left-8">
          <h1 id="view-title" tabIndex={-1} className="rounded-sm text-3xl leading-[1.1] font-semibold tracking-[-0.02em] text-white outline-none min-[900px]:text-[44px]">
            AquaSense
          </h1>
          <p className="max-w-[28ch] text-base leading-6 text-white min-[900px]:max-w-[36ch] min-[900px]:text-lg">
            A free, open pond sensor network built for fishermen with little capital.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a href="#live" className={`${ACTION} fill-accent-g`}>
              See the live pond
              <ArrowRight aria-hidden="true" className="size-4" />
            </a>
            <a href="#build" className={`${ACTION} border border-white/35 text-white hover:bg-white/10`}>Build your own</a>
          </div>
        </div>
      </div>

      <div className="flex max-w-[1100px] flex-col gap-14">
        <section aria-labelledby="st-problem" className="flex flex-col gap-5">
          <SectionTitle id="st-problem">The problem they brought</SectionTitle>
          <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-3">
            {PROBLEM.map((p, i) => <IdeaCard key={p.title} title={p.title} media={problemMedia[i]}>{p.text}</IdeaCard>)}
          </div>
        </section>

        <section aria-labelledby="st-built" className="flex flex-col gap-5">
          <SectionTitle id="st-built">What was built for them</SectionTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {BUILT.map((b, i) => <IdeaCard key={b.title} icon={b.icon} title={b.title} media={builtMedia[i]}>{b.text}</IdeaCard>)}
          </div>
        </section>

        <section aria-labelledby="st-how" className="flex flex-col gap-5">
          <SectionTitle id="st-how">How it works</SectionTitle>
          <CardMedia kind="band"><ArtScene scene="mesh" mode="ascii" tint="night" aspect="3/1" animate="shimmer" className="h-full w-full rounded-none" /></CardMedia>
          <ol className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-3">
            {STEPS.map((st) => (
              <li key={st.head} className="list-none">
                <IdeaCard icon={st.icon} title={st.head}>{st.text}</IdeaCard>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="st-free" className="flex flex-col gap-5">
          <SectionTitle id="st-free">Free, for the fishing community</SectionTitle>
          <CardMedia kind="band"><ArtScene scene="waves" mode="ascii" tint="night" aspect="3/1" animate="shimmer" className="h-full w-full rounded-none" /></CardMedia>
          <div className="surface-card flex flex-col gap-4 p-4 sm:p-6">
            <p className="max-w-[60ch] text-sm leading-6 text-muted-foreground">
              Open hardware and open source. No fees, no accounts, and no data leaves your laptop.
            </p>
            {LINKS.contact && (
              <p className="max-w-[60ch] text-sm leading-6 text-muted-foreground">
                If you fish or farm a pond and want help setting it up,{' '}
                <a href={LINKS.contact} className="font-medium text-foreground underline underline-offset-4">write to me</a>.
              </p>
            )}
            <p className="max-w-[60ch] text-sm leading-6 text-foreground">
              Designed and built end to end by {AUTHOR}: hardware, firmware, radio protocol, server and dashboard.
            </p>
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-3 pt-6 text-[13px] text-muted-foreground">
          <p>AquaSense · open hardware · <span className="tabular font-mono">{YEAR}</span></p>
          <LinkButtons />
        </footer>
      </div>
    </div>
  );
}
