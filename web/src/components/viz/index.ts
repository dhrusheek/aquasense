// Public surface of the viz layer (spec 01). Views import from here or from the component files.
export { PatternDefs } from './PatternDefs';
export { NodePattern, type NodePatternProps } from './NodePattern';
export { NodeGlyph, type NodeGlyphProps } from './NodeGlyph';
export { NODE_SHAPE, NODE_SHAPE_NAME, shapePath } from './shapes';
export {
  NODE_COLOR_VAR, NODE_FILL, NODE_ORDER, PATTERN_ID, fillFor, fillOf, isNodeId, nodeBg, nodeFill, nodeOfFill, nodeStroke,
  type CellFill, type FillAttrs, type NodeId,
} from './patterns';
export { PondField, type PondFieldProps } from './PondField';
export { pondDensity, turbidityDensity } from './pond';
export { PondStage, type PondStageProps } from './PondStage';
export { Topology, TopologyLegend, type TopologyLegendProps, type TopologyProps, type TopologyTarget } from './Topology';
export { routeSegments, topoGeom, type RouteSegment, type TopoGeom } from './topoLayout';
export { CellChart, type CellChartProps, type NodeSeries, type Series, type SeriesSpec } from './CellChart';
export { CellSpark, type CellSparkProps, type SparkFill } from './CellSpark';
export { niceCeil, niceFloor, relLabel } from './cellMath';
export { SlotStrip, currentSlot, type SlotStripProps } from './SlotStrip';
export { Lamp, LightCard, type LightCardProps, type LightCardState } from './LightCard';
export { TempWarnForm, type TempWarnFormProps } from './TempWarnForm';
export { ensurePatternDefs, useDpr, useElementSize, usePatternDefs, useReducedMotion, useThemeTokens } from './hooks';
