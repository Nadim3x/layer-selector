/**
 * Layer Selector - host.jsx
 * ---------------------------------------------------------------------------
 * ExtendScript back-end for the Layer Selector CEP panel (Adobe After Effects).
 *
 * This file is loaded automatically by CEP via <ScriptPath> in CSXS/manifest.xml
 * and runs inside the After Effects scripting engine. The panel front-end
 * (client/index.js) calls these functions through CSInterface.evalScript().
 *
 * IMPORTANT: ExtendScript is an ES3-era engine.
 *   - NO let / const, arrow functions, template literals, JSON, Array.isArray,
 *     String.prototype.trim, etc.
 *   - Use `var`, classic `function` declarations, and manual JSON serialization.
 *
 * AE object model notes used throughout:
 *   - app.project.activeItem  -> the item currently active in the UI (CompItem
 *     when a composition timeline has focus).
 *   - CompItem.layer(index)   -> layers are 1-based; index 1 is the TOP layer.
 *   - TextLayer / ShapeLayer / CameraLayer / LightLayer / AVLayer are the layer
 *     classes exposed by the AE scripting model.
 *   - AVLayer flags: .adjustmentLayer and .nullLayer booleans.
 *   - AVLayer.source: CompItem (pre-comp), FootageItem (footage or solid).
 *     FootageItem.mainSource: SolidSource for solids, FileSource for real media.
 *   - Property access by matchName ("ADBE Text Document") is locale-independent,
 *     unlike display names such as "Source Text" which are translated in
 *     non-English versions of AE.
 *
 * Every public function returns a JSON string so the CEP client can parse the
 * result safely (fallback: treat the return value as a plain string).
 * All layer modifications are wrapped in app.beginUndoGroup()/endUndoGroup()
 * so the user can undo with Ctrl+Z / Cmd+Z.
 */

// ===========================================================================
// Internal helpers
// ===========================================================================

/**
 * Escape a string so it can be embedded in a JSON string literal.
 * @param {String} str
 * @returns {String} escaped string body (without surrounding quotes)
 */
function lsEscapeJsonString(str) {
    var out = "";
    var i, ch, code, hex;
    str = String(str);
    for (i = 0; i < str.length; i++) {
        ch = str.charAt(i);
        code = str.charCodeAt(i);
        if (ch === '"') {
            out += '\\"';
        } else if (ch === "\\") {
            out += "\\\\";
        } else if (ch === "\n") {
            out += "\\n";
        } else if (ch === "\r") {
            out += "\\r";
        } else if (ch === "\t") {
            out += "\\t";
        } else if (code < 32) {
            hex = code.toString(16);
            while (hex.length < 4) {
                hex = "0" + hex;
            }
            out += "\\u" + hex;
        } else {
            out += ch;
        }
    }
    return out;
}

/**
 * Minimal JSON serializer (ExtendScript has no reliable JSON object).
 * Supports null/undefined, booleans, numbers, strings, Arrays and plain objects.
 * @param {*} value
 * @returns {String} JSON text
 */
function lsToJson(value) {
    var t = typeof value;
    var i, parts, items, k;

    if (value === null || value === undefined) {
        return "null";
    }
    if (t === "boolean") {
        return value ? "true" : "false";
    }
    if (t === "number") {
        return isFinite(value) ? String(value) : "null";
    }
    if (t === "string") {
        return '"' + lsEscapeJsonString(value) + '"';
    }
    if (value instanceof Array) {
        items = [];
        for (i = 0; i < value.length; i++) {
            items.push(lsToJson(value[i]));
        }
        return "[" + items.join(",") + "]";
    }
    if (t === "object") {
        parts = [];
        for (k in value) {
            if (value.hasOwnProperty(k)) {
                parts.push('"' + lsEscapeJsonString(k) + '":' + lsToJson(value[k]));
            }
        }
        return "{" + parts.join(",") + "}";
    }
    return "null";
}

/**
 * Standard success response object.
 */
function lsOk(message, extra) {
    var obj = { ok: true, message: message };
    var k;
    if (extra) {
        for (k in extra) {
            if (extra.hasOwnProperty(k)) {
                obj[k] = extra[k];
            }
        }
    }
    return lsToJson(obj);
}

/**
 * Standard error response object.
 */
function lsFail(message, extra) {
    var obj = { ok: false, message: message };
    var k;
    if (extra) {
        for (k in extra) {
            if (extra.hasOwnProperty(k)) {
                obj[k] = extra[k];
            }
        }
    }
    return lsToJson(obj);
}

/**
 * Human-readable labels for every supported layer category (match the keys
 * used by the CEP front-end).
 */
function lsTypeLabel(type) {
    var labels = {
        text: "Text",
        adjustment: "Adjustment",
        solid: "Solid",
        shape: "Shape",
        camera: "Camera",
        light: "Light",
        "null": "Null",
        footage: "Footage",
        precomp: "Pre-comp"
    };
    return labels[type] || type;
}

/**
 * Check that `type` is one of the categories the panel knows about.
 * @param {String} type
 * @returns {Boolean}
 */
function lsIsValidType(type) {
    return type === "text" ||
           type === "adjustment" ||
           type === "solid" ||
           type === "shape" ||
           type === "camera" ||
           type === "light" ||
           type === "null" ||
           type === "footage" ||
           type === "precomp";
}

/**
 * Resolve the active composition.
 * @returns {CompItem|null} the active comp, or null when there is none
 */
function lsGetActiveComp() {
    var item = (app.project) ? app.project.activeItem : null;
    if (item && (item instanceof CompItem)) {
        return item;
    }
    return null;
}

/**
 * Build the error payload for the "no usable composition" case. Distinguishes
 * between "nothing is open" and "the active item is not a composition"
 * (e.g. the Project panel or a Footage viewer has focus).
 * @returns {String} JSON response
 */
function lsNoCompResponse() {
    var item = (app.project) ? app.project.activeItem : null;
    if (!item) {
        return lsFail("No active composition. Open a composition and try again.", { hasComp: false });
    }
    return lsFail("Active item is not a composition. Click a composition first.", { hasComp: false });
}

/**
 * Detect the category of a single layer using the AE object model.
 *
 * Detection order matters:
 *   1. Dedicated layer classes (Text, Shape, Camera, Light) come first.
 *   2. For AVLayers, Null is checked before Adjustment before Solid because
 *      nulls and adjustment layers are AVLayers backed by solid sources.
 *   3. AVLayer + CompItem source  -> pre-comp
 *   4. AVLayer + SolidSource      -> solid
 *   5. Anything else (FileSource footage, audio, unknown classes) -> footage
 *
 * @param {Layer} layer
 * @returns {String} one of: text | adjustment | solid | shape | camera |
 *                   light | null | footage | precomp
 */
function lsDetectLayerType(layer) {
    // TextLayer is a subclass of AVLayer, so test it first.
    if (layer instanceof TextLayer) {
        return "text";
    }
    // ShapeLayer is also a subclass of AVLayer.
    if (layer instanceof ShapeLayer) {
        return "shape";
    }
    if (layer instanceof CameraLayer) {
        return "camera";
    }
    if (layer instanceof LightLayer) {
        return "light";
    }
    if (layer instanceof AVLayer) {
        // Null layers: AVLayer with .nullLayer === true (invisible helper layers).
        if (layer.nullLayer === true) {
            return "null";
        }
        // Adjustment layers: AVLayer with .adjustmentLayer === true.
        // (Usually a solid source with the adjustment flag set.)
        if (layer.adjustmentLayer === true) {
            return "adjustment";
        }
        if (layer.source !== null && layer.source !== undefined) {
            // Pre-comp: layer source is another composition.
            if (layer.source instanceof CompItem) {
                return "precomp";
            }
            if (layer.source instanceof FootageItem) {
                // Solid: footage item whose main source is a SolidSource.
                if (layer.source.mainSource instanceof SolidSource) {
                    return "solid";
                }
                // Real footage: FileSource (video, image sequence, still, audio).
                return "footage";
            }
        }
        // AVLayer without a resolvable source - treat as footage bucket.
        return "footage";
    }
    // Unknown layer class - fall back to the footage bucket.
    return "footage";
}

/**
 * Set a layer's selected state without fighting the UI's lock behavior:
 * locked layers cannot be selected in AE, so we temporarily unlock, toggle
 * selection, then restore the original lock state.
 * @param {Layer} layer
 * @param {Boolean} state - true to select, false to deselect
 */
function lsSetSelected(layer, state) {
    var wasLocked = layer.locked;
    try {
        if (wasLocked) {
            layer.locked = false;
        }
        layer.selected = state;
    } catch (e) {
        // Ignore individual layer failures (e.g. exotic layer types).
    }
    if (wasLocked) {
        try {
            layer.locked = true;
        } catch (e2) {
            // Ignore - restoring the lock is best-effort.
        }
    }
}

/**
 * Deselect every layer in the comp.
 * @param {CompItem} comp
 */
function lsDeselectAllLayers(comp) {
    var i;
    for (i = 1; i <= comp.numLayers; i++) {
        lsSetSelected(comp.layer(i), false);
    }
}

/**
 * Convert "#RRGGBB" / "RRGGBB" to an [r, g,b] array of 0..1 floats used by
 * TextDocument.fillColor.
 * @param {String} hex
 * @returns {Array|null} [r,g,b] or null when the string is not a hex color
 */
function lsHexToRgb(hex) {
    var s = String(hex);
    var r, g, b;
    if (s.charAt(0) === "#") {
        s = s.substring(1);
    }
    if (s.length !== 6) {
        return null;
    }
    r = parseInt(s.substring(0, 2), 16);
    g = parseInt(s.substring(2, 4), 16);
    b = parseInt(s.substring(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) {
        return null;
    }
    return [r / 255, g / 255, b / 255];
}

// ===========================================================================
// Public API - called from the CEP panel via CSInterface.evalScript()
// ===========================================================================

/**
 * getLayerCounts()
 * Scan the active composition and report the layer count per category,
 * plus how many layers (and TextLayers) are currently selected.
 * @returns {String} JSON:
 *   success: { ok:true, hasComp:true, compName, total, selected, selectedText,
 *              counts:{text:n, ...} }
 *   failure: { ok:false, hasComp:false, message }
 */
function getLayerCounts() {
    var comp, counts, i, total, type, selected, selectedText, err;
    try {
        comp = lsGetActiveComp();
        if (!comp) {
            return lsNoCompResponse();
        }
        counts = {
            text: 0,
            adjustment: 0,
            solid: 0,
            shape: 0,
            camera: 0,
            light: 0,
            "null": 0,
            footage: 0,
            precomp: 0
        };
        total = comp.numLayers;
        selected = 0;
        selectedText = 0;
        if (total === 0) {
            return lsFail("Composition has no layers.", {
                hasComp: true,
                empty: true,
                compName: comp.name,
                total: 0,
                selected: 0,
                selectedText: 0,
                counts: counts
            });
        }
        for (i = 1; i <= total; i++) {
            type = lsDetectLayerType(comp.layer(i));
            counts[type] = counts[type] + 1;
            if (comp.layer(i).selected) {
                selected++;
                if (type === "text") {
                    selectedText++;
                }
            }
        }
        return lsToJson({
            ok: true,
            hasComp: true,
            compName: comp.name,
            total: total,
            selected: selected,
            selectedText: selectedText,
            counts: counts
        });
    } catch (err) {
        return lsFail("Error reading layers: " + String(err));
    }
}

/**
 * selectLayersByType(type)
 * Deselect everything, then select ONLY layers of the given category in the
 * active composition. Nested pre-comps are NOT traversed - only the layers
 * visible in the active comp's own timeline are affected.
 * @param {String} type one of: text adjustment solid shape camera light null
 *                      footage precomp
 * @returns {String} JSON { ok, message, count }
 */
function selectLayersByType(type) {
    var comp, i, count, label, err;
    try {
        comp = lsGetActiveComp();
        if (!comp) {
            return lsNoCompResponse();
        }
        if (!lsIsValidType(type)) {
            return lsFail("Unknown layer type: " + String(type));
        }
        if (comp.numLayers === 0) {
            return lsOk("Composition has no layers", { count: 0 });
        }

        label = lsTypeLabel(type);
        app.beginUndoGroup("Layer Selector: Select " + label + " Layers");
        try {
            // Step 1: clear the current selection across the whole comp.
            lsDeselectAllLayers(comp);
            // Step 2: select only the matching layers, keep count.
            count = 0;
            for (i = 1; i <= comp.numLayers; i++) {
                if (lsDetectLayerType(comp.layer(i)) === type) {
                    lsSetSelected(comp.layer(i), true);
                    count++;
                }
            }
        } finally {
            app.endUndoGroup();
        }
        return lsOk(count + " layer(s) selected", { count: count });
    } catch (err) {
        return lsFail("Error selecting layers: " + String(err));
    }
}

/**
 * selectAll()
 * Select every layer in the active composition.
 * @returns {String} JSON { ok, message, count }
 */
function selectAll() {
    var comp, i, err;
    try {
        comp = lsGetActiveComp();
        if (!comp) {
            return lsNoCompResponse();
        }
        if (comp.numLayers === 0) {
            return lsOk("Composition has no layers", { count: 0 });
        }
        app.beginUndoGroup("Layer Selector: Select All Layers");
        try {
            for (i = 1; i <= comp.numLayers; i++) {
                lsSetSelected(comp.layer(i), true);
            }
        } finally {
            app.endUndoGroup();
        }
        return lsOk(comp.numLayers + " layer(s) selected", { count: comp.numLayers });
    } catch (err) {
        return lsFail("Error selecting layers: " + String(err));
    }
}

/**
 * deselectAll()
 * Clear the selection in the active composition.
 * @returns {String} JSON { ok, message }
 */
function deselectAll() {
    var comp, err;
    try {
        comp = lsGetActiveComp();
        if (!comp) {
            return lsNoCompResponse();
        }
        app.beginUndoGroup("Layer Selector: Deselect All Layers");
        try {
            lsDeselectAllLayers(comp);
        } finally {
            app.endUndoGroup();
        }
        return lsOk("All layers deselected", { count: 0 });
    } catch (err) {
        return lsFail("Error deselecting layers: " + String(err));
    }
}

/**
 * invertSelection()
 * Flip the selected state of every layer in the active composition:
 * selected -> deselected, deselected -> selected.
 * @returns {String} JSON { ok, message, count }
 */
function invertSelection() {
    var comp, i, layer, count, err;
    try {
        comp = lsGetActiveComp();
        if (!comp) {
            return lsNoCompResponse();
        }
        if (comp.numLayers === 0) {
            return lsOk("Composition has no layers", { count: 0 });
        }
        count = 0;
        app.beginUndoGroup("Layer Selector: Invert Layer Selection");
        try {
            for (i = 1; i <= comp.numLayers; i++) {
                layer = comp.layer(i);
                lsSetSelected(layer, !layer.selected);
                if (layer.selected) {
                    count++;
                }
            }
        } finally {
            app.endUndoGroup();
        }
        return lsOk(count + " layer(s) selected", { count: count });
    } catch (err) {
        return lsFail("Error inverting selection: " + String(err));
    }
}

/**
 * changeFontForSelected(fontName, fontSize, hexColor)
 * Batch-apply text styling to every SELECTED TextLayer. Parameters that are
 * empty / invalid are simply skipped, so you can change only the font, only
 * the size, only the color, or any combination.
 *
 * Uses the TextDocument object:
 *   - textProp.value returns a TextDocument snapshot of the layer's text style.
 *   - Mutate font / fontSize / fillColor / applyFill on that snapshot.
 *   - textProp.setValue(doc) writes it back (undoable inside our undo group).
 *
 * @param {String} fontName  font PostScript name (e.g. "ArialMT", "Arial").
 *                           Pass "" to keep each layer's current font.
 * @param {String} fontSize  font size in pixels (e.g. "48"). Pass "" to keep.
 * @param {String} hexColor  fill color "#RRGGBB". Pass "" to keep.
 * @returns {String} JSON { ok, message, count, failed }
 */
function changeFontForSelected(fontName, fontSize, hexColor) {
    var comp, sizeValue, rgb, hasFont, hasSize, hasColor;
    var i, layer, changed, skipped, textProp, doc, err;

    try {
        comp = lsGetActiveComp();
        if (!comp) {
            return lsNoCompResponse();
        }

        fontName = (fontName === null || fontName === undefined) ? "" : String(fontName);
        fontSize = (fontSize === null || fontSize === undefined) ? "" : String(fontSize);
        hexColor = (hexColor === null || hexColor === undefined) ? "" : String(hexColor);

        hasFont = fontName.replace(/^\s+|\s+$/g, "") !== "";
        sizeValue = parseFloat(fontSize);
        hasSize = !isNaN(sizeValue) && sizeValue > 0;
        rgb = lsHexToRgb(hexColor);
        hasColor = rgb !== null;

        if (!hasFont && !hasSize && !hasColor) {
            return lsFail("Nothing to apply. Provide a font name, a size and/or a fill color.");
        }

        changed = 0;
        skipped = 0;
        app.beginUndoGroup("Layer Selector: Change Text Style");
        try {
            for (i = 1; i <= comp.numLayers; i++) {
                layer = comp.layer(i);
                // Only selected TextLayers are affected - other selections ignored.
                if (layer.selected && (layer instanceof TextLayer)) {
                    try {
                        // MatchName access keeps this working in non-English AE.
                        textProp = layer.property("ADBE Text Properties")
                                     .property("ADBE Text Document");
                        doc = textProp.value; // TextDocument snapshot
                        if (hasFont) {
                            // Throws if the font is unknown to AE - caught below.
                            doc.font = fontName.replace(/^\s+|\s+$/g, "");
                        }
                        if (hasSize) {
                            doc.fontSize = sizeValue;
                        }
                        if (hasColor) {
                            doc.applyFill = true;
                            doc.fillColor = rgb;
                        }
                        textProp.setValue(doc);
                        changed++;
                    } catch (layerErr) {
                        // Typically "font not found" - keep going with the rest.
                        skipped++;
                    }
                }
            }
        } finally {
            app.endUndoGroup();
        }

        if (changed === 0) {
            return lsFail(
                skipped > 0
                    ? "Style could not be applied (unknown font?). Nothing was changed."
                    : "No text layers are selected. Select text layers first.",
                { count: 0, failed: skipped }
            );
        }
        return lsOk(
            "Updated " + changed + " text layer(s)" +
                (skipped > 0 ? (", " + skipped + " failed") : ""),
            { count: changed, failed: skipped }
        );
    } catch (err) {
        return lsFail("Error changing text style: " + String(err));
    }
}

/**
 * selectSingleLayer(index)
 * Deselect everything, then select only the layer at the given timeline
 * position (1-based, index 1 = topmost). Used by the panel's layer list.
 * @param {Number|String} index 1-based layer index in the active comp
 * @returns {String} JSON { ok, message, count, index, name }
 */
function selectSingleLayer(index) {
    var comp, layer, err;
    try {
        comp = lsGetActiveComp();
        if (!comp) {
            return lsNoCompResponse();
        }
        index = parseInt(index, 10);
        if (isNaN(index) || index < 1 || index > comp.numLayers) {
            return lsFail("Layer index out of range: " + String(index));
        }
        app.beginUndoGroup("Layer Selector: Select Layer");
        try {
            lsDeselectAllLayers(comp);
            layer = comp.layer(index);
            lsSetSelected(layer, true);
        } finally {
            app.endUndoGroup();
        }
        return lsOk("Layer \"" + layer.name + "\" selected", {
            count: 1,
            index: index,
            name: layer.name
        });
    } catch (err) {
        return lsFail("Error selecting layer: " + String(err));
    }
}

/**
 * getLayerNames(type)  [optional preview feature]
 * List the layers of a given category in the active composition.
 * Only top-level layers of the active comp are returned (index 1 = topmost).
 * @param {String} type one of the supported category keys
 * @returns {String} JSON { ok, type, count, layers:[{index, name, selected}] }
 */
function getLayerNames(type) {
    var comp, i, layers, err;
    try {
        comp = lsGetActiveComp();
        if (!comp) {
            return lsNoCompResponse();
        }
        if (!lsIsValidType(type)) {
            return lsFail("Unknown layer type: " + String(type));
        }
        layers = [];
        for (i = 1; i <= comp.numLayers; i++) {
            if (lsDetectLayerType(comp.layer(i)) === type) {
                layers.push({
                    index: i,
                    name: comp.layer(i).name,
                    selected: comp.layer(i).selected === true
                });
            }
        }
        return lsToJson({
            ok: true,
            type: type,
            count: layers.length,
            layers: layers
        });
    } catch (err) {
        return lsFail("Error listing layers: " + String(err));
    }
}
