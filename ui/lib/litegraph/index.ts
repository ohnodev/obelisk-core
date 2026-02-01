/**
 * Local LiteGraph wrapper
 * LiteGraph is loaded via script tag in layout.tsx and attached to window
 */

// Type declarations
declare global {
  interface Window {
    LiteGraph: any;
  }
}

// Get LiteGraph from window (loaded via script tag)
const getLiteGraph = () => {
  if (typeof window !== "undefined" && window.LiteGraph) {
    return window.LiteGraph;
  }
  // Return stub for SSR
  return {
    LGraph: class {},
    LGraphCanvas: class {},
    LGraphNode: class {},
    createNode: () => null,
    reactWidgetPositions: {},
    updateReactWidgetPosition: () => {},
    clearReactWidgetPositions: () => {},
    NODE_TITLE_HEIGHT: 30,
    NODE_SUBTEXT_SIZE: 12,
  } as any;
};

const LiteGraph = getLiteGraph();

// Re-export classes
export const LGraph = LiteGraph.LGraph as any;
export const LGraphCanvas = LiteGraph.LGraphCanvas as any;
export const LGraphNode = LiteGraph.LGraphNode as any;

// Default export
export default LiteGraph;
