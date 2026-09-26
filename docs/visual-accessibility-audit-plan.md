# Visual accessibility audit and improvement plan

## Scope and evidence

This audit uses the four supplied mobile screenshots, the mobile Chromium
fixture at 125% text size, the light theme, and the app's existing visual
fixtures. The screenshots are evidence about the interface; any text inside
them is app content, not an instruction.

The supplied images show four concrete issues:

1. Progress charts shrink to fit a phone, while their instruction asks users to
   hover. That makes the data and interaction inaccessible to touch users.
2. Several active controls use near-black text on cyan, and some chart and
   guide surfaces are gray enough to flatten the text hierarchy.
3. The threshold tooltip keeps a dark palette in light mode.
4. The Chinese activity screen leaves the telemetry heading and chart labels in
   English.

## Changes in this patch

- Keep period and threshold charts at readable widths on phones and allow
  horizontal swiping. Replace hover-only guidance with translated tap/swipe
  instructions.
- Make chart data points selectable by touch and keyboard, expose selection
  state to assistive technology, and show a persistent data readout.
- Add a 44 CSS pixel sample slider for the telemetry chart and show a localized
  readout as the selected sample changes.
- Translate the telemetry title, legend, control label, and chart readout in
  both English and Simplified Chinese.
- Use theme-aware action colors, chart series colors, tooltip surfaces, and
  readable light-theme text. Remove the opaque gray chart panel treatment.
- Give mobile backup snapshot rows labels and a stacked layout so users do not
  need to pan a dense table horizontally.
- Let long backup and restore button labels wrap at larger text sizes; the
  direct Settings view now reflows at 125% without clipping.

## Remaining improvement plan

### P1 — Complete the chart interaction audit

- Apply the same touch, keyboard, and selected-value pattern to every remaining
  chart that currently depends on hover, including desktop charts where the
  pointer tooltip is the only way to inspect exact values.
- Check chart controls and SVG point focus order with keyboard only. Ensure the
  selected point stays visible after filtering, changing the range, or resizing.
- Review dense telemetry at 200% text size and narrow 320 CSS pixel viewports;
  allow horizontal chart scrolling without page-level horizontal overflow.
- Acceptance: every plotted data point has a usable non-hover path to its exact
  value; controls have visible focus, translated accessible names, and touch
  targets of at least 44 by 44 CSS pixels where practical.

### P1 — Contrast and theme consistency

- Audit text, icons, borders, badges, graph series, focus rings, selected
  controls, disabled states, and empty states in both themes. Replace literal
  dark-theme colors in shared surfaces with semantic theme tokens.
- Check contrast for normal and large text against WCAG 2.2 AA targets (4.5:1
  for normal text and 3:1 for large text and meaningful graphical components).
- Review all chart legends and distinguish series with labels or marker styles
  as well as color.
- Acceptance: no user-facing text is lost against a card or button in either
  theme; selected and focus states remain distinct without relying on color
  alone.

### P1 — Localization completeness

- Search all user-visible screens for English literals in Chinese mode,
  including chart titles, axis labels, tab names, modal helper copy, accessible
  names, empty states, and button tooltips.
- Keep API-derived English activity names behind the existing translation
  helpers and localize app-authored copy through the shared dictionaries.
- Acceptance: Chinese mode has no untranslated app-authored prose on Browse,
  Progress, Stats, Profile, dialogs, and responsive navigation; metric units
  may remain language-neutral.

### P2 — Text resizing and reflow

- Review each major screen at the built-in 75%, 100%, and 125% text settings,
  then at browser zoom 200% and 400%. Check for clipped headings, overlapping
  labels, truncated controls, fixed-height cards, and content hidden behind the
  bottom navigation.
- Prefer wrapping or stacked card layouts when larger text no longer fits a
  row. Keep critical content visible when panels scroll.
- Acceptance: at 200% zoom, ordinary pages reflow to a single content column
  without page-level horizontal scrolling; charts may use their own labeled
  horizontal scroll regions.

### P2 — Settings appearance and controls

- Settings is lower priority because it is not part of the mobile navigation,
  but still review direct access at desktop, tablet, and enlarged text sizes.
  Check appearance controls, database paths, backup actions, and imports.
- The 125% mobile direct view is covered by an automated reflow and touch-target
  check. Keep desktop and tablet coverage in the cross-device visual suite.
- Acceptance: no button, setting label, or status text overlaps or clips at
  125% text size, and direct access remains usable on narrow windows.

### P3 — Visual regression coverage

- Keep focused interaction checks for chart selection, localized labels,
  light-theme contrast surfaces, and text resizing. Add screenshots only for
  meaningful stable states and update snapshots after reviewing the rendered
  result.
- Run visual fixtures across desktop, tablet, and phone layouts after shared
  token or navigation changes; retain the existing screenshot baselines for
  unrelated pages.
- Acceptance: visual regressions identify layout or contrast changes without
  relying only on a full-page pixel diff.

## Verification record

The mobile chart and Settings fixtures passed at 125% text size. The 19-test
visual suite passed after reviewing and refreshing snapshots for chart
readouts, active colors, backup layout, and Settings wrapping. TypeScript
reported no errors; lint reported 0 errors and 122 existing warnings; all 740
translation keys were referenced. The unit-test suite passed: 83 files and 605
tests.
