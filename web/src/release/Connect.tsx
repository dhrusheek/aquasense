// #connect — run the dashboard yourself and point the dock node at it.
import { FormulaBlock } from '@/components/aq/FormulaBlock';
import { Tray } from '@/components/aq/Tray';
import { Ascii } from '@/components/ascii/Ascii';
import { ArtScene } from '@/components/art';
import { CardMedia, FitBox, LinkButtons, MediaTray, PageTitle } from './parts';

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
      <PageTitle title="Connect your floats" note="This website shows a demo pond. Your readings stay on your own laptop; nothing is uploaded." />
      <div className="grid max-w-[1100px] grid-cols-1 gap-4 min-[900px]:grid-cols-2">
        <MediaTray title="1. Run the dashboard" media={<CardMedia ground="night"><FitBox><Ascii anim="ripple" ink="mono" size="sm" /></FitBox></CardMedia>}>
          <p className="text-sm leading-6 text-muted-foreground">Run this on a laptop. It opens the dashboard and needs no internet.</p>
          <FormulaBlock lines={['./start.sh']} />
          <p className="text-sm text-muted-foreground">Then open <span className="tabular font-mono text-foreground">http://127.0.0.1:5050</span></p>
        </MediaTray>
        <MediaTray title="2. Point the dock node at it" media={<CardMedia><ArtScene scene="lamp" mode="ascii" tint="night" animate="scan" className="h-full w-full rounded-none" /></CardMedia>}>
          <p className="text-sm leading-6 text-muted-foreground">
            Set <span className="font-mono text-foreground">UPLINK_SSID</span> and <span className="font-mono text-foreground">UPLINK_PASS</span> in config.h to your laptop hotspot. Or plug the dock node into the laptop by USB and the serial bridge does the rest.
          </p>
        </MediaTray>
        <Tray title="3. What the dock node sends" className="min-[900px]:col-span-2">
          <FormulaBlock lines={JSON_LINES} />
        </Tray>
        <CardMedia kind="band" className="min-[900px]:col-span-2"><ArtScene scene="waves" mode="ascii" tint="night" aspect="3/1" animate="shimmer" className="h-full w-full rounded-none" /></CardMedia>
        <div className="min-[900px]:col-span-2"><LinkButtons /></div>
      </div>
    </>
  );
}
