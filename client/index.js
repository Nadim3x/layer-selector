/**
 * Layer Selector - index.js
 * ---------------------------------------------------------------------------
 * CEP panel front-end (Chromium). Talks to the ExtendScript back-end
 * (host/host.jsx) through CSInterface.evalScript().
 *
 * Client-side code here may use modern ES6+ syntax - CEP panels run in
 * Chromium Embedded Framework, not ExtendScript.
 */
(function () {
    "use strict";

    // ------------------------------------------------------ CEP bridge
    const csInterface = new CSInterface();

    /**
     * Call an ExtendScript function on the host and resolve with its raw
     * string return value. Rejects when CEP reports an evalScript error.
     * @param {string} code - ExtendScript expression, e.g. 'selectAll()'
     * @returns {Promise<string>}
     */
    function evalScript(code) {
        return new Promise((resolve, reject) => {
            csInterface.evalScript(code, (result) => {
                if (result === "EvalScript error." || result === "EvalScript error") {
                    reject(new Error("Host script error while running: " + code));
                } else {
                    resolve(result);
                }
            });
        });
    }

    /**
     * Parse a host JSON response safely. Host functions always return JSON
     * strings, but we fall back to a plain-string wrapper so a malformed
     * response never throws inside the panel.
     * @param {string} raw
     * @returns {object} always an object with at least { ok, message }
     */
    function parseHostResponse(raw) {
        try {
            const obj = JSON.parse(raw);
            if (obj && typeof obj === "object") {
                return obj;
            }
        } catch (e) {
            // fall through to the plain-string wrapper below
        }
        return {
            ok: raw ? raw.indexOf("rror") === -1 : false,
            message: String(raw || "Empty response from host")
        };
    }

    /**
     * Escape a JS string as a single-quoted ExtendScript string literal.
     * Used for free-text parameters such as font names.
     * @param {string} str
     * @returns {string} e.g. "O'Neil" -> 'O\'Neil'
     */
    function jsxString(str) {
        return "'" + String(str).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
    }

    // ------------------------------------------------------ categories
    // Keys must match the type keys used in host.jsx.
    const CATEGORIES = [
        { key: "text",       label: "Text",       icon: "\u{1F524}" }, // 🔤
        { key: "adjustment", label: "Adjustment", icon: "\u{1F39B}\uFE0F" }, // 🎛️
        { key: "solid",      label: "Solid",      icon: "\u{1F7E9}" }, // 🟩
        { key: "shape",      label: "Shape",      icon: "\u{1F537}" }, // 🔷
        { key: "camera",     label: "Camera",     icon: "\u{1F3A5}" }, // 🎥
        { key: "light",      label: "Light",      icon: "\u{1F4A1}" }, // 💡
        { key: "null",       label: "Null",       icon: "\u2B55" },    // ⭕
        { key: "footage",    label: "Footage",    icon: "\u{1F3AC}" }, // 🎬
        { key: "precomp",    label: "Pre-comp",   icon: "\u{1F4E6}" }  // 📦
    ];

    // ------------------------------------------------------ DOM refs
    const grid = document.getElementById("category-grid");
    const compNameEl = document.getElementById("comp-name");
    const totalCountEl = document.getElementById("total-count");
    const statusEl = document.getElementById("status-bar");
    const refreshBtn = document.getElementById("refresh-btn");
    const selectAllBtn = document.getElementById("select-all-btn");
    const deselectAllBtn = document.getElementById("deselect-all-btn");
    const invertBtn = document.getElementById("invert-btn");
    const applyFontBtn = document.getElementById("apply-font-btn");
    const fontNameInput = document.getElementById("font-name");
    const fontSizeInput = document.getElementById("font-size");
    const colorEnableInput = document.getElementById("color-enable");
    const fontColorInput = document.getElementById("font-color");
    const previewDetails = document.getElementById("preview-details");
    const previewSummary = document.getElementById("preview-summary");
    const previewList = document.getElementById("preview-list");

    /** @type {Object<string, HTMLElement>} count badge per category key */
    const countBadges = {};

    /** Whether the host currently reports a usable active composition. */
    let hasComp = false;

    // ------------------------------------------------------ status bar
    let statusTimer = null;

    /**
     * Show a message in the status bar. Auto-clears back to "Ready" after
     * 3 seconds (each new message restarts the timer).
     * @param {string} message
     * @param {"ok"|"error"|"busy"|"info"} [kind]
     */
    function setStatus(message, kind) {
        statusEl.textContent = message;
        statusEl.className = "status-bar" + (kind ? " status-" + kind : "");
        if (statusTimer) {
            clearTimeout(statusTimer);
        }
        statusTimer = setTimeout(() => {
            statusEl.textContent = "Ready";
            statusEl.className = "status-bar";
        }, 3000);
    }

    // ------------------------------------------------------ debounce / re-entrancy
    // Rapid clicks are ignored while a host call is in flight (prevents race
    // conditions on the single-threaded ExtendScript engine), and refreshes are
    // debounced so focus storms don't spam evalScript.
    let busy = false;
    let refreshTimer = null;

    /**
     * Run an async panel action exclusively. If another action is still in
     * flight the click is ignored with a short notice.
     * @param {() => Promise<void>} fn
     */
    async function runExclusive(fn) {
        if (busy) {
            setStatus("Working\u2026 please wait", "busy");
            return;
        }
        busy = true;
        applyEnabledState();
        try {
            await fn();
        } catch (err) {
            setStatus("Error: " + err.message, "error");
        } finally {
            busy = false;
            applyEnabledState();
        }
    }

    /**
     * Debounced refresh of the layer counts.
     * @param {number} [delay] milliseconds
     */
    function scheduleRefresh(delay) {
        if (refreshTimer) {
            clearTimeout(refreshTimer);
        }
        refreshTimer = setTimeout(() => {
            refreshTimer = null;
            refreshCounts();
        }, typeof delay === "number" ? delay : 250);
    }

    // ------------------------------------------------------ UI construction

    /**
     * Build the category buttons once; counts are updated in place afterwards.
     */
    function buildCategoryButtons() {
        CATEGORIES.forEach((cat) => {
            const btn = document.createElement("button");
            btn.className = "category-btn";
            btn.dataset.type = cat.key;
            btn.title = "Select all " + cat.label + " layers in the active comp";

            const icon = document.createElement("span");
            icon.className = "cat-icon";
            icon.textContent = cat.icon;

            const label = document.createElement("span");
            label.className = "cat-label";
            label.textContent = cat.label;

            const badge = document.createElement("span");
            badge.className = "cat-count";
            badge.textContent = "\u2013"; // –
            countBadges[cat.key] = badge;

            btn.appendChild(icon);
            btn.appendChild(label);
            btn.appendChild(badge);

            btn.addEventListener("click", () => onCategoryClick(cat));
            grid.appendChild(btn);
        });
    }

    /**
     * Enable/disable controls from the current state:
     *   - action buttons need both: a host call not in flight AND a comp
     *   - the Refresh button only waits for in-flight calls (so the user can
     *     always re-scan after opening a composition)
     */
    function applyEnabledState() {
        const actionsOn = !busy && hasComp;
        grid.querySelectorAll("button").forEach((b) => {
            b.disabled = !actionsOn;
        });
        selectAllBtn.disabled = !actionsOn;
        deselectAllBtn.disabled = !actionsOn;
        invertBtn.disabled = !actionsOn;
        applyFontBtn.disabled = !actionsOn;
        refreshBtn.disabled = busy;
    }

    // ------------------------------------------------------ host actions

    /**
     * Re-fetch layer counts from the host and repaint the UI.
     * Does not touch the status bar (callers decide what to report).
     * @returns {Promise<{ok: boolean, message: string}>}
     */
    async function refreshCounts() {
        try {
            const raw = await evalScript("getLayerCounts()");
            const res = parseHostResponse(raw);

            if (!res.ok) {
                // No comp (or active item is not a comp).
                hasComp = false;
                compNameEl.textContent = res.message || "No active composition";
                compNameEl.classList.add("no-comp");
                totalCountEl.textContent = "Total layers: \u2013";
                CATEGORIES.forEach((cat) => {
                    countBadges[cat.key].textContent = "\u2013";
                });
                applyEnabledState();
                return { ok: false, message: res.message || "No active composition" };
            }

            hasComp = true;
            compNameEl.textContent = res.compName || "Untitled";
            compNameEl.classList.remove("no-comp");
            totalCountEl.textContent = "Total layers: " + res.total;
            CATEGORIES.forEach((cat) => {
                const n = res.counts && typeof res.counts[cat.key] === "number"
                    ? res.counts[cat.key]
                    : 0;
                countBadges[cat.key].textContent = String(n);
            });
            applyEnabledState();
            return { ok: true, message: "Composition re-scanned" };
        } catch (err) {
            hasComp = false;
            compNameEl.textContent = "Host connection error";
            compNameEl.classList.add("no-comp");
            applyEnabledState();
            return { ok: false, message: "Error: " + err.message };
        }
    }

    /**
     * Click handler for a category button: select only layers of that type,
     * then refresh counts and load a name preview for the selection.
     */
    function onCategoryClick(cat) {
        runExclusive(async () => {
            const raw = await evalScript("selectLayersByType(" + jsxString(cat.key) + ")");
            const res = parseHostResponse(raw);
            setStatus(res.message || (cat.label + " layers selected"), res.ok ? "ok" : "error");
            await refreshCounts();
            if (res.ok && res.count > 0) {
                await loadPreview(cat.key, cat.label);
            } else {
                clearPreview();
            }
        });
    }

    /**
     * Load layer names of `type` into the preview list (uses getLayerNames()).
     */
    async function loadPreview(type, label) {
        try {
            const raw = await evalScript("getLayerNames(" + jsxString(type) + ")");
            const res = parseHostResponse(raw);
            if (!res.ok || !Array.isArray(res.layers)) {
                clearPreview();
                return;
            }
            previewList.innerHTML = "";
            res.layers.forEach((item) => {
                const li = document.createElement("li");
                const idx = document.createElement("span");
                idx.className = "idx";
                idx.textContent = String(item.index) + ":";
                li.appendChild(idx);
                li.appendChild(document.createTextNode(item.name));
                previewList.appendChild(li);
            });
            previewSummary.textContent = label + " layers (" + res.layers.length + ")";
            previewDetails.open = true;
        } catch (err) {
            // Preview is optional - never break the panel over it.
            clearPreview();
        }
    }

    /**
     * Empty and collapse the preview list.
     */
    function clearPreview() {
        previewList.innerHTML = "";
        previewSummary.textContent = "Selected layers preview";
        previewDetails.open = false;
    }

    /**
     * Shared handler for Select All / Deselect All / Invert.
     */
    function onUtility(fnName, label) {
        runExclusive(async () => {
            const raw = await evalScript(fnName + "()");
            const res = parseHostResponse(raw);
            setStatus(res.message || label, res.ok ? "ok" : "error");
            await refreshCounts();
            clearPreview();
        });
    }

    /**
     * Batch font changer: validate the inputs and call changeFontForSelected().
     */
    function onApplyFont() {
        const fontName = fontNameInput.value.trim();
        const fontSize = fontSizeInput.value.trim();
        const useColor = colorEnableInput.checked;
        const hexColor = useColor ? fontColorInput.value : "";

        if (!fontName && !fontSize && !useColor) {
            setStatus("Enter a font, a size and/or enable the fill color", "error");
            return;
        }

        runExclusive(async () => {
            const code =
                "changeFontForSelected(" +
                jsxString(fontName) + ", " +
                jsxString(fontSize) + ", " +
                jsxString(hexColor) + ")";
            const raw = await evalScript(code);
            const res = parseHostResponse(raw);
            setStatus(res.message || "Text style applied", res.ok ? "ok" : "error");
            await refreshCounts();
        });
    }

    // ------------------------------------------------------ wire up events

    refreshBtn.addEventListener("click", () => {
        runExclusive(async () => {
            const r = await refreshCounts();
            clearPreview();
            setStatus(r.message, r.ok ? "ok" : "error");
        });
    });

    selectAllBtn.addEventListener("click", () => onUtility("selectAll", "All layers selected"));
    deselectAllBtn.addEventListener("click", () => onUtility("deselectAll", "All layers deselected"));
    invertBtn.addEventListener("click", () => onUtility("invertSelection", "Selection inverted"));
    applyFontBtn.addEventListener("click", onApplyFont);

    // Auto-refresh when the user returns focus to the panel / AE.
    window.addEventListener("focus", () => scheduleRefresh(150));
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
            scheduleRefresh(150);
        }
    });

    // ------------------------------------------------------ init
    buildCategoryButtons();
    applyEnabledState();
    refreshCounts();
})();
