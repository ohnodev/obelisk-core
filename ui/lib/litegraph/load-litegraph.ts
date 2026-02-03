/**
 * Load LiteGraph UMD module
 * This ensures the UMD module is loaded and attached to window
 */

let liteGraphLoaded = false;

export function loadLiteGraph(): Promise<any> {
  if (typeof window === "undefined") {
    // SSR - return stub
    return Promise.resolve({
      LGraph: class {},
      LGraphCanvas: class {},
      LGraphNode: class {},
      createNode: () => null,
      reactWidgetPositions: {},
      updateReactWidgetPosition: () => {},
      clearReactWidgetPositions: () => {},
    });
  }

  if (liteGraphLoaded && (window as any).LiteGraph) {
    return Promise.resolve((window as any).LiteGraph);
  }

  return new Promise((resolve, reject) => {
    // Check if already loaded
    if ((window as any).LiteGraph) {
      liteGraphLoaded = true;
      resolve((window as any).LiteGraph);
      return;
    }

    // Load via script tag
    const script = document.createElement("script");
    script.src = "/lib/litegraph/litegraph.js";
    script.onload = () => {
      liteGraphLoaded = true;
      resolve((window as any).LiteGraph);
    };
    script.onerror = () => {
      // Script tag failed - this shouldn't happen in production
      // The script should be served from /lib/litegraph/litegraph.js
      liteGraphLoaded = false;
      reject(new Error("Failed to load LiteGraph from /lib/litegraph/litegraph.js"));
    };
    document.head.appendChild(script);
  });
}
