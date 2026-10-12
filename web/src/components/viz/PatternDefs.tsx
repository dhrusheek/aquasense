import { useEffect } from 'react';
import { PATTERN_AUTO_ATTR } from './hooks';
import { DEFS_MARKUP } from './patterns';
import './viz.css';

/**
 * The document-global defs: the hatch (`url(#pat-hatch)`), the checker, dots and lines tiles of the
 * node fills (chart tone and glyph ink) and the map's dot matrix. Render once at the app root.
 * Colours read the ink tokens, so they follow the theme with no redraw.
 */
export function PatternDefs() {
  // A copy injected by `ensurePatternDefs` (hooks.ts) would duplicate the id: this one wins.
  useEffect(() => {
    document.querySelectorAll(`svg[${PATTERN_AUTO_ATTR}="auto"]`).forEach((el) => el.remove());
  }, []);
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" className="pointer-events-none absolute" {...{ [PATTERN_AUTO_ATTR]: 'root' }}>
      <defs dangerouslySetInnerHTML={{ __html: DEFS_MARKUP }} />
    </svg>
  );
}
