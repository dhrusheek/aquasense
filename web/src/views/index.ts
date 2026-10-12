// View registry: one eagerly imported component per route (a single bundle, no lazy chunks,
// so the dashboard keeps working offline from a plain static server).
import type { ComponentType } from 'react';
import type { ReleaseId, ViewId } from '@/app/routes';
import Events from './Events';
import Home from './Home';
import Overview from './Overview';
import R1Architecture from './R1Architecture';
import R2Localization from './R2Localization';
import R3Mac from './R3Mac';
import R4Schedule from './R4Schedule';
import R5Cast from './R5Cast';
import R6Aggregation from './R6Aggregation';
import R7Routing from './R7Routing';
import R8Performance from './R8Performance';
import R9Demo from './R9Demo';
import System from './System';

export const VIEW_COMPONENTS: Record<Exclude<ViewId, ReleaseId>, ComponentType> = {
  home: Home,
  overview: Overview,
  events: Events,
  system: System,
  r1: R1Architecture,
  r2: R2Localization,
  r3: R3Mac,
  r4: R4Schedule,
  r5: R5Cast,
  r6: R6Aggregation,
  r7: R7Routing,
  r8: R8Performance,
  r9: R9Demo,
};
