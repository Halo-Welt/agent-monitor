# Product Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the browser panel feel like a precision instrument product surface (light, sharp, crisp motion, complete empty/connection states) and remove the unused VS Code extension.

**Architecture:** Keep the single-file panel (`assets/index.html` + local `gsap.min.js`) served by `scripts/server.mjs`. Preserve event normalization, Tree/Timeline/History logic, and SSE. Replace CSS tokens/chrome, upgrade product states, and tighten GSAP/CSS motion. Delete `extension/` and scrub docs.

**Tech Stack:** Vanilla HTML/CSS/JS, local GSAP 3, Node SSE server (unchanged).

**Spec:** `docs/superpowers/specs/2026-07-10-product-surface-design.md`

---

## File map

| File | Role |
|------|------|
| `assets/index.html` | Sole product UI — tokens, chrome, states, motion |
| `assets/gsap.min.js` | Vendored motion (already present) |
| `scripts/server.mjs` | Unchanged unless static asset serving needs a tweak |
| `extension/**` | **Delete** |
| `README.md` | Remove sidebar/VSIX section; keep install + panel docs |

---

### Task 1: Remove extension surface

**Files:**
- Delete: `extension/` (entire tree)
- Modify: `README.md` (remove “Optional: in-editor sidebar” section)
- Verify: `docs/multi-agent.md` has no extension links (already clean)

- [ ] **Step 1: Delete the extension directory**

```bash
rm -rf extension
```

- [ ] **Step 2: Remove README sidebar section**

Delete the block starting at `## Optional: in-editor sidebar` through the VSIX install paragraph (keep `## Data & privacy` that follows).

- [ ] **Step 3: Grep for stale references**

```bash
rg -n "extension/|vsix|webview|in-editor sidebar" README.md docs/ .cursor-plugin/ || true
```

Expected: no hits in docs/README (ignore anything under `.superpowers/` if present).

- [ ] **Step 4: Commit**

```bash
git add -A README.md
git add -u extension
git commit -m "$(cat <<'EOF'
chore: remove VS Code/Cursor sidebar extension

Product surface is browser-only; drop the unused webview package and docs.
EOF
)"
```

---

### Task 2: Precision-instrument visual tokens & chrome

**Files:**
- Modify: `assets/index.html` (`:root` through chrome CSS, header markup)

- [ ] **Step 1: Replace `:root` tokens for tighter instrument feel**

Update CSS variables toward:
- `--bg: #f5f6f8`
- `--panel: #ffffff`
- `--panel-2: #eef0f3`
- `--panel-3: #f7f8fa`
- `--border: #e2e5ea`
- `--fg: #111318`
- `--muted: #5c6570`
- `--faint: #8b939e`
- `--accent: #2563eb` (single sharp blue)
- `--radius: 8px`, `--radius-sm: 6px`
- Keep category colors; slightly desaturate if they overpower chrome
- Keep `--mono`; keep system sans (spec: no brand rename / no decorative display face)

- [ ] **Step 2: Tighten chrome CSS**

- Top bar: reduce padding; demote `.brand .sub` (smaller/fainter or hide by default on desktop too if noisy)
- `.seg button`: sharper active state (filled accent, no soft gray wash)
- `.pill`: readout style — tabular nums, quieter border
- `.node` / `.tlrow`: tighter padding (`6px 8px`), clearer `.sel` left bar
- `details.session` / `.turn`: hairline borders, less “card stack”
- Detail `.d-title`: uppercase instrument labels, tracking
- Avoid new pill clusters, glow, multi-shadow

- [ ] **Step 3: Quiet the always-on banner**

Change `.banner` to a compact one-line hint, or collapse behind a `<details class="hint">` so the list reads as the product, not a docs dump. Keep the same factual content available.

- [ ] **Step 4: Visual smoke check**

```bash
node scripts/server.mjs &
# open http://127.0.0.1:4517 — chrome should look sharper; no layout break
```

- [ ] **Step 5: Commit**

```bash
git add assets/index.html
git commit -m "$(cat <<'EOF'
style: apply precision-instrument visual tokens to panel

Tighten surfaces, chrome, and hierarchy so the browser panel reads as a
crafted product surface rather than a log tool shell.
EOF
)"
```

---

### Task 3: Product states (empty / connect / no-match)

**Files:**
- Modify: `assets/index.html` (CSS for `.empty-state`, JS in `render`, `setConn`, detail placeholder)

- [ ] **Step 1: Add empty-state markup helper + CSS**

```javascript
function emptyState(title, body, action){
  const wrap = elp("empty-state");
  const h = elp("empty-title", title);
  const p = elp("empty-body", body);
  wrap.append(h, p);
  if(action){
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "empty-action"; btn.textContent = action.label;
    btn.onclick = action.onClick;
    wrap.appendChild(btn);
  }
  return wrap;
}
```

CSS: centered, restrained; title in `--fg`, body in `--muted`; action as sharp text/button matching `.hbtn`.

- [ ] **Step 2: Wire list empty cases**

In `render()`:
- `sessions.size===0` and no active filters → “Waiting for activity” / “Run an agent with hooks installed — events stream in live.”
- `sessions.size===0` but filters/search active → “No matches” + button “Clear filters” that resets search, session, srcFilter, catFilter to defaults and re-renders
- History empty: same pattern with history-specific copy

- [ ] **Step 3: Connection readout**

```javascript
let everLive = false;
function setConn(live){
  const dot = $("dot"), conn = $("conn");
  if(live) everLive = true;
  dot.className = "dot " + (live ? "on" : "off");
  conn.textContent = live ? "live" : (everLive ? "offline" : "connecting");
}
```

- [ ] **Step 4: Detail placeholder**

Default detail copy: “Select an event to inspect.” (short). Keep rich render path unchanged.

- [ ] **Step 5: Commit**

```bash
git add assets/index.html
git commit -m "$(cat <<'EOF'
feat: add product empty and connection states to panel

Distinguish connecting/offline/no-data/no-match so the panel feels complete
when idle, not like a blank tool shell.
EOF
)"
```

---

### Task 4: Motion polish

**Files:**
- Modify: `assets/index.html` (existing `gsapOK` / `animateEntrance` / `flashList` / `setView` / `showDetail`)

- [ ] **Step 1: View switch**

In `setView`, keep instant segment active class; use short list fade (existing `flashList` at ~0.18–0.22s `power2.out`). Do not animate when `REDUCE`.

- [ ] **Step 2: Detail swap**

In `showDetail` / history replay detail writers, after filling `#detailBody`:

```javascript
function animateDetail(){
  if(!gsapOK()) return;
  window.gsap.fromTo($("detailBody"), { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.18, ease: "power2.out", clearProps: "transform,opacity" });
}
```

- [ ] **Step 3: Dropdown open**

When adding `.open` on dropdown, if `gsapOK()`, briefly `from` the `.dd-menu` with `autoAlpha` + `y: -4` (~0.14s).

- [ ] **Step 4: Live insert**

Keep `animateEntrance` but shorten to `duration: 0.2`, `y: 5`, `stagger: 0.012` so Follow mode stays calm.

- [ ] **Step 5: Verify reduced motion**

With OS reduce-motion on (or temporarily force `REDUCE = true`), panel must still function with zero GSAP calls.

- [ ] **Step 6: Commit**

```bash
git add assets/index.html
git commit -m "$(cat <<'EOF'
feat: tighten panel motion for view, detail, and live inserts

Keep transitions snappy and instrument-like; skip all motion when reduced
motion is preferred.
EOF
)"
```

---

### Task 5: End-to-end verification

- [ ] **Step 1: Start server and open panel**

```bash
node scripts/server.mjs
# http://127.0.0.1:4517
```

Check:
- [ ] Connecting → live / offline readout
- [ ] Empty state copy when no events
- [ ] Tree / Timeline / History switch feels intentional
- [ ] Select node → detail fades in
- [ ] Filters → no-match + clear
- [ ] Narrow width (~720px) still stacks list/detail
- [ ] `extension/` gone; README has no sidebar section

- [ ] **Step 2: Final commit only if verification left uncommitted fixes**

```bash
git status
# commit any leftover polish if needed
```

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| Precision-instrument visual | Task 2 |
| Tree/Timeline/History/Detail restyle | Task 2 |
| Motion moments | Task 4 |
| Product states | Task 3 |
| `prefers-reduced-motion` | Task 4 |
| Delete extension + README | Task 1 |
| No capture/SSE behavior change | All (preserve logic) |
| Responsive breakpoint | Task 2/5 |

## Out of plan (explicit)

- Marketplace publishing
- Shared panel package / code split (optional later)
- Dark theme
- New analytics features
