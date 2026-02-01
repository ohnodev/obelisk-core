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

// Create a dummy base class for SSR so class definitions don't fail
class DummyLGraphNode {
  constructor() {
    if (typeof window === "undefined") {
      throw new Error("LGraphNode can only be used on the client side");
    }
  }
}

// Re-export the classes from the global scope
// These are available after the script tag loads in layout.tsx
// On server side, provide dummy classes so class definitions don't fail
// The actual classes will be used at runtime on the client
export const LiteGraph = globals.LiteGraph || ({} as any);
export const LGraph = globals.LGraph || (class {} as any);
export const LGraphNode = globals.LGraphNode || (DummyLGraphNode as any);
export const LGraphCanvas = globals.LGraphCanvas || (class {} as any);
export const LLink = globals.LLink || globals.LiteGraph?.LLink || (class {} as any);
export const LGraphGroup = globals.LGraphGroup || (class {} as any);
export const DragAndScale = globals.DragAndScale || globals.LiteGraph?.DragAndScale || (class {} as any);
export const ContextMenu = globals.ContextMenu || globals.LiteGraph?.ContextMenu || (class {} as any);
