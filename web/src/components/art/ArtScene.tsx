// Procedural night-pond scenes, drawn with canvas primitives and printed as glyphs or dots.
import { ArtCanvas, type ArtAnimate, type ArtAspect } from './ArtImage';
import type { ArtCell, ArtMode, ArtTint } from './raster';
import { drawBank } from './scenes/bank';
import type { SceneFn, SceneName } from './scenes/common';
import { drawFloat } from './scenes/float';
import { drawLamp } from './scenes/lamp';
import { drawMesh } from './scenes/mesh';
import { drawTurbid } from './scenes/turbid';
import { drawWaves } from './scenes/waves';

export interface ArtSceneProps {
  scene: SceneName;
  mode?: ArtMode;
  tint?: ArtTint;
  aspect?: ArtAspect;
  /** 'shimmer' keeps the scene alive; 'scan' reveals it once; 'none' is one still frame. */
  animate?: ArtAnimate;
  cell?: ArtCell;
  /** Lamp colour. */
  state?: 'green' | 'red';
  alt?: string;
  className?: string;
}

const SCENES: Record<SceneName, { draw: SceneFn; alt: string }> = {
  waves: { draw: drawWaves, alt: 'The pond surface at night under a low moon.' },
  float: { draw: drawFloat, alt: 'A sensor float bobbing on the water, its antenna sending, bubbles rising.' },
  lamp: { draw: drawLamp, alt: 'The status lamp on the dock glowing over the water.' },
  mesh: { draw: drawMesh, alt: 'Four nodes linked by radio, with packets travelling to the sink.' },
  turbid: { draw: drawTurbid, alt: 'Pond water clouding with silt until the clarity disc disappears, then clearing.' },
  bank: { draw: drawBank, alt: 'The bank node on a post at the shore, sending radio waves across the pond.' },
};

export function ArtScene({ scene, mode = 'ascii', tint = 'night', aspect = '16/9', animate = 'shimmer', cell = 'md', state = 'green', alt, className }: ArtSceneProps) {
  const s = SCENES[scene];
  return (
    <ArtCanvas
      source={{ kind: 'scene', key: scene, draw: s.draw, state }}
      mode={mode} tint={tint} cell={cell} aspect={aspect} animate={animate} alt={alt ?? s.alt} className={className}
    />
  );
}
