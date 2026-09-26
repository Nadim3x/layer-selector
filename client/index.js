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

    // ------------------------------------------------------ SVG icon set
    // Outline style, 24x24 viewBox, stroke inherits currentColor.
    const stroke = 'fill="none" stroke="currentColor" stroke-width="1.8" ' +
                   "stroke-linecap=\"round\" stroke-linejoin=\"round\"";
    const svg = (inner) =>
        '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' + inner + "</svg>";

    const ICONS = {
        // app logo: three stacked rounded rectangles (outline, white)
        logo: `<svg viewBox="0 0 22 22" width="22" height="22" xmlns="http://www.w3.org/2000/svg">
            <rect x="5.2" y="4.6" width="11.6" height="3.4" rx="1.2" fill="none" stroke="#ffffff" stroke-width="1.4"/>
            <rect x="5.2" y="9.3" width="11.6" height="3.4" rx="1.2" fill="none" stroke="#ffffff" stroke-width="1.4"/>
            <rect x="5.2" y="14.0" width="11.6" height="3.4" rx="1.2" fill="none" stroke="#ffffff" stroke-width="1.4"/>
        </svg>`,
        moon: svg(`<path ${stroke} d="M20 14.2A8.3 8.3 0 0 1 9.8 4 7.8 7.8 0 1 0 20 14.2z"/>`),
        sun: svg(`<circle ${stroke} cx="12" cy="12" r="4"/>
            <path ${stroke} d="M12 2.8v2.1M12 19.1v2.1M21.2 12h-2.1M4.9 12H2.8M18.5 5.5l-1.5 1.5M7 17l-1.5 1.5M18.5 18.5L17 17M7 7L5.5 5.5"/>`),
        gear: svg(`<circle ${stroke} cx="12" cy="12" r="3"/>
            <path ${stroke} d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`),
        refresh: svg(`<polyline ${stroke} points="21 4 21 10 15 10"/>
            <path ${stroke} d="M18.4 15a8 8 0 1 1-1.7-8.7L21 10"/>`),
        // T-bar text icon for the Text Tools header
        textTool: svg(`<path ${stroke} d="M5 7h14M12 7v12"/>`),
        // ---- layer type icons ----
        text: svg(`<path ${stroke} d="M5 7h14M5 12h10M5 17h6"/>`),
        solid: svg(`<rect ${stroke} x="5.5" y="5.5" width="13" height="13" rx="3"/>`),
        camera: svg(`<circle ${stroke} cx="12" cy="9" r="3"/>
            <path ${stroke} d="M6 19c0-3.3 2.7-5.2 6-5.2s6 1.9 6 5.2"/>`),
        "null": svg(`<circle ${stroke} cx="12" cy="12" r="7"/>
            <circle cx="12" cy="12" r="1.7" fill="currentColor"/>`),
        precomp: svg(`<path ${stroke} d="M12 4l7 3.8v8.4L12 20l-7-3.8V7.8z"/>`),
        adjustment: svg(`<rect ${stroke} x="4.5" y="5.5" width="15" height="13.5" rx="2"/>
            <path ${stroke} d="M4.5 10h15M9 3.5v3M15 3.5v3"/>`),
        shape: svg(`<path ${stroke} d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>`),
        light: svg(`<circle ${stroke} cx="12" cy="12" r="3.6"/>
            <path ${stroke} d="M12 3.4v2.2M12 18.4v2.2M20.6 12h-2.2M5.6 12H3.4M18.1 5.9l-1.6 1.6M7.5 16.5l-1.6 1.6M18.1 18.1l-1.6-1.6M7.5 7.5L5.9 5.9"/>`),
        footage: svg(`<rect ${stroke} x="3.5" y="5.5" width="17" height="13" rx="2"/>
            <path ${stroke} d="M9.4 9.4l5.2 5.2M14.6 9.4l-5.2 5.2"/>`)
    };

    // ------------------------------------------------------ categories
    // Keys must match the type keys used in host.jsx. Grid order per design.
    const CATEGORIES = [
        { key: "text",       label: "Text",       tint: "t-text",       icon: ICONS.text },
        { key: "solid",      label: "Solid",      tint: "t-solid",      icon: ICONS.solid },
        { key: "camera",     label: "Camera",     tint: "t-camera",     icon: ICONS.camera },
        { key: "null",       label: "Null",       tint: "t-null",       icon: ICONS["null"] },
        { key: "precomp",    label: "Pre-comp",   tint: "t-precomp",    icon: ICONS.precomp },
        { key: "adjustment", label: "Adjustment", tint: "t-adjustment", icon: ICONS.adjustment },
        { key: "shape",      label: "Shape",      tint: "t-shape",      icon: ICONS.shape },
        { key: "light",      label: "Light",      tint: "t-light",      icon: ICONS.light },
        { key: "footage",    label: "Footage",    tint: "t-footage",    icon: ICONS.footage }
    ];
    const LABEL_BY_KEY = {};
    CATEGORIES.forEach((c) => { LABEL_BY_KEY[c.key] = c.label; });

    // ------------------------------------------------------ DOM refs
    const els = {
        themeBtn: document.getElementById("theme-btn"),
        settingsBtn: document.getElementById("settings-btn"),
        refreshBtn: document.getElementById("refresh-btn"),
        settingsPopover: document.getElementById("settings-popover"),
        autorefreshToggle: document.getElementById("autorefresh-toggle"),
        appIcon: document.getElementById("app-icon"),
        tIcon: document.getElementById("t-icon"),
        compCard: document.querySelector(".comp-card"),
        compName: document.getElementById("comp-name"),
        compSub: document.getElementById("comp-sub"),
        totalBadge: document.getElementById("total-badge"),
        grid: document.getElementById("category-grid"),
        selectAllBtn: document.getElementById("select-all-btn"),
        deselectAllBtn: document.getElementById("deselect-all-btn"),
        invertBtn: document.getElementById("invert-btn"),
        selectedTextBadge: document.getElementById("selected-text-badge"),
        fontName: document.getElementById("font-name"),
        fontSize: document.getElementById("font-size"),
        swatchWhite: document.getElementById("swatch-white"),
        fontColor: document.getElementById("font-color"),
        colorState: document.getElementById("color-state"),
        applyFontBtn: document.getElementById("apply-font-btn"),
        listTitle: document.getElementById("list-title"),
        listCount: document.getElementById("list-count"),
        layerList: document.getElementById("layer-list"),
        statusDot: document.getElementById("status-dot"),
        statusText: document.getElementById("status-text")
    };

    /** @type {Object<string, HTMLElement>} count badge per category key */
    const countBadges = {};
    /** @type {Object<string, HTMLElement>} button per category key */
    const catButtons = {};

    // ------------------------------------------------------ static icons
    els.appIcon.innerHTML = ICONS.logo;
    els.tIcon.innerHTML = ICONS.textTool;
    els.themeBtn.innerHTML = ICONS.moon;
    els.settingsBtn.innerHTML = ICONS.gear;
    els.refreshBtn.innerHTML = ICONS.refresh;

    // ------------------------------------------------------ theme
    const THEME_KEY = "layerselector.theme";

    function applyTheme(theme) {
        document.documentElement.setAttribute("data-theme", theme);
        els.themeBtn.innerHTML = theme === "dark" ? ICONS.moon : ICONS.sun;
        els.themeBtn.title = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
    }

    function toggleTheme() {
        const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        applyTheme(next);
        try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* storage unavailable */ }
    }

    try {
        const saved = localStorage.getItem(THEME_KEY);
        if (saved === "light" || saved === "dark") {
            applyTheme(saved);
        }
    } catch (e) { /* storage unavailable */ }

    // ------------------------------------------------------ status bar
    let statusTimer = null;
    /** Live context shown in the default status text. */
    let statusContext = { comp: null, total: null };

    /** Compose the resting status text: "Ready · comp · 185 layers". */
    function defaultStatusText() {
        if (statusContext.comp === null) {
            return "Ready \u00b7 no active composition";
        }
        return "Ready \u00b7 " + statusContext.comp + " \u00b7 " + statusContext.total + " layers";
    }

    function resetStatus() {
        statusTimer = null;
        els.statusText.textContent = defaultStatusText();
        els.statusDot.className = "status-dot";
    }

    /**
     * Show a message in the status bar. Auto-clears back to the default
     * context status after 3 seconds (each new message restarts the timer).
     * @param {string} message
     * @param {"ok"|"error"|"busy"} [kind]
     */
    function setStatus(message, kind) {
        els.statusText.textContent = message;
        els.statusDot.className = "status-dot" + (kind ? " " + kind : "");
        if (statusTimer) {
            clearTimeout(statusTimer);
        }
        statusTimer = setTimeout(resetStatus, 3000);
    }

    // ------------------------------------------------------ debounce / re-entrancy
    let busy = false;
    let refreshTimer = null;
    let autoRefreshOnFocus = true;

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
            btn.className = "category-btn " + cat.tint;
            btn.dataset.type = cat.key;
            btn.title = "Select all " + cat.label + " layers in the active comp";

            const box = document.createElement("span");
            box.className = "icon-box";
            box.innerHTML = cat.icon;

            const label = document.createElement("span");
            label.className = "cat-label";
            label.textContent = cat.label;

            const badge = document.createElement("span");
            badge.className = "cat-count";
            badge.textContent = "\u2013"; // –
            countBadges[cat.key] = badge;
            catButtons[cat.key] = btn;

            btn.appendChild(box);
            btn.appendChild(label);
            btn.appendChild(badge);

            btn.addEventListener("click", () => onCategoryClick(cat));
            els.grid.appendChild(btn);
        });
    }

    /**
     * Enable/disable controls from the current state:
     *   - action buttons need both: a host call not in flight AND a comp
     *   - the Refresh button only waits for in-flight calls
     */
    function applyEnabledState() {
        const actionsOn = !busy && hasComp && hasLayers;
        els.grid.querySelectorAll("button").forEach((b) => {
            b.disabled = !actionsOn;
        });
        els.selectAllBtn.disabled = !actionsOn;
        els.deselectAllBtn.disabled = !actionsOn;
        els.invertBtn.disabled = !actionsOn;
        els.applyFontBtn.disabled = !actionsOn;
        els.refreshBtn.disabled = busy;
    }

    // ------------------------------------------------------ host actions

    /** Whether the host currently reports a usable active composition. */
    let hasComp = false;
    /** Empty compositions are valid items, but have no actionable layers. */
    let hasLayers = false;
    /** Category key currently shown in the layer list. */
    let activeType = null;
    /** Fill-color choice for the batch font changer (null = keep). */
    let colorChoice = null;

    /**
     * Re-fetch layer counts from the host and repaint the UI.
     * Does not touch the status bar (callers decide what to report).
     * @param {boolean} [reloadList=true] refresh the current layer browser
     * @returns {Promise<{ok: boolean, message: string}>}
     */
    async function refreshCounts(reloadList) {
        if (reloadList === undefined) {
            reloadList = true;
        }
        try {
            const raw = await evalScript("getLayerCounts()");
            const res = parseHostResponse(raw);

            if (!res.ok) {
                const emptyComp = res.hasComp === true && res.empty === true;
                hasComp = emptyComp;
                hasLayers = false;
                statusContext = emptyComp
                    ? { comp: res.compName || "Untitled", total: 0 }
                    : { comp: null, total: null };
                els.compCard.classList.toggle("no-comp", !emptyComp);
                els.compName.textContent = emptyComp
                    ? (res.compName || "Untitled")
                    : (res.message || "No active composition");
                els.compSub.textContent = emptyComp
                    ? "Composition has no layers"
                    : "Open a composition to begin";
                els.totalBadge.textContent = emptyComp ? "0 layers" : "\u2013 layers";
                els.selectedTextBadge.textContent = emptyComp ? "0 selected" : "\u2013 selected";
                CATEGORIES.forEach((cat) => {
                    countBadges[cat.key].textContent = emptyComp ? "0" : "\u2013";
                });
                renderLayerList([], LABEL_BY_KEY[activeType || "text"] || "Text");
                applyEnabledState();
                if (!statusTimer) { resetStatus(); }
                return { ok: false, message: res.message || "No active composition" };
            }

            hasComp = true;
            hasLayers = Number(res.total) > 0;
            statusContext = { comp: res.compName || "Untitled", total: res.total };
            els.compCard.classList.remove("no-comp");
            els.compName.textContent = res.compName || "Untitled";
            els.compSub.textContent = "Active composition";
            els.totalBadge.textContent = res.total + " layers";
            els.selectedTextBadge.textContent =
                (typeof res.selectedText === "number" ? res.selectedText : 0) + " selected";
            CATEGORIES.forEach((cat) => {
                const n = res.counts && typeof res.counts[cat.key] === "number"
                    ? res.counts[cat.key]
                    : 0;
                countBadges[cat.key].textContent = String(n);
            });
            applyEnabledState();
            if (!statusTimer) { resetStatus(); }

            // Keep the list synced when AE focus returns or the active comp
            // changes. Text is the initial/default category.
            if (activeType === null) {
                setActiveType("text");
            }
            if (reloadList) {
                await loadLayerList(activeType);
            }
            return { ok: true, message: "Composition re-scanned" };
        } catch (err) {
            hasComp = false;
            hasLayers = false;
            statusContext = { comp: null, total: null };
            els.compCard.classList.add("no-comp");
            els.compName.textContent = "Host connection error";
            els.compSub.textContent = "Unable to reach After Effects";
            applyEnabledState();
            return { ok: false, message: "Error: " + err.message };
        }
    }

    /**
     * Visually mark one category button as the active type.
     */
    function setActiveType(key) {
        activeType = key;
        Object.keys(catButtons).forEach((k) => {
            catButtons[k].classList.toggle("active", k === key);
        });
    }

    /**
     * Load the layer list card with the layers of `type`.
     */
    async function loadLayerList(type) {
        const label = LABEL_BY_KEY[type] || type;
        els.listTitle.textContent = label + " Layers";
        try {
            const raw = await evalScript("getLayerNames(" + jsxString(type) + ")");
            const res = parseHostResponse(raw);
            if (!res.ok || !Array.isArray(res.layers)) {
                renderLayerList([], label);
                return;
            }
            renderLayerList(res.layers, label);
        } catch (err) {
            // The list is optional - never break the panel over it.
            renderLayerList([], label);
        }
    }

    /**
     * Render layer rows into the list card. Clicking a row selects that
     * single layer in the comp (row takes the active tint).
     */
    function renderLayerList(layers, label) {
        els.layerList.innerHTML = "";
        els.listCount.textContent = String(layers.length);
        if (layers.length === 0) {
            const empty = document.createElement("div");
            empty.className = "layer-empty";
            empty.textContent = "No " + label.toLowerCase() + " layers in this composition";
            els.layerList.appendChild(empty);
            return;
        }
        layers.forEach((item) => {
            const row = document.createElement("div");
            row.className = "layer-row" + (item.selected === true ? " active" : "");
            row.title = "Select only this layer";

            const num = document.createElement("span");
            num.className = "layer-num";
            num.textContent = String(item.index);

            const name = document.createElement("span");
            name.className = "layer-name";
            name.textContent = item.name;

            const tag = document.createElement("span");
            tag.className = "layer-tag";
            tag.textContent = label;

            row.appendChild(num);
            row.appendChild(name);
            row.appendChild(tag);

            row.addEventListener("click", () => onLayerRowClick(row, item));
            els.layerList.appendChild(row);
        });
    }

    /**
     * Click a layer row -> select that single layer in the comp.
     */
    function onLayerRowClick(row, item) {
        runExclusive(async () => {
            const raw = await evalScript("selectSingleLayer(" + item.index + ")");
            const res = parseHostResponse(raw);
            setStatus(res.message, res.ok ? "ok" : "error");
            if (res.ok) {
                els.layerList.querySelectorAll(".layer-row").forEach((r) => {
                    r.classList.remove("active");
                });
                row.classList.add("active");
            }
            // Selection changes do not change the layer names; keep the row
            // node so its selected tint remains visible.
            await refreshCounts(false);
        });
    }

    /**
     * Click handler for a category button: select only layers of that type,
     * refresh counts, and load the layer list for it.
     */
    function onCategoryClick(cat) {
        runExclusive(async () => {
            const raw = await evalScript("selectLayersByType(" + jsxString(cat.key) + ")");
            const res = parseHostResponse(raw);
            setStatus(res.message || (cat.label + " layers selected"), res.ok ? "ok" : "error");
            setActiveType(cat.key);
            await refreshCounts();
        });
    }

    /**
     * Shared handler for Select All / Deselect All / Invert.
     */
    function onUtility(fnName, label) {
        runExclusive(async () => {
            const raw = await evalScript(fnName + "()");
            const res = parseHostResponse(raw);
            setStatus(res.message || label, res.ok ? "ok" : "error");
            // refreshCounts reloads the list and repaints each row from the
            // host's current selected state.
            await refreshCounts();
        });
    }

    /**
     * Batch font changer: validate the inputs and call changeFontForSelected().
     * Blank fields (and a "keep" fill color) are left unchanged on the host.
     */
    function onApplyFont() {
        const fontName = els.fontName.value.trim();
        const fontSize = els.fontSize.value.trim();
        const hexColor = colorChoice || "";

        if (!fontName && !fontSize && !colorChoice) {
            setStatus("Enter a font, a size and/or pick a fill color", "error");
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

    /**
     * Fill-color swatch behaviour: click a swatch to apply that color,
     * click it again to go back to "keep".
     */
    function chooseColor(hex, swatchEl) {
        if (colorChoice === hex) {
            colorChoice = null;
        } else {
            colorChoice = hex;
        }
        els.swatchWhite.classList.toggle("selected", colorChoice === "#ffffff");
        els.fontColor.classList.toggle("selected",
            colorChoice !== null && colorChoice !== "#ffffff");
        els.colorState.textContent = colorChoice ? colorChoice : "keep";
    }

    // ------------------------------------------------------ wire up events

    els.themeBtn.addEventListener("click", toggleTheme);

    els.settingsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        els.settingsPopover.hidden = !els.settingsPopover.hidden;
    });
    document.addEventListener("click", (e) => {
        if (!els.settingsPopover.hidden &&
            !els.settingsPopover.contains(e.target) &&
            e.target !== els.settingsBtn) {
            els.settingsPopover.hidden = true;
        }
    });
    els.autorefreshToggle.addEventListener("change", () => {
        autoRefreshOnFocus = els.autorefreshToggle.checked;
    });

    els.refreshBtn.addEventListener("click", () => {
        runExclusive(async () => {
            const r = await refreshCounts();
            setStatus(r.message, r.ok ? "ok" : "error");
        });
    });

    els.selectAllBtn.addEventListener("click", () => onUtility("selectAll", "All layers selected"));
    els.deselectAllBtn.addEventListener("click", () => onUtility("deselectAll", "All layers deselected"));
    els.invertBtn.addEventListener("click", () => onUtility("invertSelection", "Selection inverted"));
    els.applyFontBtn.addEventListener("click", onApplyFont);

    els.swatchWhite.addEventListener("click", () => chooseColor("#ffffff", els.swatchWhite));
    els.fontColor.addEventListener("input", () => {
        colorChoice = els.fontColor.value;
        els.swatchWhite.classList.remove("selected");
        els.fontColor.classList.add("selected");
        els.colorState.textContent = colorChoice;
    });

    // Auto-refresh when the user returns focus to the panel / AE.
    window.addEventListener("focus", () => {
        if (autoRefreshOnFocus) {
            scheduleRefresh(150);
        }
    });
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && autoRefreshOnFocus) {
            scheduleRefresh(150);
        }
    });

    // ------------------------------------------------------ init
    buildCategoryButtons();
    applyEnabledState();
    resetStatus();
    refreshCounts();
})();
