// litegraph.js is loaded via script tag in layout.tsx
// It attaches to window/globalThis as a UMD module
// We just re-export from the global scope

// Access the globals that litegraph.js attaches
// The UMD module attaches to 'this' which is window/globalThis in browser
const getGlobal = () => {
  if (typeof window !== "undefined") return window as any;
  if (typeof globalThis !== "undefined") return globalThis as any;
  // For SSR, return an empty object - components using these are client-only
  return {} as any;
};

const globals = getGlobal();

// Re-export the classes from the global scope
// These are available after the script tag loads in layout.tsx
// On server side they'll be undefined, but that's OK since
// all components using them have "use client" directive
export const LiteGraph = globals.LiteGraph;
export const LGraph = globals.LGraph;
export const LGraphNode = globals.LGraphNode;
export const LGraphCanvas = globals.LGraphCanvas;
export const LLink = globals.LLink;
export const LGraphGroup = globals.LGraphGroup;
export const DragAndScale = globals.DragAndScale;
export const ContextMenu = globals.ContextMenu;
