// Dev-only: every mode and scene in a grid, for eyeballing (mounted temporarily from App.tsx).
import { ArtImage, ArtScene, type ArtMode, type ArtTint, type SceneName } from './index';

const SCENES: SceneName[] = ['waves', 'float', 'lamp', 'mesh', 'turbid', 'bank'];
const MODES: ArtMode[] = ['ascii', 'dots', 'dots-bayer'];
const BASE = import.meta.env.BASE_URL;

export function ArtPreview() {
  const tints: ArtTint[] = ['night', 'ink'];
  return (
    <div className="fixed inset-0 z-[9999] overflow-auto bg-[var(--background)] p-4" style={{ color: 'var(--ink)' }}>
      {tints.map((tint) => MODES.map((mode) => (
        <section key={tint + mode} className="mb-6">
          <h2 className="mb-2 font-semibold">{tint} / {mode}</h2>
          <div className="grid grid-cols-3 gap-3">
            {SCENES.map((s, i) => (
              <ArtScene key={s} scene={s} mode={mode} tint={tint} animate={i < 2 ? 'shimmer' : 'none'} state={i % 2 ? 'red' : 'green'} />
            ))}
          </div>
        </section>
      )))}
      <section className="mb-6">
        <h2 className="mb-2 font-semibold">images</h2>
        <div className="grid grid-cols-4 gap-3">
          <ArtImage src={`${BASE}art/esp32_devkit_v1.jpg`} mode="ascii" tint="night" alt="ESP32" aspect="4/3" />
          <ArtImage src={`${BASE}art/esp32_devkit_v1.jpg`} mode="ascii" alt="ESP32" aspect="4/3" />
          <ArtImage src={`${BASE}art/breadboard_leds.jpg`} mode="dots" alt="Breadboard" aspect="4/3" animate="scan" />
          <ArtImage src={`${BASE}art/breadboard_leds.jpg`} mode="dots-bayer" alt="Breadboard" aspect="4/3" />
          <ArtImage src={`${BASE}art/overview.png`} mode="dots" alt="Overview" aspect="16/9" />
          <ArtImage src={`${BASE}art/turbidity_probe.jpg`} mode="dots" alt="Probe" aspect="1/1" cell="sm" />
          <ArtImage src={`${BASE}art/turbidity_board.jpg`} mode="dots" tint="night" alt="Board" aspect="4/3" />
          <ArtImage src={`${BASE}art/breadboard_leds.jpg`} mode="dots" tint="night" alt="Breadboard" aspect="4/3" />
          <ArtScene scene="waves" mode="dots" tint="ink" aspect="3/1" animate="none" />
        </div>
        <h2 className="my-2 font-semibold">thumbs</h2>
        <div className="flex flex-wrap gap-3">
          {['esp32_devkit_v1.jpg', 'turbidity_board.jpg', 'turbidity_probe.jpg', 'breadboard_leds.jpg'].map((f) => (
            <div key={f} className="w-[72px]"><ArtImage src={`${BASE}art/${f}`} mode="dots" cell="xs" aspect="1/1" alt={f} /></div>
          ))}
          <div className="w-[72px]"><ArtImage src={`${BASE}art/esp32_devkit_v1.jpg`} mode="ascii" cell="xs" aspect="1/1" alt="esp32" /></div>
          <div className="w-[48px]"><ArtImage src={`${BASE}art/breadboard_leds.jpg`} mode="dots" cell="xs" aspect="1/1" alt="bb" /></div>
        </div>
      </section>
    </div>
  );
}
