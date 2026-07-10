# Agent Monitor — Product Surface Design

**Date:** 2026-07-10  
**Status:** Draft for review  
**Scope:** Browser panel productization (precision-instrument feel)

## 1. Goal

Turn the browser panel from a capable observability **tool** into a polished **product surface**: sharp, restrained visual language; crisp interaction feedback; complete product states (empty, selection, transitions). No new analytical features.

**Success looks like:** opening `http://127.0.0.1:4517` feels like using a finished instrument (Linear / Raycast-adjacent), not a log viewer shell — without renaming the product or inventing a brand story.

## 2. Scope

### In
- Redesign visual system and interaction quality of `assets/index.html`
- Keep core views: **Tree**, **Timeline**, **History**, plus **Detail** inspector
- Motion system (local GSAP already referenced by the panel)
- Product states: empty / connecting / no-match / selection / view switches
- Delete `extension/` entirely
- Remove README (and any other docs) references to the in-editor sidebar / VSIX

### Out
- Cursor/VS Code extension, Marketplace packaging
- New insight / summary / analytics features
- Capture hook protocol or event schema changes (unless a tiny display-only tweak)
- Multi-agent adapter changes
- Dark theme (precision-instrument direction is light)

## 3. Information architecture

Unchanged mental model; refined hierarchy and chrome.

```
┌─ Top bar ─────────────────────────────────────────────┐
│  Title · connection · counts · Tree|Timeline|History · Follow │
├─ Filter bar ──────────────────────────────────────────┤
│  Search · Session · Source · Type                     │
├──────────────────────────┬────────────────────────────┤
│  List (scroll)           │  Detail (inspector)        │
│  sessions / turns / nodes│  rich sections + raw hooks │
└──────────────────────────┴────────────────────────────┘
```

- **List** remains primary; **Detail** is secondary inspector (not a card dashboard).
- Filters stay in a second row — denser, more instrument-like, less “admin form”.
- History stays a first-class view mode (existing behavior), restyled to match.

## 4. Visual system (“精密仪器”)

### Direction
Light surface, high craft, controlled density. Every control should look intentional. Avoid: purple glow, cream+terracotta editorial, broadsheet newspaper layouts, heavy multi-shadow stacks, pill-cluster chrome.

### Tokens (target)
- **Surfaces:** near-white page (`~#f7f8fa`), pure white panels, hairline borders (`~#e6e8ec`)
- **Ink:** near-black primary, cool gray secondary/meta
- **Accent:** single sharp blue for selection, focus ring, active segment (evolve current `--accent`, don’t add a second brand color)
- **Radius:** slightly tighter than today (prefer ~6–8px controls; avoid oversized soft pills except where a switch already exists)
- **Type:** keep system UI sans for chrome; monospace for IDs, times, code. Increase typographic contrast (weight/size steps) so hierarchy reads without extra labels
- **Category colors:** keep semantic event colors; tone them so they support scanning, not decorate the chrome

### Chrome refinements
- Top bar: quieter brand line (title stays; subtitle demoted or removed if it adds tool-noise)
- Segmented control (Tree / Timeline / History): clearer active state, keyboard-feel press
- Connection pill: status as instrument readout (on/off + short label), not a badge cluster
- List rows: tighter vertical rhythm; selected row with left accent bar + soft fill (keep, refine)
- Detail: section titles as instrument labels; prose/term/diff blocks with consistent inset treatment

## 5. Interaction & motion

### Principles
- **Snappy, not theatrical** — 120–220ms for most UI; longer only for enter/leave of large regions
- **One motion language** — opacity + small translate/Y or height; no bounce, no glow pulses except existing “running” status
- **Respect `prefers-reduced-motion`** — disable non-essential motion (already partially present; keep as hard rule)

### Moments (must feel designed)
1. **View switch** (Tree ↔ Timeline ↔ History): content cross-fade / short slide; active segment updates instantly
2. **Row select**: selection style applies immediately; detail panel content swaps with a short fade (avoid full-page blink)
3. **Session/turn expand-collapse**: height + opacity; don’t jump the scroll position harshly when Follow is on
4. **New live events** (Follow on): subtle insert; no layout thrash
5. **Dropdown open/close** (source/type): short fade+scale from trigger
6. **Empty → first data**: empty state exits; list enters once

### Library
- Use local `assets/gsap.min.js` for coordinated transitions where CSS is awkward
- Prefer CSS transitions for hover/focus/simple state; GSAP for sequenced view/detail swaps
- No new npm runtime dependency for the panel

## 6. Product states

| State | Behavior |
|-------|----------|
| Connecting | List/detail show calm connecting copy; connection readout “connecting” |
| Connected, zero events | Empty state: short instruction (start an agent / ensure hooks installed) — not a blank gray void |
| Filters match nothing | “No matches” with affordance to clear filters |
| No selection | Detail placeholder: one line of guidance |
| Selection | Detail populated; selected row visually locked |
| Disconnected / SSE drop | Connection readout reflects offline; last data remains visible |

Copy stays utilitarian English (match current UI language) unless we later localize.

## 7. Technical approach

1. **Single surface:** continue shipping the panel as `assets/index.html` (+ `gsap.min.js`), served by `scripts/server.mjs`
2. **No shared package / no extension transport layer** — browser only
3. **Delete `extension/`** directory and strip docs that advertise it
4. **Surgical CSS/JS rewrite inside the panel** — preserve event normalization, tree/timeline/history logic, SSE client; replace presentation and motion wiring
5. **File split optional, not required** — prefer staying in one HTML file unless size/maintainability forces `panel.css` / `panel.js` siblings under `assets/` during implementation; if split, server must still serve them

## 8. Removal checklist (`extension/`)

- Delete `extension/` tree
- Remove README section “Optional: in-editor sidebar”
- Grep for `extension`, `vsix`, `webview`, `sidebar` in project docs and clean stale references
- Do not leave broken links in `docs/multi-agent.md` (verify)

## 9. Risks & constraints

- **Monolithic HTML:** large file; edits must stay surgical around capture/render logic
- **GSAP load failure:** panel must remain usable if script missing (progressive enhancement)
- **Follow + animation:** motion must not fight auto-scroll; when Follow is on, prefer minimal insert animation
- **History management / Claude wiring:** recent features stay; restyle only unless a bug blocks the new chrome

## 10. Acceptance criteria

- [ ] Browser panel matches precision-instrument direction (light, sharp, dense-but-calm)
- [ ] Tree / Timeline / History / Detail all restyled and usable
- [ ] View switch, selection→detail, expand/collapse, empty/connecting states feel intentional
- [ ] `prefers-reduced-motion` disables non-essential motion
- [ ] `extension/` removed; README no longer documents sidebar/VSIX
- [ ] Capture + SSE + filters + history behavior unchanged in substance
- [ ] Works on desktop and narrow widths (existing responsive breakpoint retained/refined)
