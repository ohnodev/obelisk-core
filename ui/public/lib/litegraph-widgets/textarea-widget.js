/**
 * Textarea Widget Extension for LiteGraph
 * 
 * Modular extension that adds native textarea widget support.
 * This patches drawNodeWidgets and processNodeWidgets methods.
 * 
 * Based on ComfyUI's battle-tested implementation patterns.
 */

(function() {
    'use strict';

    function patchLiteGraph() {
        if (!window.LiteGraph || !window.LGraphCanvas) {
            return false;
        }

        var LG = window.LiteGraph;
        var LGC = window.LGraphCanvas;

        // Check if already patched
        if (LGC.prototype._textareaWidgetPatched) {
            return true;
        }

        // Store original methods
        var originalDrawNodeWidgets = LGC.prototype.drawNodeWidgets;
        var originalProcessNodeWidgets = LGC.prototype.processNodeWidgets;

        /**
         * Patch drawNodeWidgets - skip textarea widgets (handled by React components)
         */
        LGC.prototype.drawNodeWidgets = function(node, posY, ctx, active_widget) {
            if (!node.widgets || !node.widgets.length) {
                return originalDrawNodeWidgets.call(this, node, posY, ctx, active_widget);
            }

            var widgets = node.widgets;

            // Separate textarea widgets from others
            var textareaWidgets = [];
            var otherWidgets = [];
            for (var i = 0; i < widgets.length; i++) {
                if (widgets[i].type === "textarea") {
                    textareaWidgets.push(widgets[i]);
                } else {
                    otherWidgets.push(widgets[i]);
                }
            }

            // Skip drawing textarea widgets - they're handled by React components
            // Just ensure they don't increment posY
            for (var i = 0; i < textareaWidgets.length; i++) {
                var w = textareaWidgets[i];
                if (!w.computeSize) {
                    w.computeSize = function() { return [0, 0]; };
                }
            }

            // Draw other widgets using original method
            if (otherWidgets.length > 0) {
                var originalWidgets = node.widgets;
                node.widgets = otherWidgets;
                originalDrawNodeWidgets.call(this, node, posY, ctx, active_widget);
                node.widgets = originalWidgets;
            }

            // Handle posY increment - textarea widgets don't increment
            // The original method already handled non-textarea widgets
        };

        /**
         * Patch processNodeWidgets - textarea widgets are handled by React components
         * Don't intercept clicks, let React handle them
         */
        LGC.prototype.processNodeWidgets = function(node, pos, event, active_widget) {
            if (!node.widgets || !node.widgets.length || (!this.allow_interaction && !node.flags.allow_interaction)) {
                return originalProcessNodeWidgets.call(this, node, pos, event, active_widget);
            }

            var x = pos[0] - node.pos[0];
            var y = pos[1] - node.pos[1];
            var width = node.size[0];

            // Skip textarea widgets - they're handled by React components
            for (var i = 0; i < node.widgets.length; ++i) {
                var w = node.widgets[i];
                if (!w || w.disabled || w.type !== "textarea") continue;

                var titleHeight = LG.NODE_TITLE_HEIGHT;
                var padding = 10;
                var textareaX = 15; // margin
                var textareaY = titleHeight + padding;
                var textareaWidth = (w.width || width) - 30;
                var textareaHeight = node.size[1] - titleHeight - (padding * 2);

                // If click is within textarea bounds, don't process it here
                // Let React component handle it
                if (x >= textareaX && x <= textareaX + textareaWidth &&
                    y >= textareaY && y <= textareaY + textareaHeight) {
                    // Return null to indicate this widget was clicked but handled elsewhere
                    return null;
                }
            }

            // For non-textarea widgets, use original processing
            return originalProcessNodeWidgets.call(this, node, pos, event, active_widget);
        };

        LGC.prototype._textareaWidgetPatched = true;
        return true;
    }

    // Initialize when LiteGraph is available
    if (typeof window !== "undefined") {
        if (patchLiteGraph()) {
            // Already loaded
        } else {
            // Wait for LiteGraph
            var checkInterval = setInterval(function() {
                if (patchLiteGraph()) {
                    clearInterval(checkInterval);
                }
            }, 50);

            window.addEventListener("load", function() {
                setTimeout(patchLiteGraph, 100);
            });
        }
    }
})();
