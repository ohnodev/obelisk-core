/**
 * React Widget Hooks for LiteGraph
 * 
 * This module provides a bridge between LiteGraph widgets and React components.
 * Widgets with type "react" or "textarea" will skip canvas rendering and
 * instead be rendered by React components.
 */

// Global registry for React widget renderers
const reactWidgetRegistry = new Map();

// Widget position cache (updated on each draw)
const widgetPositions = new Map();

/**
 * Register a React component renderer for a widget type
 * @param {string} widgetType - The widget type (e.g., "textarea")
 * @param {Function} renderer - Function that returns React component props
 */
export function registerReactWidget(widgetType, renderer) {
  reactWidgetRegistry.set(widgetType, renderer);
}

/**
 * Get all widget positions for React rendering
 * @returns {Map} Map of widget positions keyed by nodeId-widgetName
 */
export function getWidgetPositions() {
  return widgetPositions;
}

/**
 * Update widget position (called from LiteGraph draw cycle)
 * @param {string} nodeId - Node ID
 * @param {string} widgetName - Widget name
 * @param {Object} position - Position and size info
 */
export function updateWidgetPosition(nodeId, widgetName, position) {
  const key = `${nodeId}-${widgetName}`;
  widgetPositions.set(key, {
    ...position,
    nodeId,
    widgetName,
    timestamp: Date.now(),
  });
}

/**
 * Clear widget positions (called on cleanup)
 */
export function clearWidgetPositions() {
  widgetPositions.clear();
}

/**
 * Check if a widget type should skip canvas rendering
 * @param {string} widgetType - Widget type
 * @returns {boolean}
 */
export function shouldSkipCanvasRender(widgetType) {
  return widgetType === "react" || widgetType === "textarea";
}
