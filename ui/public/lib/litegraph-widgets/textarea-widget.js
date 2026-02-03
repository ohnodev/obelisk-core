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
        function drawTextareaWidget(w, node, ctx, widget_width, show_text, margin, titleHeight, padding, background_color, outline_color, text_color) {
            var textareaX = margin;
            var textareaY = titleHeight + padding;
            var textareaWidth = widget_width - (margin * 2);
            // Clamp textareaHeight to non-negative to prevent negative values when node.size[1] is too small
            var textareaHeight = Math.max(0, node.size[1] - titleHeight - (padding * 2));
            
            // Store widget position for click handling
            w._textareaX = textareaX;
            w._textareaY = textareaY;
            w._textareaWidth = textareaWidth;
            w._textareaHeight = textareaHeight;
            
            // Create HTML textarea element if it doesn't exist (reuse it, don't create new ones)
            if (!w._htmlTextarea) {
                var htmlTextarea = document.createElement("textarea");
                htmlTextarea.style.position = "absolute";
                htmlTextarea.style.pointerEvents = "auto"; // Always clickable
                htmlTextarea.style.border = "none";
                htmlTextarea.style.background = "transparent";
                htmlTextarea.style.color = "#FFFFFF";
                htmlTextarea.style.fontSize = "12px";
                htmlTextarea.style.fontFamily = "Arial, sans-serif";
                htmlTextarea.style.resize = "none";
                htmlTextarea.style.outline = "none";
                htmlTextarea.style.overflow = "auto";
                htmlTextarea.style.padding = "4px";
                htmlTextarea.style.lineHeight = "14px";
                htmlTextarea.style.boxSizing = "border-box";
                htmlTextarea.style.opacity = "1"; // Always visible
                
                // Get canvas container
                var canvas = ctx.canvas;
                var canvasContainer = canvas.parentElement;
                if (canvasContainer) {
                    canvasContainer.appendChild(htmlTextarea);
                    w._htmlTextarea = htmlTextarea;
                }
                
                // Sync on input
                htmlTextarea.addEventListener("input", function() {
                    w.value = htmlTextarea.value;
                    if (w.options && w.options.property) {
                        node.setProperty(w.options.property, htmlTextarea.value);
                    }
                    if (w.callback) {
                        var canvasInstance = window.__obeliskCanvas;
                        w.callback(htmlTextarea.value, canvasInstance, node, [node.pos[0] + textareaX, node.pos[1] + textareaY], null);
                    }
                    if (node.graph) {
                        node.graph._version++;
                    }
                    var canvasInstance = window.__obeliskCanvas;
                    if (canvasInstance) {
                        canvasInstance.dirty_canvas = true;
                        canvasInstance.draw(true);
                    }
                });
                
                // Just redraw on blur (textarea stays visible)
                htmlTextarea.addEventListener("blur", function() {
                    var canvasInstance = window.__obeliskCanvas;
                    if (canvasInstance) {
                        canvasInstance.dirty_canvas = true;
                        canvasInstance.draw(true);
                    }
                });
            }
            
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
                    
                    // Hide text rendering if textarea element is focused
                    if (w._textareaElement && document.activeElement === w._textareaElement) {
                        // Don't draw text when editing
                    } else {
                    // Don't draw canvas text - HTML textarea is always visible and handles display
                    // Canvas text would overlap with HTML textarea
                    
                    // Update HTML textarea position and size
                    if (w._htmlTextarea) {
                        var canvasRect = ctx.canvas.getBoundingClientRect();
                        var canvasInstance = window.__obeliskCanvas;
                        if (canvasInstance && canvasInstance.ds) {
                            var scale = canvasInstance.ds.scale || 1;
                            var offsetX = canvasInstance.ds.offset ? canvasInstance.ds.offset[0] : 0;
                            var offsetY = canvasInstance.ds.offset ? canvasInstance.ds.offset[1] : 0;
                            
                            var screenX = canvasRect.left + (node.pos[0] + textareaX) * scale + offsetX;
                            var screenY = canvasRect.top + (node.pos[1] + textareaY) * scale + offsetY;
                            
                            w._htmlTextarea.style.left = screenX + "px";
                            w._htmlTextarea.style.top = screenY + "px";
                            w._htmlTextarea.style.width = (textareaWidth * scale) + "px";
                            w._htmlTextarea.style.height = (textareaHeight * scale) + "px";
                            w._htmlTextarea.value = String(w.value || '');
                        }
                    }
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
                    
                    drawTextareaWidget(w, node, ctx, widget_width, show_text, margin, titleHeight, padding, background_color, outline_color, text_color);
                    
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
                    var titleHeight = LG.NODE_TITLE_HEIGHT;
                    var padding = 10;
                    var textareaX = 15; // margin
                    var textareaY = titleHeight + padding;
                    var textareaWidth = widget_width - 30;
                    var textareaHeight = node.size[1] - titleHeight - (padding * 2);

                    // Check if click is within textarea bounds
                    if (x >= textareaX && x <= textareaX + textareaWidth &&
                        y >= textareaY && y <= textareaY + textareaHeight) {
                        
                        if (event.type === LG.pointerevents_method + "down") {
                            // Prevent default to avoid node selection
                            if (event.preventDefault) {
                                event.preventDefault();
                            }
                            if (event.stopPropagation) {
                                event.stopPropagation();
                            }
                            
                            // Use the existing HTML textarea that's part of the widget
                            if (w._htmlTextarea) {
                                w._htmlTextarea.style.pointerEvents = "auto";
                                w._htmlTextarea.style.opacity = "1";
                                w._htmlTextarea.focus();
                                w._htmlTextarea.select();
                                return w;
                            }
                            
                            // Store reference to widget and node for cleanup
                            editor._widget = w;
                            editor._node = node;
                            editor._canvas = that;
                            
                            // Handle blur (when user clicks away or presses Escape)
                            var handleBlur = function() {
                                var oldValue = w.value;
                                var newValue = editor.value;
                                
                                // Update widget value
                                w.value = newValue;
                                
                                // Update node property if specified
                                if (w.options && w.options.property) {
                                    node.setProperty(w.options.property, newValue);
                                }
                                
                                // Call widget callback
                                if (w.callback) {
                                    w.callback(newValue, that, node, [node.pos[0] + textareaX, node.pos[1] + textareaY], event);
                                }
                                
                                // Call node widget changed handler
                                if (node.onWidgetChanged) {
                                    node.onWidgetChanged(w.name, newValue, oldValue, w);
                                }
                                
                                // Mark graph as changed
                                if (node.graph) {
                                    node.graph._version++;
                                }
                                
                                // Remove editor
                                editor.remove();
                                
                                // Redraw canvas
                                that.dirty_canvas = true;
                                that.draw(true);
                            };
                            
                            // Handle Escape key to cancel
                            var handleKeyDown = function(e) {
                                if (e.key === "Escape") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    editor.value = String(w.value || ""); // Restore original value
                                    editor.blur();
                                }
                            };
                            
                            editor.addEventListener("blur", handleBlur);
                            editor.addEventListener("keydown", handleKeyDown);
                            
                            // Also handle clicks outside the editor
                            var handleOutsideClick = function(e) {
                                if (editor && !editor.contains(e.target)) {
                                    editor.blur();
                                }
                            };
                            
                            // Cleanup function
                            var cleanup = function() {
                                if (editor._outsideClickHandler) {
                                    document.removeEventListener("mousedown", editor._outsideClickHandler);
                                }
                                if (editor.parentNode) {
                                    editor.remove();
                                }
                            };
                            
                            // Use setTimeout to avoid immediate blur from the click that opened it
                            setTimeout(function() {
                                if (editor && editor.parentNode) {
                                    document.addEventListener("mousedown", handleOutsideClick);
                                    editor._outsideClickHandler = handleOutsideClick;
                                    editor._cleanup = cleanup;
                                }
                            }, 100);
                            
                            // Cleanup on blur
                            var originalBlur = handleBlur;
                            handleBlur = function() {
                                if (editor._cleanup) {
                                    editor._cleanup();
                                }
                                originalBlur();
                            };
                            
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
