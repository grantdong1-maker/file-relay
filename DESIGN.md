---
name: file-relay
description: "Self-hosted file relay drawn as a shipping document — every upload is a line item on an air waybill."
colors:
  paper: "#ecefec"            # ledger ground, light
  paper-2: "#e2e6e2"          # secondary ground (banner)
  ink: "#21241f"              # typewriter ink / text / borders
  ink-soft: "#5f665e"         # secondary text, tinted from ink, never gray
  rule: "#b2b8b0"             # 1px line-item rules, scrollbar, meter ticks
  stamp-red: "#b3261e"        # the one accent: rubber-stamp red
  inspection-green: "#1f6b38" # clearance color: delivered
  red-tint: "rgba(179, 38, 30, 0.09)"
  green-tint: "rgba(31, 107, 56, 0.07)"
  paper-dark: "#191b1e"       # night-dock ground, dark
  paper-2-dark: "#212429"
  ink-dark: "#e6e2d6"
  ink-soft-dark: "#a09c8c"
  rule-dark: "#4a4d52"
  stamp-red-dark: "#e2574a"
  inspection-green-dark: "#57b579"
typography:
  display:
    fontFamily: "Oswald, 'Arial Narrow', sans-serif"
    fontSize: "clamp(30px, 5vw, 42px)"
    fontWeight: 600
    lineHeight: "0.95"
    letterSpacing: "0.045em"
    # uppercase, self-hosted woff2 in public/fonts/
  section-heading:
    fontFamily: "Oswald, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: "1"
    letterSpacing: "0.12em"
    # uppercase
  body:
    fontFamily: "'Courier Prime', ui-monospace, 'Courier New', monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "1.55"
    # all data and prose ride this face; tabular-nums on
  label:
    fontFamily: "Oswald, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.18em–0.22em"
    # uppercase; buttons use 12.5px / 0.09em
rounded:
  none: "0"                   # radius 0 on every element, invariant
spacing:
  sm: "10px"
  md: "14px"
  lg: "30px"
  section: "26px"             # manifest top margin / masthead vertical padding
components:
  button-primary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "9px 15px"
    # 1.5px solid ink border, Oswald 12.5px uppercase tracked; hover fills ink
  button-primary-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  button-disabled:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    # border-style: dashed
  stamp:
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.none}"
    padding: "4px 8px 3px"
    # 2px currentColor border, rotate(-3deg), Oswald 11px 0.14em uppercase
---

# Design System: file-relay

## Overview

**Creative North Star: "The Air Waybill"**

The page is a shipping document. Every file is a line item on a cargo manifest; every state is a rubber stamp applied to that line. The system refuses the category default of soft upload cards with rounded progress pills: progress is a squared ruler filling with ink, status is a slightly rotated bordered stamp, and the whole page reads like a printed form on a ledger.

One ground, two exposures: ledger paper `#ecefec` by day, night dock `#191b1e` by system preference or manual toggle (`:root[data-theme='dark']` in `public/style.css:26-48`; choice applied pre-paint from `localStorage['relay:theme']`, falling back to `prefers-color-scheme`). One accent (rubber-stamp red), one clearance color (inspection green). Form furniture is ink, not chrome: dotted underlines, 1px line rules, 3px masthead rules, corner ticks, a barcode rule of repeating ink bars.

**Key Characteristics:**
- Everything is squared — border-radius 0 is a world invariant, not a default.
- Stamps are the status UI: QUEUED / IN TRANSIT / HOLD / DELIVERED / REFUSED (STAMPS table, `public/app.js:55-61`).
- Depth is ink weight, never shadow: the page is flat everywhere.
- Two accepted gradient artifacts carry the world: the barcode rule and the greenbar ledger stripes. They are built from repeating ink bars, not color blends.

## Colors

A printed-form palette: ink and paper carry the page; one red stamps trouble and transit, one green clears delivery.

### Primary
- **Rubber-Stamp Red** (`#b3261e`, dark `#e2574a`): the single accent. IN TRANSIT and REFUSED stamps, drop-box dragover state, ink underlines on links, the text caret, text selection ground, and the filling ruler. Red means "in motion" as well as "refused" — it is the ink of action.

### Secondary
- **Inspection Green** (`#1f6b38`, dark `#57b579`): clearance only. DELIVERED stamps, completed ruler fill, and the greenbar ledger stripes behind line items.

### Neutral
- **Ledger Paper** (`#ecefec`): the light ground; night-dock ground `#191b1e` replaces it in dark.
- **Typewriter Ink** (`#21241f`, dark `#e6e2d6`): all text and all structural borders (1px line rules, 1.5px button borders, 3px masthead/section rules).
- **Faded Ink** (`#5f665e`, dark `#a09c8c`): secondary text — stamped from the ink hue, never gray.
- **Rule** (`#b2b8b0`, dark `#4a4d52`): hairline item separators, meter ticks, scrollbar thumb.
- **Paper-2** (`#e2e6e2`, dark `#212429`): the batch banner's slightly different stock.
- Tints: `rgba(179,38,30,.09)` red wash (failed stamp, dragover), `rgba(31,107,56,.07)` green wash (ledger stripes; dark-theme variants listed in frontmatter).

### Named Rules
**The One-Stamp Rule.** One red, one green, nothing else colored. Any new state color must be earned as stamp ink or clearance — no blues, ambers, or purples enter the manifest.
**The Tinted-Soft Rule.** Secondary text is ink lightened within its own hue (`--ink-soft` derives from `--ink`, `public/style.css:31`). Never reach for gray.

## Typography

**Display Font:** Oswald (self-hosted `public/fonts/oswald-500.woff2`, weights 500–600) — condensed stencil-caps lettering for the waybill masthead, section headings, buttons, and field labels. Always uppercase with tracking.
**Body Font:** Courier Prime (self-hosted 400/700 woff2) — typewriter mono for every line of data, prose, and fineprint. `font-variant-numeric: tabular-nums` keeps the manifest columns honest.
**Character:** A form printed on a typewriter. The stencil caps shout the document's title; the typewriter records the freight. Nothing on the page is set in anything else.

### Hierarchy
- **Display** (600, clamp(30px, 5vw, 42px), 0.95): `h1` masthead only — FILE RELAY / INBOUND MANIFEST; `.no` span takes stamp red.
- **Section heading** (600, 17px/1, 0.12em, uppercase): manifest section titles, sitting on a 3px top rule with 18px above / 2px below.
- **Body** (400, 14px/1.55, max 64ch for fineprint): all data rows, form values, prose.
- **Label** (500–600, 11–15px, 0.09em–0.22em, uppercase, Oswald): field labels, buttons, consign label, barcode number.
- **Stamps** (600, 11px/1, 0.14em, uppercase, Oswald): the status vocabulary.

### Named Rules
**The Measurable Freight Rule.** Typewriter mono is earned by this world — a manifest of measurable freight — and is the page's only body voice. A future surface outside the shipping-document world must justify mono before adopting it; do not carry it as costume.

## Layout

Single column, ~880px measure (`main`, `header.page`: max-width 880px, 20px gutters). Masthead: title block left, barcode rule + DAY/NIGHT toggle right, closed by a 3px ink rule. Form fields run as label-over-dotted-underline pairs in a wrapping flex row (30px gaps). The consignment box (2px dashed, corner ticks) opens `main`; the manifest section follows immediately.

Density is ledger-dense: line items are 5-column grids (`3.4em 1fr auto auto auto`, 14px column gap) with 13px/12px vertical padding and 1px `--rule` separators; the greenbar stripe pattern runs behind the whole items list (27px period). More space above section headings than below. At ≤560px the item grid collapses to 3 columns, item number and size hide, controls/links span full width, and the barcode is removed; the masthead aligns left.

## Elevation & Depth

No shadows, no blur, no layering — depth is expressed entirely in ink weight (1px hairlines → 1.5px button borders → 2px box borders → 3px masthead rules) and in tint washes for state. The system is flat by doctrine; a drop shadow on any element is off-world.

Motion is one authored moment: the stamp entrance (`@keyframes stamp`, `public/style.css:287-291`) slams in at rotate(-14deg) scale(2.1) and settles to the resting rotate(-3deg) via an exponential ease-out — the "freshly stamped" moment. The ruler fill transitions width at 0.25s ease-out. Both are disabled under `prefers-reduced-motion`.

### Named Rules
**The Freshly-Stamped Rule.** Inked-ness comes from the entrance animation, not from resting texture. Stamps rest crisp; see the recorded stamp decision in Do's and Don'ts.

## Shapes

Radius 0 everywhere. The form language is drawn, not filled: 2px dashed border + 3px corner ticks on the consignment box, 1px dotted underlines under field values and above fineprint, 1px solid item rules, 3px solid section/masthead rules. The HOLD stamp alone uses a 3px double border — a second-ring stamp on the same line. The barcode rule is a 168×30px block of `repeating-linear-gradient` ink bars (2px/3px/1px bar rhythm, `public/style.css:131-139`); the greenbar uses a 1px-per-27px green tick pattern.

## Components

### Buttons
- **Shape:** squared (0 radius), 1.5px solid ink border.
- **Primary:** transparent ground, ink text; Oswald 12.5px, 0.09em uppercase, 9×15px padding.
- **Hover / Focus:** ink fill — background `--ink`, text `--paper` (ink-fill hover). Active nudges down 1px. Focus-visible: 2px dashed red outline, 2px offset.
- **Disabled:** dashed border, soft ink, no fill.
- **Small variant:** 5×10px padding, 11px.

### Stamps (signature component)
- **Resting state:** crisp 2px currentColor border, rotate(-3deg), Oswald 11px 0.14em uppercase, 4px 8px 3px padding. Vocabulary and classes: QUEUED (`.queued`, soft ink) / IN TRANSIT (`.transit`, red) / HOLD (`.hold`, ink, 3px double border) / DELIVERED (`.green`, inspection green, entrance animation) / REFUSED (`.failed`, red, red-tint wash).
- **Entrance:** the DELIVERED stamp plays the one authored stamp moment; others rest.
- **Recorded decision (resting texture):** stamps rest as crisp 2px borders at −3° with **no** texture or misregistration pass. The entrance animation supplies the inked moment; print-accurate registration keeps small-size legibility on both grounds. Do not add texture later without revisiting this decision.

### Consignment box (drop area)
- 2px dashed ink border, four 3px corner ticks, centered Oswald label "AFFIX CONSIGNMENT HERE", FILES/FOLDER buttons inline. Dragover: border goes solid red, red-tint wash.

### Batch banner
- 1.5px ink border on paper-2 stock, 12×16px padding, flex row.
- **Recorded decision (vocabulary):** the sender page's banner carries a **DUPLICATE** stamp — air-waybill copy-class language (a duplicate copy accompanies the freight). The recipient page's banner carries **BUNDLE** — the release action. Both are intentional; they must never be "corrected" into each other.

### Fields
- Oswald tracked label above a dotted 1px ink underline; value in typewriter ink; long values `word-break: break-all`.

### Fineprint
- 64ch cap, dotted top rule, 12px soft ink, generous 40px top margin.

## Do's and Don'ts

### Do:
- **Do** keep every surface squared (radius 0) and bordered in ink; borders are the only "chrome."
- **Do** express state as stamps from the fixed five-word vocabulary, rotated slightly and never as clean badges or pills.
- **Do** fill controls with ink on hover and reserve red for action/transit, green for clearance.
- **Do** keep the barcode rule and greenbar stripes as repeating ink bars — these are the two accepted gradient artifacts of this world, not invitations to color-blend ornament.
- **Do** respect both theme grounds and the pre-paint theme script; sync the toggle label (Night/Day) on load.

### Don't:
- **Don't** add texture, misregistration, or noise to resting stamps — the resting-state decision above pins them crisp at −3°.
- **Don't** rename or merge the DUPLICATE stamp (sender banner, copy-class) with the BUNDLE stamp (recipient banner, release action).
- **Don't** introduce shadows, glass, rounded corners, or a third accent color; the system is flat ink on paper.
- **Don't** gray the secondary text; tint it from the ink.

## Raster Provenance

All rasters captured **2026-11-17**, in `.impeccable/review/` — which is gitignored, so these are local-only evidence; this file is the shipped record of what they show.

| File | Viewport | Theme | State shown |
|---|---|---|---|
| `desktop.png` | desktop | light | populated manifest: 3 DELIVERED, HOLD 41% with Resume, IN TRANSIT 94% with Hold |
| `desktop-dark.png` | desktop | dark | 4 DELIVERED, HOLD 47% with Resume, IN TRANSIT 93% with Hold |
| `mobile.png` | 390px | light | full page, 2 DELIVERED, HOLD 47% with Resume |
| `mobile-dark.png` | 390px | dark | same state as mobile.png |
| `list.png` | desktop | light | recipient page `/l/<batch>`: BUNDLE banner, 5 DELIVERED + 3 partial IN TRANSIT rows, curl-resume fineprint |
| `list-dark.png` | desktop | dark | recipient page, same state as list.png |

## Finish-Review History

- **Round 1 — recapture.** Verdict: rasters incomplete (missing light/mobile captures) plus three fix conditions. All rasters were captured; all conditions applied.
- **Round 2 — recapture.** Verdict: desktop rasters showed unstaged renderable states (wrong capture states, re-shot per the table above), and the theme-toggle label was not synced on load. Both resolved.
- **Round 3 — ship.** Two documentation conditions, both recorded in this file: the resting-stamp-texture decision (Do's and Don'ts / Stamps) and the DUPLICATE-vs-BUNDLE vocabulary decision (Batch banner).

**What the review caught** (functional defects found and fixed by the review process):
- Per-item Hold/Resume buttons never rendered, and the NUL-byte batch key broke inside `data-k` attributes (fixed by URL-encoding the key, `public/app.js:97-105`).
- The proactive password prompt wedged page load.
- The theme-toggle label did not sync with the applied theme on load.
- Recipient-page asset paths were relative, so `style.css`/`list.js` 404'd under `/l/<id>` (now root-absolute, `public/list.html:9,47`).
