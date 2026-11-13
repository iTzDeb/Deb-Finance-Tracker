# Deb Finance Tracker — DESIGN.md

> The design system for the two pages that matter: **My view** (`index.html`) and
> **Family view** (`mom.html`). A private, calm ledger for everyday Indian
> business-and-home money. The interface should feel like a well-kept account
> book: quiet surfaces, confident numbers, one honest accent.

Inspired by the structure of [awesome-design-md](https://github.com/sweetkey/awesome-design-md)
(Wise and Revolut finance references) and shaped with the
[taste skill](https://github.com/kesslerio/taste-skill) redesign audit.

---

## 1. Visual Theme & Atmosphere

**"Ledger paper."** Warm ivory paper instead of clinical white. Deep forest ink
instead of pure black. One emerald accent that appears only where the product
wants a decision: the active tab, the primary action, the brand mark, the
business result. Money in is a living green; money out is a brick red. Nothing
glows. Nothing floats on heavy shadows. Depth comes from hairline rules, warm
tinted paper, and generous rhythm.

- **Calm, not sleepy.** Clear hierarchy and strong numerals, but no shouting.
- **Editorial, not templated.** A serif wordmark and large page titles; a
  precise sans for controls and data.
- **One accent family.** Green carries brand + positive. Amber and red are
  semantic only. No purple, no neon, no gradient washes.
- **Touch first.** Every control is at least 44 px tall on a phone, and the
  bottom dock respects the safe area.

### Key characteristics
- Warm paper canvas (`#f5f2e9`) with a near-black forest ink (`#1b2621`).
- Emerald brand (`#14654c`) and a softer positive green (`#177a52`).
- Instrument Serif for the wordmark + page titles; Instrument Sans for every
  control, label, number and paragraph.
- Hairline warm borders; no drop-shadow stacks. One soft, tinted shadow for the
  bottom sheet and the floating dock only.
- Rounded but not bubbly: 10 / 14 / 18 px radii, pills only for chips.

## 2. Color

### Light
| Token | Value | Role |
| --- | --- | --- |
| `--bg` | `#f5f2e9` | page canvas (warm paper) |
| `--paper` | `#fffdf7` | cards, sheets, inputs |
| `--paper-2` | `#efece1` | inset / quiet fill |
| `--ink` | `#1b2621` | primary text |
| `--muted` | `#616c64` | secondary text, labels (4.89:1 on canvas) |
| `--line` | `#e0dccd` | hairlines, borders |
| `--brand` | `#14654c` | primary action, active tab, brand |
| `--brand-dark` | `#0c4737` | pressed / hover on brand |
| `--brand-soft` | `#e2ede5` | active pill background |
| `--green` | `#177a52` | money in, positive net |
| `--amber` | `#9a5d12` | needs attention, suggestions |
| `--red` | `#b23b32` | money out, destructive |

### Dark (`prefers-color-scheme: dark`)
| Token | Value |
| --- | --- |
| `--bg` | `#0e1512` |
| `--paper` | `#151f1a` |
| `--paper-2` | `#1b2821` |
| `--ink` | `#eef3ec` |
| `--muted` | `#a0b1a6` |
| `--line` | `#2a3830` |
| `--brand` | `#7fd0ac` |
| `--brand-dark` | `#b7e8d3` |
| `--brand-soft` | `#1c3028` |
| `--green` | `#6fd3a2` |
| `--amber` | `#e6b96b` |
| `--red` | `#f0978f` |

Rules
- Never use pure `#000` or `#fff` for large surfaces.
- Semantic colour is never decorative. Green = value gained. Red = value spent.
  Amber = a decision is waiting.
- Contrast: body text ≥ 4.5:1 on its surface. Muted text is allowed down to
  4.5:1 for 12 px+ labels, never for amounts.
- Dark mode uses the same hue family; do not swap in blue-greys.

## 3. Typography

### Families
- **Display / wordmark:** `Instrument Serif` (self-hosted; `fonts/instrument-serif-latin.woff2`).
- **UI / body / data:** `Instrument Sans` variable 400–700
  (`fonts/instrument-sans-latin.woff2`), with `system-ui` fallback.
- Both are SIL Open Font License and bundled locally — no third-party font CDN,
  works offline in the PWA.

### Scale
| Role | Family | Size | Weight | Line height | Tracking |
| --- | --- | --- | --- | --- | --- |
| Page title (h1) | Serif | clamp(30px, 5vw, 40px) | 400 | 1.02 | -0.015em |
| Hero amount | Sans | clamp(34px, 7vw, 46px) | 600 | 1.0 | -0.035em |
| Card amount | Sans | 20–22px | 600 | 1.1 | -0.025em |
| Section title | Sans | 15px | 650 | 1.3 | -0.01em |
| Body | Sans | 15.5px | 400 | 1.5 | 0 |
| Description / copy | Sans | 14.5px | 400 | 1.55 | 0 |
| Label / meta | Sans | 12px | 550 | 1.35 | 0.005em |
| Micro / pills | Sans | 10.5–11px | 650 | 1.2 | 0.02em |
| Numerals | Sans | inherit | 600 | 1.1 | -0.02em |

Rules
- All amounts and counts: `font-variant-numeric: tabular-nums`.
- Headlines use `text-wrap: balance`; paragraphs `text-wrap: pretty`.
- No all-caps labels, no letter-spaced eyebrows. Sentence case everywhere.
- Body line length ≤ 65 characters (`max-width: 46ch` for descriptions).
- Minimum readable size: 11px only for pill/meta labels; never for body.

## 4. Spacing & Layout

- Base unit **4 px**; rhythm **8 / 12 / 16 / 24 / 32 / 40**.
- Container: `min(100% - 36px, 1040px)`; desktop gutter grows, content never
  runs edge-to-edge above 1100 px.
- Page padding: 22 px phone, 32 px tablet, 40 px desktop; bottom padding clears
  the dock + safe area.
- Grid for structure; flex only for inline groups. Never percentage flex math.
- Mobile < 480 px: tighter gutters (14 px), amounts drop one step, action buttons
  go full-width where the row would crowd.
- Desktop ≥ 700 px: two-column grids where the content is genuinely paired;
  the bottom dock floats 14 px above the edge.

## 5. Shape & Elevation

- Radii: 8 px (inner chips/inputs), 12 px (rows, small cards), 16 px (cards),
  24 px top corners (bottom sheet), 999 px (pills).
- Borders are 1 px `--line`; on paper cards add an inset top highlight
  `inset 0 1px 0 rgba(255,255,255,.6)` in light mode only.
- Elevation:
  - L0 flat — default.
  - L1 hairline + 1 px tinted ring — hover on interactive cards.
  - L2 `0 18px 50px -24px rgba(15,40,28,.35)` — bottom sheet, floating dock.
- No stacked multi-shadow cards. No shadow on static list rows.

## 6. Components

### Top bar
Sticky, canvas background with `backdrop-filter: blur(14px)` and a hairline
divider. Brand mark 38 px rounded 11 px with the avatar; wordmark in Instrument
Serif 20 px; status line 12 px muted with a live dot when updated. Right side:
three 44 px icon buttons (import, refresh, settings), inline SVG at 1.7 stroke,
hover `--paper-2`, pressed scale .97.

### Bottom dock
Fixed, centered, max 420 px, `--paper` with blur + hairline + L2 shadow.
Three tabs, 44 px tall, icon over label, active tab `--brand-soft` with
`--brand` text; `aria-pressed` already drives the state. Safe-area aware.

### Pending view
- Page head: serif h1 + one-line description; a compact "n need review" count
  pill on the right (amber dot, tabular number).
- Overview strip: three paper cards; the first is tinted amber (decision
  waiting), numbers tabular; labels sentence case.
- Segmented filter + segmented view toggle: shared pill-in-track pattern.
- Day group: 14 px day heading (Today / Yesterday / weekday) with a count,
  followed by one paper "sheet" whose rows are divided by hairlines.
- Transaction row: 42 px tinted category icon (inline SVG), payee 15 px/650,
  account + note meta 12 px, amount right aligned tabular, direction micro-label,
  status pill + suggestion line with a low-key confidence word (not colour alone),
  then a two-button action row (primary confirm, ghost edit). Actions inset to align under the text, not under the icon.
- Empty state: 48 px circle icon, 17 px title, one line of copy, one action.
- Skeleton: two 120 px shimmer blocks matching the list shape, never a spinner.

### Month view
- Month navigation: two 44 px square buttons beside a serif month title.
- Hero: forest card (`--hero-bg #123f30` in light, `#173e2f` in dark) with a
  soft radial emerald highlight, 13 px label, 44 px amount, one line of context,
  then a hairline-separated foot with income and business spend. No gradient
  rainbow; one hue, one light source.
- Stat pair: Money received / Personal spending in paper cards.
- Spending panels: paper card, section title + total, then category rows
  (label left, amount right) with an 8 px track bar. Brand for business, amber
  for personal. Bars animate width via transform/opacity only.

### History view
- Totals: two paper cards (Sent / Received) with tabular amounts.
- Breakdown line and internal-transfer line: 12–13 px muted.
- Filter chips: horizontal scroll, pill, active brand fill. Hide scrollbar.
- Search: 44 px input with a leading magnifier (mask-image data URI).
- Month heading: sticky with canvas blur + hairline; day heading shows net.
- Row: 40 px tinted avatar with initials, payee, category + bucket tags,
  pending dot, right-aligned amount. Hover tint; entire row is a button.

### Bottom sheet
Scrim `rgba(10,22,17,.55)` + 2 px blur. Sheet: paper, 24 px top radius,
L2 shadow, 12 px grip, 23 px serif title, 14 px muted copy, labels above
inputs, 48 px inputs with brand focus ring, primary/ghost actions full width
on phones. Enter animation: translateY(20px)→0 + opacity, 200 ms ease-out.
Respects `prefers-reduced-motion`.

### Feedback
- Toast: ink surface, 13 px, pill radius, 12 px above the dock.
- Focus: 2 px brand ring with 3 px offset on every interactive element.
- Disabled: 42% opacity, no hover.
- Press: scale(.98) + 1 px translate on buttons; 90–140 ms.

## 7. Motion

- Durations: 90–140 ms for press/hover; 200–240 ms for sheet and view reveals.
- Easing: `cubic-bezier(.2,.7,.3,1)` for entrances; `ease-out` for exits.
- Animate only `transform` and `opacity`. Width changes for bars are allowed
  once on data load, with a 400 ms transform-based scaleX.
- One orchestrated reveal per page load: view content fades/translate 6 px.
  No scattered per-card animations.
- `prefers-reduced-motion: reduce` removes all of the above.

## 8. Accessibility

- Skip link remains first in DOM.
- Focus ring never removed.
- Every icon-only button has `aria-label`; decorative SVG is `aria-hidden`.
- Status updates use `role="status"` / `aria-live="polite"` (already present).
- Touch targets ≥ 44×44 px on phones.
- Colour is never the only carrier: amounts carry + / − and labels.
- Contrast checked for both schemes; muted text at 12 px+ only.

## 9. Content & voice

- Active voice, short lines: "Review each match before it is added."
- Numbers are human: ₹1,248.50, not ₹1248.5; no fake round totals in examples.
- Empty and error states say what happened and the one next action.
- Dates: Today / Yesterday / weekday, then day-month. Never raw ISO.

## 10. Do / Don't

**Do**
- Change one thing at a time and screenshot at 390 px before moving on.
- Keep DOM ids/classes used by JS — restyle, don't restructure.
- Prefer a hairline + spacing over a new card.
- Keep two type families: serif for human titles, sans for everything machine.

**Don't**
- Don't introduce purple, neon, glassmorphism everywhere, or rainbow gradients.
- Don't use emoji as UI icons; use the inline SVG set.
- Don't add shadows to static cards.
- Don't change API calls, storage keys, or the app's behaviour in a redesign pass.
- Don't use `100vh`; use `100dvh` for full-height blocks.
