# Layer Selector

A complete **Adobe CEP extension for After Effects** that selects layers by type in the
active composition — Text, Adjustment, Solid, Shape, Camera, Light, Null, Footage and
Pre-comp — with live per-type counts, one-click selection, and a bonus batch font changer
for text layers.

**Target host:** Adobe After Effects CC 2018 and newer (AEFT 15.0 – 99.9, CSXS 7.0+)
**Type:** CEP Panel (HTML/CSS/JS front-end + ExtendScript back-end)
**Name in the Window menu:** `Layer Selector`
**Bundle ID:** `com.nadim3x.layerselector`

---

## Features

- **Ready-to-install `.zxp`** — `dist/LayerSelector.zxp` is a signed, verified
  package. Install it directly (see [Quick install](#quick-install)) or rebuild
  it with `tools/make_zxp.py`.
- **Layer type detection** — categorizes every top-level layer in the active comp:
  Text, Adjustment, Solid, Shape, Camera, Light, Null, Footage and Pre-comp.
- **Live counts** — total layer count plus a count badge on every category button
  (e.g. `Text (12)`), refreshed on panel open, on focus, and after every action.
- **One-click selection** — each button deselects everything, then selects **only**
  layers of that type, with a status message like `12 layer(s) selected`.
- **Selection utilities** — Select All, Deselect All and Invert Selection.
- **Batch font changer** — change font family, font size and fill color on all
  selected text layers at once (blank/unchecked fields keep their current values).
- **Layer name preview** — after selecting by type, the panel lists the matching
  layer names and their timeline indices.
- **Safe** — every change is wrapped in `app.beginUndoGroup()/endUndoGroup()` (undo
  with Ctrl/Cmd+Z), all host responses are parsed in try/catch, rapid clicks are
  debounced, and locked layers keep their lock state.

---

## Repository layout (= the extension folder)

The repository root **is** the extension folder — ready to package as a `.zxp` as-is.

```
layer-selector/                     (this repo == the extension root)
├── CSXS/
│   └── manifest.xml                CEP manifest (host range, panel geometry, menu)
├── client/
│   ├── index.html                  Panel UI
│   ├── index.js                    Panel logic (ES6+, talks to host via CSInterface)
│   ├── style.css                   Dark theme (#2b2b2b / #ccc / #007acc)
│   └── CSInterface.js              Adobe's official CEP JS bridge (v11.0.0)
├── host/
│   └── host.jsx                    ExtendScript back-end (ES5, runs in AE)
├── icons/
│   ├── icon-normal.png             23x23 panel icon (normal)
│   ├── icon-hover.png              23x23 panel icon (hover)
│   └── icon-disabled.png           23x23 panel icon (disabled)
├── tools/
│   └── make_zxp.py                 Portable signed-.zxp builder + verifier
├── dist/
│   └── LayerSelector.zxp           Prebuilt signed package (the deliverable)
├── .debug                          CEP debug config (dev only, not for release)
└── README.md
```

Total extension size: **~100 KB** — far under the 1 MB budget.

---

## Quick install (prebuilt .zxp)

`dist/LayerSelector.zxp` is a complete signed package (signed with a
self-signed development certificate):

1. Enable **PlayerDebugMode** — see §1a below (one-time setup).
2. Install the package — drag `dist/LayerSelector.zxp` into
   [Anastasiy's Extension Manager](https://install.anastasiy.com) (choose
   *After Effects*), or run `ExManCmd /install LayerSelector.zxp` — see §3.
3. Launch After Effects → **Window ▸ Layer Selector**.

To rebuild the `.zxp` after making changes, see §2 (two options: the portable
Python builder, or Adobe's ZXPSignCmd).

---

## How the pieces talk to each other

```
┌─────────────────────────────┐         ┌──────────────────────────────┐
│  client/index.js  (Chromium)│         │  host/host.jsx  (ExtendScript│
│                             │         │   inside After Effects)      │
│  csInterface.evalScript ────┼────────▶│  getLayerCounts()            │
│  ("selectLayersByType(      │         │  selectLayersByType(type)    │
│    'text')")                │◀────────│  selectAll() / deselectAll() │
│  ◀── JSON string response ──┼─────────│  invertSelection()           │
│  JSON.parse in try/catch    │         │  changeFontForSelected(...)  │
└─────────────────────────────┘         │  getLayerNames(type)         │
     ▲                                  └──────────────────────────────┘
     │  CSInterface.js (v11.0.0, Adobe)  ◀── loaded via <ScriptPath> in manifest
     └── official CEP bridge
```

The manifest (`CSXS/manifest.xml`) points `MainPath` at `client/index.html` and
`ScriptPath` at `host/host.jsx`, which CEP auto-loads into AE's scripting engine.

---

## 1. Testing the unpacked extension

### 1a. Enable PlayerDebugMode (required for unsigned/self-signed extensions)

CEP only loads extensions that are not signed by an Adobe-issued certificate when
**PlayerDebugMode = 1**. Set it for every CSXS version you have installed
(7 → 11 covers CC 2018 and newer; add `CSXS.12` etc. if your system has them):

**Windows** — Command Prompt (run once per CSXS version):

```bat
reg add HKCU\Software\Adobe\CSXS.7  /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add HKCU\Software\Adobe\CSXS.8  /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add HKCU\Software\Adobe\CSXS.9  /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add HKCU\Software\Adobe\CSXS.10 /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add HKCU\Software\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f
```

(Or use `regedit`: `HKEY_CURRENT_USER\Software\Adobe\CSXS.<N>`, create a String value
`PlayerDebugMode` = `1`.)

**macOS** — Terminal (run once per CSXS version):

```bash
defaults write com.adobe.CSXS.7  PlayerDebugMode 1
defaults write com.adobe.CSXS.8  PlayerDebugMode 1
defaults write com.adobe.CSXS.9  PlayerDebugMode 1
defaults write com.adobe.CSXS.10 PlayerDebugMode 1
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
killall cfprefsd   # restart the preferences daemon so the change is picked up
```

### 1b. Copy the unpacked extension into a CEP extensions folder

Copy the whole project folder and rename it to the bundle id
(`com.nadim3x.layerselector`) in one of these locations (create it if missing):

| Scope  | Windows | macOS |
|--------|---------|-------|
| Current user (recommended for dev) | `%APPDATA%\Adobe\CEP\extensions\` | `~/Library/Application Support/Adobe/CEP/extensions/` |
| All users | `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\` | `/Library/Application Support/Adobe/CEP/extensions/` |

The folder must contain `CSXS/manifest.xml` **directly** inside it:

```
…/CEP/extensions/com.nadim3x.layerselector/CSXS/manifest.xml
```

> **Windows tip:** the hidden `AppData\Roaming` folder — paste
> `%APPDATA%\Adobe\CEP\extensions\` into the Explorer address bar.

### 1c. Launch After Effects

The panel appears under **Window ▸ Layer Selector**. Click it, click into a
composition, and the counts appear. Press the ⟳ button at any time to re-scan.

### 1d. Debugging the panel (optional)

The included `.debug` file opens Chromium remote debugging on **port 8092** for AE:

1. Make sure PlayerDebugMode is on and the panel is loaded.
2. In Google Chrome open `chrome://inspect`, click **Configure…** and add
   `localhost:8092`.
3. The panel shows up under *Remote Target* → **inspect** to open DevTools.
4. To reload the panel UI after editing `client/*` files, close and reopen the
   panel (or restart After Effects after changing `host/host.jsx`).

`.debug` is a development-only file; it is **not** part of a release package.

---

## 2. Packaging a signed `.zxp`

Two options: **(A)** the portable Python builder included in this repo
(works on Linux/macOS/Windows/CI, no Adobe tooling needed), or **(B)** Adobe's
official ZXPSignCmd.

### 2A. Portable builder — `tools/make_zxp.py`

This is how the shipped `dist/LayerSelector.zxp` was produced. It reimplements
the ZXPSignCmd packaging format exactly (UCF container, `mimetype`,
`META-INF/signatures.xml` with per-file SHA-256 digests and an RSA-SHA1
XMLDSig signature), verified byte-for-byte against packages signed by Adobe's
own tool. Requires only Python 3 and the `openssl` CLI:

```bash
# create a self-signed dev certificate (only once; NOT committed to git):
python3 tools/make_zxp.py --make-cert --password mySecretPassword

# build + self-verify dist/LayerSelector.zxp:
python3 tools/make_zxp.py --password mySecretPassword

# re-check an existing package's digests and signature at any time:
python3 tools/make_zxp.py --verify dist/LayerSelector.zxp
```

The certificate is written to `dist/devcert.p12` (git-ignored — never commit
private keys). The first build creates the certificate automatically if it's
missing. Want an Adobe-style build instead? Use option B.

### 2B. Get ZXPSignCmd

Adobe's official command-line packager lives in the
[Adobe-CEP/CEP-Resources](https://github.com/Adobe-CEP/CEP-Resources/tree/master/ZXPSignCMD)
repository:

- Windows 64-bit: `ZXPSignCMD/4.1.3/x64/ZXPSignCmd.exe`
- Windows 32-bit: `ZXPSignCMD/4.1.3/Win32/ZXPSignCmd.exe`
- macOS: `ZXPSignCMD/4.1.3/macOS/ZXPSignCmd`
  (macOS 14 Sonoma may block the unsigned binary — see the `Readme.md` next to it,
  or run `xattr -d com.apple.quarantine ZXPSignCmd`)

### Create a self-signed certificate (development)

```bash
ZXPSignCmd -selfSignedCert <CountryCode> <State> <Organization> <CommonName> <Password> cert.p12
```

Example:

```bash
ZXPSignCmd -selfSignedCert US NY MyStudio "Layer Selector" mySecretPassword cert.p12
```

### Build the `.zxp`

Stage a clean copy of the extension folder named after the bundle id (no `.git`,
no `.debug`), then sign it:

```bash
# from the parent folder that contains com.nadim3x.layerselector/
ZXPSignCmd -sign com.nadim3x.layerselector LayerSelector.zxp cert.p12 mySecretPassword -tsa http://timestamp.digicert.com
```

- The **input directory must be the extension folder itself** so the `.zxp`
  contains `CSXS/manifest.xml` at its root.
- `-tsa <url>` timestamps the signature (recommended; the signature then stays
  valid after the certificate expires). Alternatives:
  `http://timestamp.comodoca.com/rfc3161`, `http://time.certum.pl/`.
- Dot-files (`.debug`, `.git`) are skipped by ZXPSignCmd, but delete them from
  the staging copy anyway to be safe.

Verify the package:

```bash
ZXPSignCmd -verify LayerSelector.zxp -certinfo
```

> **Distribution note:** a self-signed package only *loads* on machines with
> PlayerDebugMode enabled. For end users you either tell them to enable
> PlayerDebugMode (common for free tools) or sign with a certificate issued by
> Adobe (via the Adobe Developer Console) — required for the Adobe Exchange
> marketplace.

---

## 3. Installing the `.zxp`

**Option A — Anastasiy's Extension Manager (easiest, Windows & macOS):**
download from [install.anastasiy.com](https://install.anastasiy.com), open it,
choose **After Effects**, and drag `LayerSelector.zxp` onto the window (or use
*File ▸ Install*). Works for all modern AE versions including 2023–2025.

**Option B — Adobe ExManCmd (command line):**
download *ExManCmd* from the Adobe CEP/Extension Manager tools, then:

```bat
:: Windows
ExManCmd.exe /install LayerSelector.zxp
```

```bash
# macOS
./ExManCmd --install LayerSelector.zxp
```

To uninstall: `ExManCmd /remove LayerSelector.zxp` (or delete the folder from the
CEP `extensions` directory used above).

---

## 4. About `CSInterface.js`

`client/CSInterface.js` is **Adobe's official CEP JavaScript bridge**, version
**11.0.0**, copied unmodified from the Adobe-maintained repository:

- Source: [Adobe-CEP/CEP-Resources](https://github.com/Adobe-CEP/CEP-Resources) →
  `CEP_11.x/CSInterface.js`
- License: Adobe's own notice at the top of the file — you may use, modify and
  distribute it with your extension.
- **Which version to use:** use the `CEP_11.x` copy (v11.0.0) for CC 2018 and
  newer. It is the current official version and gracefully handles older CEP
  runtimes (8/9/10), so one file covers every supported AE release. Don't mix
  versions — if you update, replace the whole file.
- To update: download the newer `CSInterface.js` and overwrite
  `client/CSInterface.js`. Nothing else in this project needs to change.

---

## 5. Host API reference (`host/host.jsx`)

Every function returns a **JSON string**. All layer changes are undoable.

| Function | Purpose | Success payload |
|---|---|---|
| `getLayerCounts()` | Scan active comp | `{ok, hasComp, compName, total, counts:{text, adjustment, solid, shape, camera, light, null, footage, precomp}}` |
| `selectLayersByType(type)` | Deselect all, select only `type` | `{ok, message:"12 layer(s) selected", count}` |
| `selectAll()` | Select every layer | `{ok, message, count}` |
| `deselectAll()` | Clear selection | `{ok, message, count:0}` |
| `invertSelection()` | Flip every layer's selected state | `{ok, message, count}` |
| `changeFontForSelected(fontName, fontSize, hexColor)` | Batch style selected **Text** layers; pass `""` to keep any value | `{ok, message, count, failed}` |
| `getLayerNames(type)` *(optional preview)* | List matching layers | `{ok, type, count, layers:[{index, name}]}` |

Failure payload: `{ok:false, message:"…"}` with a human-readable reason
(`No active composition…`, `Active item is not a composition…`,
`Composition has no layers`, `Unknown layer type: …`, …).

### Detection rules

| Category | Rule (AE object model) |
|---|---|
| Text | `layer instanceof TextLayer` |
| Shape | `layer instanceof ShapeLayer` |
| Camera | `layer instanceof CameraLayer` |
| Light | `layer instanceof LightLayer` |
| Null | `AVLayer` with `nullLayer === true` |
| Adjustment | `AVLayer` with `adjustmentLayer === true` |
| Pre-comp | `AVLayer` whose `source` is a `CompItem` |
| Solid | `AVLayer` whose `source.mainSource` is a `SolidSource` |
| Footage | any other `AVLayer` (video, image, image sequence, audio) |

---

## 6. Known limitations

- **Top-level layers only** — the panel operates on the layers of the *active*
  composition's own timeline. Contents of nested pre-comps are not scanned or
  selected unless the user opens that comp (then it becomes the active comp).
- **Font names, not a font picker** — ExtendScript cannot enumerate system fonts.
  Type the exact font name (PostScript name such as `ArialMT`,
  `Helvetica-Bold`); a small suggestion list is offered. An unknown name makes
  the affected layers report as *failed* without changing anything.
- **Whole-layer text styling** — `TextDocument` changes apply to the entire text
  layer. Layers with mixed per-character styling become uniform (font/size/fill
  only; animators, tracking, stroke, etc. are untouched).
- **Locked layers** — AE cannot select locked layers, so they are briefly
  unlocked while selection runs and re-locked immediately afterwards (their
  lock state is preserved).
- **Category buckets** — audio-only layers count as *Footage*; anything the
  model doesn't recognize also falls into *Footage*. Camera/Light are matched by
  class, so light *types* (spot/point/parallel/ambient) are not distinguished.
- **Auto-refresh triggers** — counts refresh on panel open, on window focus,
  after every panel action, and via the ⟳ button. If you restructure the comp in
  AE while the panel keeps focus, click ⟳ to re-scan.
- **Requires AE CC 2018+** (host range `[15.0,99.9]` in the manifest).
- **Self-signed `.zxp`s need PlayerDebugMode** on the target machine (see §2).

---

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| Panel missing from the *Window* menu | Enable PlayerDebugMode (§1a); check the folder path/name (§1b) — `CSXS/manifest.xml` must be directly inside `com.nadim3x.layerselector/`; restart AE. |
| Panel opens but says "Host connection error" / `EvalScript error.` | `host/host.jsx` failed to load — confirm the folder layout matches this repo exactly (the manifest references `./host/host.jsx`). |
| Counts say "No active composition" | Click into a composition timeline (the Project panel or Footage viewer must not be the active item), then press ⟳. |
| "No text layers are selected" | Select at least one Text layer first (use the `Text` button!), then apply. |
| Font didn't change, "… failed" | The font name is unknown to AE — use the exact PostScript name (e.g. `ArialMT`, not `Arial Regular`). |
| Everything is broken after an edit | `node --check` equivalent sanity: keep `host/host.jsx` ES5 (no `let`/`const`/arrows), keep JSON responses — the client parses them in try/catch, but syntax errors in the JSX abort the whole script. |
| ZXP won't install | Rebuild with ZXPSignCmd 4.1.3, verify with `ZXPSignCmd -verify`, and install with Anastasiy's manager or ExManCmd (double-clicking a `.zxp` does nothing on modern systems). |

---

## 8. AE ↔ CEP compatibility matrix

| After Effects | Version | CEP / CSXS runtime | PlayerDebugMode key |
|---|---|---|---|
| CC 2018 | 15.x | CEP 8 / CSXS 8 | `CSXS.8` |
| CC 2019 | 16.x | CEP 9 / CSXS 9 | `CSXS.9` |
| CC 2020 | 17.x | CEP 10 / CSXS 10 | `CSXS.10` |
| CC 2021 – 2025 | 18.x – 25.x | CEP 11 / CSXS 11 | `CSXS.11` |

The manifest declares `RequiredRuntime CSXS 7.0` and host range `[15.0,99.9]`,
so the panel loads on every release above.

---

## 9. Extending the panel (developer notes)

- **Add a category:** add its key to `CATEGORIES` in `client/index.js`, the
  labels map + validity check + counts object in `host/host.jsx`, and the
  detection branch in `lsDetectLayerType()`. That's it — buttons, badges and
  selection wiring are generated from `CATEGORIES`.
- **Host responses** are always JSON strings built with the internal
  `lsToJson()` serializer (ExtendScript has no reliable `JSON` object).
- **Property access** uses match names (`ADBE Text Document` …) so the panel
  works in non-English versions of After Effects.
- Keep `host/host.jsx` strictly **ES5**; `client/*` may use modern JS (Chromium).
