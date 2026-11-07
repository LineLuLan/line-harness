# Taste Preflight

Run this gate before delivering a landing page, portfolio, editorial page, or redesign. Fix every failed item or report the unresolved constraint.

## Direction

- [ ] State the design read: page kind, audience, vibe, and foundation.
- [ ] Set explicit `DESIGN_VARIANCE`, `MOTION_INTENSITY`, and `VISUAL_DENSITY` values from the brief.
- [ ] Choose one official design system or label the aesthetic honestly.
- [ ] Detect greenfield, preserve, or overhaul mode and complete the redesign audit when applicable.
- [ ] Keep the work inside the intended surface. Route dense product UI to its domain system.

## Theme And Tokens

- [ ] Use one page-level theme without accidental light-dark section inversion.
- [ ] Use one accent color and one consistent neutral temperature.
- [ ] Apply one documented corner-radius system.
- [ ] Use semantic tokens instead of ad hoc color values in components.
- [ ] Test every supported theme independently.

## Typography And Copy

- [ ] Use a coherent type scale and no unjustified default font choices.
- [ ] Justify serif use from the brand or editorial context.
- [ ] Give italic descenders enough line-height and bottom clearance.
- [ ] Re-read every visible string for grammar, clarity, voice, and factual support.
- [ ] Remove em dash and en dash characters from visible page copy.
- [ ] Keep quotes concise and provide complete attribution.
- [ ] Remove fake-precise data or label it clearly as sample content.

## Hero And Navigation

- [ ] Fit headline, supporting copy, and CTA in the initial viewport.
- [ ] Keep the desktop headline within two lines and supporting copy near 20 words or fewer.
- [ ] Use no more than four hero text groups.
- [ ] Keep hero top padding at or below roughly 6rem unless measured otherwise.
- [ ] Put trust logos and supporting proof below the hero.
- [ ] Keep desktop navigation on one line and no taller than 80 pixels.
- [ ] Keep CTA labels on one line with WCAG-compliant contrast.
- [ ] Use one label per CTA intent across the page.

## Composition

- [ ] Use no more than one eyebrow per three sections.
- [ ] Avoid generic section numbers, decorative dots, scroll cues, and version labels.
- [ ] Do not repeat one section layout family or use three consecutive zigzags.
- [ ] Avoid the default three-equal-card feature row.
- [ ] Match bento cells to content items and vary at least two cells visually.
- [ ] Avoid a floating split-header paragraph without a compositional purpose.
- [ ] Give every multi-column section an explicit mobile collapse.
- [ ] Replace long divider lists with a component suited to grouping or disclosure.

## Assets And Evidence

- [ ] Use real, authorized, generated, or explicitly requested image assets.
- [ ] Do not build decorative fake product screenshots from divs.
- [ ] Use real logo assets or consistent invented marks, with accessible names.
- [ ] Keep logo walls free of decorative category labels.
- [ ] Remove ornamental photo credits, fake stock counters, and build metadata.
- [ ] Verify claims, metrics, specifications, and social proof against a source.

## Interaction And Accessibility

- [ ] Implement relevant loading, empty, error, success, disabled, hover, active, and focus-visible states.
- [ ] Keep visible form labels and contextual helper or error text.
- [ ] Verify text contrast at 4.5:1 and UI or large-text contrast at 3:1.
- [ ] Keep touch targets at least 44 by 44 CSS pixels where practical.
- [ ] Preserve keyboard order, screen-reader names, and non-color status cues.
- [ ] Prevent pressed, loading, and error states from shifting layout unexpectedly.

## Motion

- [ ] State the communication purpose of every animation.
- [ ] Use at most one marquee.
- [ ] Match delivered motion to the declared intensity.
- [ ] Do not write scroll values into React state or use unmanaged scroll listeners.
- [ ] Clean up effects, triggers, observers, and animation contexts.
- [ ] Provide a complete reduced-motion fallback above intensity level 3.
- [ ] Verify scroll-pinning and horizontal-pan behavior at mobile and desktop sizes.

## Performance And Responsive Behavior

- [ ] Use `100dvh` behavior rather than unstable `100vh` assumptions on mobile.
- [ ] Reserve dimensions for images, fonts, embeds, and asynchronous content.
- [ ] Prioritize the true hero asset and lazy-load heavy below-fold work.
- [ ] Avoid animating layout properties when transform or opacity can express the same result.
- [ ] Check at small phone, tablet, laptop, and large desktop widths.
- [ ] Verify LCP, INP, and CLS with the project's available tools.

## Final AI-Tell Scan

- [ ] No purple-blue glow, excessive gradient text, pure-black default, or generic glass everywhere.
- [ ] No repeated warm craft palette chosen only because the product is premium.
- [ ] No generic names, brands, avatars, filler verbs, or poetic micro-labels.
- [ ] No overlaid image tags, decorative locale strips, status dots, or progress tracks.
- [ ] No hand-rolled icon paths when the project icon family provides the glyph.
- [ ] At least one distinctive element follows from the brief, not from a stock template.

The page is complete only when every applicable item passes and every non-applicable item has a concrete reason.
