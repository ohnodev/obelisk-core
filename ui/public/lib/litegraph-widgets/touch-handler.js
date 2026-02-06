/**
 * Touch Handler Extension for LiteGraph
 * 
 * Adds native touch support with pinch-to-zoom and single-finger panning.
 * This patches bindEvents to add touch event listeners.
 * 
 * Similar to how lightweight-charts handles touch gestures.
 */

(function() {
    'use strict';

    function patchLiteGraph() {
        if (!window.LiteGraph || !window.LGraphCanvas) {
            return false;
        }

        var LGC = window.LGraphCanvas;

        // Check if already patched
        if (LGC.prototype._touchHandlerPatched) {
            return true;
        }

        // Store original bindEvents
        var originalBindEvents = LGC.prototype.bindEvents;
        var originalUnbindEvents = LGC.prototype.unbindEvents;

        /**
         * Touch state tracking
         */
        function createTouchState() {
            return {
                active: false,
                lastTouches: [],
                isPinching: false,
                initialPinchDistance: 0,
                lastPinchDistance: 0,
                lastTouchTime: 0,
                isTouchDevice: false,
                wasPinching: false, // Track if we were just pinching to prevent click after pinch
                pinchEndTime: 0, // Track when pinch ended for cooldown
                longPressTimer: null,
                longPressTriggered: false,
                longPressDuration: 500 // ms to trigger long press
            };
        }
        
        // Cooldown period after pinch where we block context menus
        var PINCH_COOLDOWN_MS = 400;

        /**
         * Calculate distance between two touch points
         */
        function getTouchDistance(touches) {
            if (touches.length < 2) return 0;
            var dx = touches[1].clientX - touches[0].clientX;
            var dy = touches[1].clientY - touches[0].clientY;
            return Math.sqrt(dx * dx + dy * dy);
        }

        /**
         * Get center point between touches
         */
        function getTouchCenter(touches) {
            if (touches.length < 2) {
                return { x: touches[0].clientX, y: touches[0].clientY };
            }
            return {
                x: (touches[0].clientX + touches[1].clientX) / 2,
                y: (touches[0].clientY + touches[1].clientY) / 2
            };
        }

        /**
         * Create synthetic mouse event from touch
         */
        function createMouseEvent(type, touch, originalEvent, canvas) {
            var rect = canvas.getBoundingClientRect();
            return new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: touch.clientX,
                clientY: touch.clientY,
                screenX: touch.screenX,
                screenY: touch.screenY,
                button: 0,
                buttons: type === "mouseup" ? 0 : 1,
                ctrlKey: originalEvent.ctrlKey || false,
                altKey: originalEvent.altKey || false,
                shiftKey: originalEvent.shiftKey || false,
                metaKey: originalEvent.metaKey || false
            });
        }

        // Store original getCanvasMenuOptions to patch it
        var originalGetCanvasMenuOptions = LGC.prototype.getCanvasMenuOptions;
        var originalGetNodeMenuOptions = LGC.prototype.getNodeMenuOptions;
        
        // Patch getCanvasMenuOptions to block during pinch cooldown
        LGC.prototype.getCanvasMenuOptions = function() {
            var touchState = this._touchState;
            if (touchState && touchState.isTouchDevice) {
                var timeSincePinch = Date.now() - touchState.pinchEndTime;
                if (timeSincePinch < PINCH_COOLDOWN_MS) {
                    // Block menu during cooldown
                    return null;
                }
            }
            return originalGetCanvasMenuOptions ? originalGetCanvasMenuOptions.call(this) : null;
        };
        
        // Patch getNodeMenuOptions to block during pinch cooldown
        LGC.prototype.getNodeMenuOptions = function(node) {
            var touchState = this._touchState;
            if (touchState && touchState.isTouchDevice) {
                var timeSincePinch = Date.now() - touchState.pinchEndTime;
                if (timeSincePinch < PINCH_COOLDOWN_MS) {
                    // Block menu during cooldown
                    return null;
                }
            }
            return originalGetNodeMenuOptions ? originalGetNodeMenuOptions.call(this, node) : null;
        };

        /**
         * Patched bindEvents with touch support
         */
        LGC.prototype.bindEvents = function() {
            // Call original bindEvents first
            originalBindEvents.call(this);

            var canvas = this.canvas;
            var self = this;
            
            // Initialize touch state
            this._touchState = createTouchState();

            /**
             * Handle touch start
             */
            this._touchstart_callback = function(e) {
                var touchState = self._touchState;
                
                // Mark as touch device
                touchState.isTouchDevice = true;
                
                // Prevent default browser behavior (scrolling, zoom, etc.)
                e.preventDefault();
                e.stopPropagation();
                
                // Clear any existing long press timer
                if (touchState.longPressTimer) {
                    clearTimeout(touchState.longPressTimer);
                    touchState.longPressTimer = null;
                }
                touchState.longPressTriggered = false;
                
                // Close any open search box or menus
                if (self.search_box) {
                    self.search_box.style.display = 'none';
                }
                self.allow_searchbox = false;
                
                touchState.active = true;
                
                // Save previous touch count BEFORE updating lastTouches
                var prevTouchCount = touchState.lastTouches ? touchState.lastTouches.length : 0;
                var wasSingleTouch = prevTouchCount === 1 && !touchState.isPinching;
                
                touchState.wasPinching = false;

                if (e.touches.length === 2) {
                    // Two finger touch - start pinch tracking
                    // If we had a single touch drag, end it first
                    if (wasSingleTouch) {
                        var lastTouch = touchState.lastTouches[0];
                        var syntheticTouch = { clientX: lastTouch.x, clientY: lastTouch.y, screenX: lastTouch.x, screenY: lastTouch.y };
                        var mouseUp = createMouseEvent("mouseup", syntheticTouch, e, canvas);
                        canvas.dispatchEvent(mouseUp);
                    }
                    
                    // Now update lastTouches after handling the transition
                    touchState.lastTouches = Array.from(e.touches).map(function(t) {
                        return { x: t.clientX, y: t.clientY };
                    });
                    
                    touchState.isPinching = true;
                    touchState.initialPinchDistance = getTouchDistance(e.touches);
                    touchState.lastPinchDistance = touchState.initialPinchDistance;
                    
                } else if (e.touches.length === 1) {
                    // Single touch
                    var now = Date.now();
                    var timeSinceLastTouch = now - touchState.lastTouchTime;
                    var timeSincePinch = now - touchState.pinchEndTime;
                    
                    // If recently pinched, allow panning but skip long press and menu triggers
                    var isInPinchCooldown = timeSincePinch < PINCH_COOLDOWN_MS;
                    
                    // If less than 300ms since last touch end and was pinching, ignore (prevent double-tap menu)
                    if (timeSinceLastTouch < 300 && touchState.wasPinching) {
                        // Still allow basic drag but don't trigger anything else
                        touchState.isPinching = false;
                        touchState.lastTouches = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];
                        return;
                    }
                    
                    touchState.isPinching = false;
                    
                    // Only start long press timer if NOT in pinch cooldown
                    if (!isInPinchCooldown) {
                        var touch = e.touches[0];
                        var startX = touch.clientX;
                        var startY = touch.clientY;
                        
                        touchState.longPressTimer = setTimeout(function() {
                            // Only trigger if finger hasn't moved much
                            if (touchState.lastTouches.length === 1) {
                                var currentX = touchState.lastTouches[0].x;
                                var currentY = touchState.lastTouches[0].y;
                                var moved = Math.sqrt(Math.pow(currentX - startX, 2) + Math.pow(currentY - startY, 2));
                                
                                if (moved < 10) { // Less than 10px movement
                                    touchState.longPressTriggered = true;
                                    
                                    // Dispatch context menu event (right-click)
                                    var contextMenuEvent = new MouseEvent("contextmenu", {
                                        bubbles: true,
                                        cancelable: true,
                                        view: window,
                                        clientX: startX,
                                        clientY: startY,
                                        button: 2,
                                        buttons: 2
                                    });
                                    canvas.dispatchEvent(contextMenuEvent);
                                    
                                    // Also cancel the mousedown drag
                                    var mouseUp = new MouseEvent("mouseup", {
                                        bubbles: true,
                                        cancelable: true,
                                        view: window,
                                        clientX: startX,
                                        clientY: startY,
                                        button: 0,
                                        buttons: 0
                                    });
                                    canvas.dispatchEvent(mouseUp);
                                }
                            }
                        }, touchState.longPressDuration);
                    }
                    
                    // Simulate mousedown for panning/dragging (but during cooldown, clear node state first)
                    if (isInPinchCooldown) {
                        // Clear any node selection that could trigger menus
                        self.node_over = null;
                        self.node_capturing_input = null;
                    }
                    
                    var mouseDown = createMouseEvent("mousedown", e.touches[0], e, canvas);
                    canvas.dispatchEvent(mouseDown);
                    
                    // Update lastTouches AFTER processing single touch
                    touchState.lastTouches = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];
                }
            };

            /**
             * Handle touch move
             */
            this._touchmove_callback = function(e) {
                var touchState = self._touchState;
                
                if (!touchState.active) return;
                
                e.preventDefault();
                e.stopPropagation();
                
                // Cancel long press if moving
                if (touchState.longPressTimer && e.touches.length === 1) {
                    var touch = e.touches[0];
                    var startTouch = touchState.lastTouches[0];
                    if (startTouch) {
                        var moved = Math.sqrt(Math.pow(touch.clientX - startTouch.x, 2) + Math.pow(touch.clientY - startTouch.y, 2));
                        if (moved > 10) {
                            clearTimeout(touchState.longPressTimer);
                            touchState.longPressTimer = null;
                        }
                    }
                }

                if (e.touches.length === 2 && touchState.isPinching) {
                    // Two finger move - handle pinch zoom directly
                    var currentDistance = getTouchDistance(e.touches);
                    var center = getTouchCenter(e.touches);
                    
                    // Calculate zoom
                    var distanceRatio = currentDistance / touchState.lastPinchDistance;
                    
                    if (Math.abs(distanceRatio - 1) > 0.01) {
                        var rect = canvas.getBoundingClientRect();
                        var canvasX = center.x - rect.left;
                        var canvasY = center.y - rect.top;
                        
                        // Calculate new scale
                        var newScale = self.ds.scale * distanceRatio;
                        
                        // Clamp scale
                        newScale = Math.max(0.1, Math.min(10, newScale));
                        
                        if (newScale !== self.ds.scale) {
                            // Calculate zoom centered on pinch point
                            var graphX = (canvasX - self.ds.offset[0]) / self.ds.scale;
                            var graphY = (canvasY - self.ds.offset[1]) / self.ds.scale;
                            
                            self.ds.scale = newScale;
                            
                            // Adjust offset to keep zoom centered
                            self.ds.offset[0] = canvasX - graphX * newScale;
                            self.ds.offset[1] = canvasY - graphY * newScale;
                            
                            self.dirty_canvas = true;
                            self.dirty_bgcanvas = true;
                        }
                        
                        touchState.lastPinchDistance = currentDistance;
                    }
                    
                    // Also handle two-finger pan
                    if (touchState.lastTouches.length >= 2) {
                        var lastCenter = {
                            x: (touchState.lastTouches[0].x + touchState.lastTouches[1].x) / 2,
                            y: (touchState.lastTouches[0].y + touchState.lastTouches[1].y) / 2
                        };
                        
                        var panDeltaX = center.x - lastCenter.x;
                        var panDeltaY = center.y - lastCenter.y;
                        
                        if (Math.abs(panDeltaX) > 1 || Math.abs(panDeltaY) > 1) {
                            self.ds.offset[0] += panDeltaX;
                            self.ds.offset[1] += panDeltaY;
                            self.dirty_canvas = true;
                            self.dirty_bgcanvas = true;
                        }
                    }
                    
                    // Update last touches
                    touchState.lastTouches = Array.from(e.touches).map(function(t) {
                        return { x: t.clientX, y: t.clientY };
                    });
                    
                    // Force redraw
                    if (self.draw) {
                        self.draw(true, true);
                    }
                    
                } else if (e.touches.length === 1 && !touchState.isPinching) {
                    // Single touch move - simulate mousemove for dragging
                    var mouseMove = createMouseEvent("mousemove", e.touches[0], e, canvas);
                    canvas.dispatchEvent(mouseMove);
                    touchState.lastTouches = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];
                }
            };

            /**
             * Handle touch end
             */
            this._touchend_callback = function(e) {
                var touchState = self._touchState;
                
                e.preventDefault();
                e.stopPropagation();
                
                // Clear long press timer
                if (touchState.longPressTimer) {
                    clearTimeout(touchState.longPressTimer);
                    touchState.longPressTimer = null;
                }
                
                // Track touch end time
                touchState.lastTouchTime = Date.now();
                
                // Track if we were pinching BEFORE we reset state
                var wasPinchingNow = touchState.isPinching;

                if (e.touches.length === 0) {
                    // All fingers lifted
                    
                    if (wasPinchingNow) {
                        // Was pinching - DON'T send any mouse events, just clean up
                        // This prevents context menus from appearing
                        touchState.pinchEndTime = Date.now();
                        
                        // Clear any node selection state that might trigger context menu
                        self.node_over = null;
                        self.node_capturing_input = null;
                        self.node_dragged = null;
                        self.dragging_canvas = false;
                        
                    } else if (!touchState.longPressTriggered && touchState.lastTouches.length > 0) {
                        // Was single touch (not pinch, not long press) - simulate mouseup
                        var lastTouch = touchState.lastTouches[0];
                        var mouseUp = new MouseEvent("mouseup", {
                            bubbles: true,
                            cancelable: true,
                            view: window,
                            clientX: lastTouch.x,
                            clientY: lastTouch.y,
                            button: 0,
                            buttons: 0
                        });
                        canvas.dispatchEvent(mouseUp);
                    }
                    
                    // Track if we were pinching (to prevent double-tap menu)
                    touchState.wasPinching = wasPinchingNow;
                    
                    // Reset state
                    touchState.active = false;
                    touchState.isPinching = false;
                    touchState.lastTouches = [];
                    touchState.initialPinchDistance = 0;
                    touchState.lastPinchDistance = 0;
                    touchState.longPressTriggered = false;
                    
                } else if (e.touches.length === 1 && wasPinchingNow) {
                    // Went from 2 fingers to 1 after pinching
                    // DON'T simulate mousedown - this prevents node context menu
                    touchState.wasPinching = true;
                    touchState.isPinching = false;
                    touchState.pinchEndTime = Date.now();
                    touchState.lastTouches = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];
                    
                    // Clear any selection/drag state
                    self.node_over = null;
                    self.node_capturing_input = null;
                    self.dragging_canvas = false;
                }
            };

            // Add touch event listeners with passive: false to allow preventDefault
            canvas.addEventListener("touchstart", this._touchstart_callback, { passive: false });
            canvas.addEventListener("touchmove", this._touchmove_callback, { passive: false });
            canvas.addEventListener("touchend", this._touchend_callback, { passive: false });
            canvas.addEventListener("touchcancel", this._touchend_callback, { passive: false });
        };

        /**
         * Patched unbindEvents to remove touch listeners
         */
        LGC.prototype.unbindEvents = function() {
            // Remove touch listeners first
            if (this._touchstart_callback) {
                this.canvas.removeEventListener("touchstart", this._touchstart_callback);
                this.canvas.removeEventListener("touchmove", this._touchmove_callback);
                this.canvas.removeEventListener("touchend", this._touchend_callback);
                this.canvas.removeEventListener("touchcancel", this._touchend_callback);
                
                this._touchstart_callback = null;
                this._touchmove_callback = null;
                this._touchend_callback = null;
                this._touchState = null;
            }
            
            // Call original unbindEvents
            originalUnbindEvents.call(this);
        };

        // Mark as patched
        LGC.prototype._touchHandlerPatched = true;

        console.log("[LiteGraph] Touch handler extension loaded");
        return true;
    }

    // Try to patch immediately
    if (!patchLiteGraph()) {
        // If LiteGraph not ready, wait for it
        var checkInterval = setInterval(function() {
            if (patchLiteGraph()) {
                clearInterval(checkInterval);
            }
        }, 50);
        
        // Timeout after 10 seconds
        setTimeout(function() {
            clearInterval(checkInterval);
            if (!window.LiteGraph) {
                console.warn("[LiteGraph] Touch handler: LiteGraph not found after timeout");
            }
        }, 10000);
    }
})();
