# Design system notes

Tokens in `tokens.css` follow the v2 document §17.2. Components live in `components/`. Use tokens
and components rather than one-off styles (v2 §17.17).

## Contrast (WCAG 2.2 AA), checked 2026-10-14

| Pair | Ratio | Needed |
| --- | --- | --- |
| Text `#17212F` on background / surface | 15.4 / 16.2 | 4.5 |
| Secondary text `#64748B` on surface / background | 4.76 / 4.51 | 4.5 |
| White on primary button `#0F766E` | 5.47 | 4.5 |
| Accent links on surface / background | 5.47 / 5.19 | 4.5 |
| White on destructive button `#B91C1C`, danger text on surface | 6.47 | 4.5 |
| Active navigation `#134E4A` on `#CCFBF1` | 8.41 | 4.5 |
| Badge text on badge backgrounds (success, warning, danger, info, neutral) | 8.2–14.8 | 4.5 |
| Table header `--text-3 #475569` on `#F1F5F9` | 6.92 | 4.5 |
| Form control edge `--border-strong #7F8CA0` on surface / background / muted | 3.41 / 3.23 / 3.11 | 3 (non-text) |
| Focus ring `#0F766E` on surface | 5.47 | 3 (non-text) |

Two pairs failed the first check and were fixed: table headers used secondary text on the muted
header (4.34) and form fields used a 1.48 border.

## Rules the components follow

- Status is never colour alone: `Badge` and `Alert` always show an icon and words.
- Every input has a visible `<label>` linked by id; hints and errors are linked with
  `aria-describedby`; errors use `role="alert"`.
- Focus is always visible (3 px ring). Dialogs move focus inside, close on Escape and return focus
  to the opener.
- Buttons show a spinner and are disabled while working, so double clicks cannot submit twice.
- Layout uses logical properties (`inline-size`, `margin-inline-start`) so Urdu right-to-left works.
- Tables turn into labelled stacked rows under 640 px; the shell collapses the sidebar under 1024 px.
  Checked at 375 px in English and Urdu with no horizontal scrolling.
- Motion is short (160 ms) and switched off for people who prefer reduced motion.
- The voice field never saves by itself; dictated words go into the field for review.
