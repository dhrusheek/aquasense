// #home — the picture first, then the story. The first screen is the whole pond in characters:
// the farmer, the four nodes and the farm office with its live status light. Scrolling down gives
// the problem, a day at the pond, and how the network solves it.
import { ArrowRight, ChevronDown } from 'lucide-react';
import { AsciiScene } from '@/components/asciiart/AsciiScene';
import { useSnapshot } from '@/data/hooks';
import { lightOf } from '@/data/selectors';
import { cn } from '@/lib/utils';

const ACTION = 'inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 min-[900px]:px-4 min-[900px]:text-sm';
const LINK = 'inline-flex items-center gap-1 rounded-sm text-sm font-medium whitespace-nowrap text-water underline-offset-4 transition-colors duration-150 hover:underline';

type Lamp = 'off' | 'steady' | 'blink';

/** What the farmer sees on the pond light: red over green, as on the picture. */
function Lamps({ red, green, label }: { red: Lamp; green: Lamp; label: string }) {
  const one = (state: Lamp, tone: 'lens-bad' | 'lens-ok') => (
    <span
      aria-hidden="true"
      className={cn('size-3.5', state === 'off' ? 'lens lens-off' : `lens ${tone}`, state === 'blink' && 'animate-pulse motion-reduce:animate-none')}
    />
  );
  return (
    <span role="img" aria-label={label} className="inline-flex items-center gap-2">
      {one(red, 'lens-bad')}
      {one(green, 'lens-ok')}
    </span>
  );
}

const PROBLEMS: { title: string; text: string }[] = [
  { title: 'Turbid water', text: 'Silt and algae cloud a pond long before the fish show it. By the time anyone walks over to look, the damage is done.' },
  { title: 'A hot node', text: 'The board at the water’s edge sits in the sun. When its enclosure overheats, its readings drift and then stop.' },
  { title: 'Silence', text: 'A node that has lost its link looks exactly like a calm pond with nothing to report.' },
];

const DAY: { when: string; head: string; text: string; lamps: { red: Lamp; green: Lamp; label: string } }[] = [
  {
    when: 'Morning', head: 'The light is green',
    text: 'Raman, who farms the pond, glances at the light by the farm office door. Turbidity is clear, the enclosure is cool, and every node has reported within the last three seconds. He does not walk to the water.',
    lamps: { red: 'off', green: 'steady', label: 'Green lamp lit' },
  },
  {
    when: 'Midday', head: 'The light turns red',
    text: 'A storm washes silt off the bank. The probe on N2 reads above its threshold, N3 folds the reading into the next frame, and N4 lights the red lamp. Raman reaches the pond with the evidence already in hand.',
    lamps: { red: 'steady', green: 'off', label: 'Red lamp lit' },
  },
  {
    when: 'Afternoon', head: 'The red lamp blinks',
    text: 'The sun heats the box at N1 past the TEMP_WARN value he set on the dashboard. A blinking red lamp, not a steady one, tells him it is the node that is hot and the water is fine.',
    lamps: { red: 'blink', green: 'off', label: 'Red lamp blinking' },
  },
  {
    when: 'Evening', head: 'A link drops, then the network speaks up',
    text: 'A parked tractor blocks the path from N1 to N3, and N1 sends through N2 instead; the route change shows up in the event log. If nothing at all reaches the sink for 9 s, the green lamp blinks: the network says when it is the one in trouble.',
    lamps: { red: 'off', green: 'blink', label: 'Green lamp blinking' },
  },
];

const SOLUTION: { title: string; text: string }[] = [
  {
    title: 'Watch without walking',
    text: 'Two nodes at the pond edge sample turbidity and temperature. The cluster head N3 fuses both into one frame every three seconds, and N4 in the farm office turns it into a light and a dashboard.',
  },
  {
    title: 'Tell the problems apart',
    text: 'Green, red, blinking red and blinking green: four states on two lamps, so one glance separates a dirty pond from a hot node from a silent network.',
  },
  {
    title: 'Keep talking when a link fails',
    text: 'ESP-NOW on one Wi-Fi channel, a self-built CSMA/CA MAC, a 6 × 500 ms TDMA superframe and cost-based routing that switches to the alternate path.',
  },
];

function scrollToStory() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.getElementById('home-story')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

export default function Home() {
  const state = lightOf(useSnapshot()).state;

  return (
    <div className="flex flex-col gap-16">
      {/* The first screen is the picture: it bleeds past the page gutters and fills the height under the top bar. */}
      <div
        data-slot="home-hero"
        className="surface-card relative isolate -mx-4 -mt-6 h-[calc(100svh-3.5rem)] min-h-[480px] overflow-hidden before:pointer-events-none before:absolute before:inset-0 before:z-[1] before:bg-[image:var(--g-vignette)] before:content-[''] sm:-mx-6 lg:-mx-8"
      >
        <AsciiScene state={state} />
        <div className="absolute top-5 left-4 z-[2] flex flex-col gap-3 sm:left-6 min-[900px]:top-8 lg:left-8">
          {/* tabIndex -1: the router moves focus here on navigation (see ViewRouter). */}
          <h1
            id="view-title"
            tabIndex={-1}
            className="max-w-[18ch] rounded-sm text-2xl leading-[1.1] font-semibold tracking-[-0.02em] text-white outline-none min-[900px]:max-w-[22ch] min-[900px]:text-[40px]"
          >
            A four-node sensor network that watches a fish pond.
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <a href="#overview" className={`${ACTION} fill-accent-g`}>
              Open the dashboard
              <ArrowRight aria-hidden="true" className="size-4" />
            </a>
            <a href="#r9" className={`${ACTION} border border-white/35 text-white hover:bg-white/10`}>
              Run the demo flow
              <ArrowRight aria-hidden="true" className="size-4" />
            </a>
          </div>
        </div>
        <button
          type="button"
          onClick={scrollToStory}
          aria-label="Scroll to the story"
          className="absolute bottom-5 left-4 z-[2] flex size-10 items-center justify-center rounded-full border border-white/35 text-white transition-colors duration-150 hover:bg-white/10 disabled:opacity-50 sm:left-6 lg:left-8"
        >
          <ChevronDown aria-hidden="true" className="size-5" />
        </button>
      </div>

      <div id="home-story" className="flex max-w-[1100px] scroll-mt-20 flex-col gap-16">
        <section aria-labelledby="home-problem" className="flex flex-col gap-6">
          <div className="flex max-w-[60ch] flex-col gap-3">
            <h2 id="home-problem" className="text-grad text-3xl leading-9 font-semibold tracking-[-0.02em]">
              A pond that cannot be watched all day
            </h2>
            <p className="text-[15px] leading-6 text-foreground">
              A pond changes faster than a farmer can walk to it. Rain stirs the bank into the water, a warm afternoon
              pushes equipment past its limit, and a dead radio link looks just like a pond with nothing to say.
            </p>
          </div>
          <ul className="grid grid-cols-1 gap-x-8 gap-y-6 min-[900px]:grid-cols-3">
            {PROBLEMS.map((p) => (
              <li key={p.title} className="flex flex-col gap-2 border-t pt-4">
                <h3 className="text-sm font-semibold text-foreground">{p.title}</h3>
                <p className="text-sm text-muted-foreground">{p.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="home-day" className="flex flex-col gap-6">
          <h2 id="home-day" className="text-grad text-3xl leading-9 font-semibold tracking-[-0.02em]">
            A day at the pond
          </h2>
          <ol className="flex flex-col">
            {DAY.map((d) => (
              <li key={d.when} className="grid grid-cols-1 gap-x-8 gap-y-2 border-t py-6 min-[900px]:grid-cols-12">
                <div className="flex items-center gap-3 min-[900px]:col-span-3">
                  <Lamps {...d.lamps} />
                  <span className="tabular font-mono text-xs text-muted-foreground">{d.when}</span>
                </div>
                <div className="flex max-w-[60ch] flex-col gap-1.5 min-[900px]:col-span-9">
                  <h3 className="text-base font-semibold text-foreground">{d.head}</h3>
                  <p className="text-[15px] leading-6 text-muted-foreground">{d.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="home-solution" className="flex flex-col gap-6">
          <h2 id="home-solution" className="text-grad text-3xl leading-9 font-semibold tracking-[-0.02em]">
            How the network solves it
          </h2>
          <ul className="grid grid-cols-1 gap-x-8 gap-y-6 min-[900px]:grid-cols-3">
            {SOLUTION.map((s) => (
              <li key={s.title} className="flex flex-col gap-2 border-t pt-4">
                <h3 className="text-sm font-semibold text-foreground">{s.title}</h3>
                <p className="text-sm text-muted-foreground">{s.text}</p>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2">
            <a href="#overview" className={LINK}>
              Open the dashboard
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </a>
            <a href="#r9" className={LINK}>
              Run the demo flow
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </a>
          </div>
        </section>

        <p className="max-w-[60ch] text-sm text-muted-foreground">
          Built for 23CSE341 Wireless Sensor Networks, Lab Evaluation 2. The farmer reads the light; the evaluator reads
          this dashboard.
        </p>
      </div>
    </div>
  );
}
