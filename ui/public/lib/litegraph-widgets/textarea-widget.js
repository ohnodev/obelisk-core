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
         * Draw textarea widget - fills the node body
         */
        function drawTextareaWidget(w, node, ctx, widget_width, show_text, margin, titleHeight, padding, background_color, outline_color, text_color, startY) {
            var textareaX = margin;
            // Use startY (accounts for inputs) + small padding
            var textareaY = startY + 8;
            var textareaWidth = widget_width - (margin * 2);
            // Clamp textareaHeight to non-negative to prevent negative values when node.size[1] is too small
            var textareaHeight = Math.max(0, node.size[1] - textareaY - padding);
            
            // Store widget position for click handling
            w._textareaX = textareaX;
            w._textareaY = textareaY;
            w._textareaWidth = textareaWidth;
            w._textareaHeight = textareaHeight;
            
            // Draw textarea background
            ctx.fillStyle = background_color;
            ctx.fillRect(textareaX, textareaY, textareaWidth, textareaHeight);
            ctx.strokeStyle = outline_color;
            ctx.lineWidth = 1;
            if (show_text && !w.disabled) {
                ctx.strokeRect(textareaX, textareaY, textareaWidth, textareaHeight);
            }
            
            // Draw text content
            if (show_text) {
                var value = w.value || "";
                if (value) {
                    ctx.fillStyle = text_color;
                    ctx.font = "12px Arial";
                    ctx.textAlign = "left";
                    ctx.textBaseline = "top";
                    
                    // Split by newlines first
                    var rawLines = String(value).split("\n");
                    var lineHeight = 14;
                    var maxWidth = textareaWidth - 8; // Account for padding
                    var wrappedLines = [];
                    
                    // Word-wrap each line to fit within textarea width
                    for (var i = 0; i < rawLines.length; i++) {
                        var line = rawLines[i];
                        var words = line.split(" ");
                        var currentLine = "";
                        
                        for (var j = 0; j < words.length; j++) {
                            var word = words[j];
                            
                            // Handle very long words that exceed maxWidth - break them
                            var wordMetrics = ctx.measureText(word);
                            if (wordMetrics.width > maxWidth) {
                                // Word is too long, break it character by character
                                if (currentLine) {
                                    wrappedLines.push(currentLine);
                                    currentLine = "";
                                }
                                
                                // Break long word into chunks
                                var charIdx = 0;
                                while (charIdx < word.length) {
                                    var chunk = "";
                                    while (charIdx < word.length) {
                                        var testChunk = chunk + word[charIdx];
                                        var chunkMetrics = ctx.measureText(testChunk);
                                        if (chunkMetrics.width > maxWidth && chunk.length > 0) {
                                            break;
                                        }
                                        chunk = testChunk;
                                        charIdx++;
                                    }
                                    if (chunk) {
                                        wrappedLines.push(chunk);
                                    }
                                }
                                continue;
                            }
                            
                            // Normal word wrapping
                            var testLine = currentLine ? currentLine + " " + word : word;
                            var metrics = ctx.measureText(testLine);
                            
                            if (metrics.width > maxWidth && currentLine) {
                                // Current line is full, start new line
                                wrappedLines.push(currentLine);
                                currentLine = word;
                            } else {
                                currentLine = testLine;
                            }
                        }
                        
                        // Add the last line
                        if (currentLine) {
                            wrappedLines.push(currentLine);
                        }
                    }
                    
                    // Compute maxLines from clamped textareaHeight
                    var maxLines = Math.max(0, Math.floor(textareaHeight / lineHeight));
                    var maxLinesClamped = Math.max(1, maxLines);
                    
                    // Draw wrapped lines
                    for (var lineIdx = 0; lineIdx < wrappedLines.length && lineIdx < maxLinesClamped; lineIdx++) {
                        ctx.fillText(
                            wrappedLines[lineIdx],
                            textareaX + 4,
                            textareaY + 4 + (lineIdx * lineHeight)
                        );
                    }
                    
                    // Show ellipsis if text is truncated
                    if (wrappedLines.length > maxLinesClamped) {
                        ctx.fillText("...", textareaX + 4, textareaY + 4 + (maxLinesClamped * lineHeight));
                    }
                }
            }
            // Don't increment posY for textarea as it fills the node
            if (!w.computeSize) {
                w.computeSize = function() { return [0, 0]; };
            }
        }

        /**
         * Patch drawNodeWidgets - handle textarea widgets
         */
        LGC.prototype.drawNodeWidgets = function(node, posY, ctx, active_widget) {
            if (!node.widgets || !node.widgets.length) {
                return originalDrawNodeWidgets.call(this, node, posY, ctx, active_widget);
            }

            var width = node.size[0];
            var widgets = node.widgets;
            var H = LG.NODE_WIDGET_HEIGHT;
            var show_text = this.ds.scale > 0.5;
            var margin = 15;
            var titleHeight = LG.NODE_TITLE_HEIGHT;
            var padding = 10;
            var outline_color = LG.WIDGET_OUTLINE_COLOR;
            var background_color = LG.WIDGET_BGCOLOR;
            var text_color = LG.WIDGET_TEXT_COLOR;
            var secondary_text_color = LG.WIDGET_SECONDARY_TEXT_COLOR;

            // Separate textarea widgets from others
            var textareaWidgets = [];
            var otherWidgets = [];
            for (let i = 0; i < widgets.length; i++) {
                if (widgets[i].type === "textarea") {
                    textareaWidgets.push(widgets[i]);
                } else {
                    otherWidgets.push(widgets[i]);
                }
            }

            // Draw textarea widgets first
            if (textareaWidgets.length > 0) {
                ctx.save();
                ctx.globalAlpha = this.editor_alpha;
                for (let i = 0; i < textareaWidgets.length; i++) {
                    var w = textareaWidgets[i];
                    var y = posY + 2;
                    if (w.y) {
                        y = w.y;
                    }
                    w.last_y = y;
                    var widget_width = w.width || width;
                    
                    if (w.disabled) {
                        ctx.globalAlpha *= 0.5;
                    }
                    
                    // Pass posY so textarea starts below inputs
                    drawTextareaWidget(w, node, ctx, widget_width, show_text, margin, titleHeight, padding, background_color, outline_color, text_color, posY);
                    
                    ctx.globalAlpha = this.editor_alpha;
                }
                ctx.restore();
            }

            // Draw other widgets using original method
            if (otherWidgets.length > 0) {
                var originalWidgets = node.widgets;
                node.widgets = otherWidgets;
                try {
                    originalDrawNodeWidgets.call(this, node, posY, ctx, active_widget);
                } finally {
                    node.widgets = originalWidgets;
                }
            }

            // Handle posY increment - textarea widgets don't increment
            // The original method already handled non-textarea widgets
        };

        /**
         * Patch processNodeWidgets - add textarea click handling
         * Based on string/text widget implementation from litegraph.js
         */
        LGC.prototype.processNodeWidgets = function(node, pos, event, active_widget) {
            if (!node.widgets || !node.widgets.length || (!this.allow_interaction && !node.flags.allow_interaction)) {
                return originalProcessNodeWidgets.call(this, node, pos, event, active_widget);
            }

            var x = pos[0] - node.pos[0];
            var y = pos[1] - node.pos[1];
            var width = node.size[0];
            var that = this;

            for (var i = 0; i < node.widgets.length; ++i) {
                var w = node.widgets[i];
                if (!w || w.disabled) continue;

                var widget_height = w.computeSize ? w.computeSize(width)[1] : LG.NODE_WIDGET_HEIGHT;
                var widget_width = w.width || width;

                // Handle textarea widget clicks - inline editing
                if (w.type === "textarea") {
                    var padding = 10;
                    var textareaX = 15; // margin
                    // Use stored positions from draw
                    var textareaY = w._textareaY || (LG.NODE_TITLE_HEIGHT + padding);
                    var textareaWidth = w._textareaWidth || (widget_width - 30);
                    var textareaHeight = w._textareaHeight || (node.size[1] - textareaY - padding);

                    // Check if click is within textarea bounds
                    if (x >= textareaX && x <= textareaX + textareaWidth &&
                        y >= textareaY && y <= textareaY + textareaHeight) {
                        
                        // Use LiteGraph's built-in prompt (like string/text widgets)
                        if (event.type == LG.pointerevents_method + "down") {
                            that.prompt(
                                w.label || w.name || "Text",
                                String(w.value || ""),
                                function(v) {
                                    // Capture old value before assignment
                                    var oldValue = w.value;
                                    w.value = v;
                                    if (w.options && w.options.property) {
                                        node.setProperty(w.options.property, v);
                                    }
                                    if (w.callback) {
                                        w.callback(v, that, node, pos, event);
                                    }
                                    if (node.onWidgetChanged) {
                                        node.onWidgetChanged(w.name, v, oldValue, w);
                                    }
                                    if (node.graph) {
                                        node.graph._version++;
                                    }
                                    that.dirty_canvas = true;
                                }.bind(w),
                                event,
                                true // multiline = true for textarea
                            );
                            return w;
                        }
                    }
                    continue;
                }

                // For non-textarea widgets, check bounds
                if (w != active_widget && 
                    (x < 6 || x > widget_width - 12 || y < w.last_y || y > w.last_y + widget_height || w.last_y === undefined)) {
                    continue;
                }

                // Process non-textarea widgets using original method
                var result = originalProcessNodeWidgets.call(this, node, pos, event, active_widget);
                if (result) {
                    return result;
                }
            }

            return null;
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
