# Redesign Protocol

Classify the work before changing visuals:

- **Greenfield:** no existing interface or a complete visual restart is approved.
- **Preserve:** modernize while retaining brand recognition, information architecture, and working behavior.
- **Overhaul:** replace the visual language while preserving approved content and structure.

If the mode is ambiguous, ask one question: should the redesign preserve the current brand, or start visually from scratch?

## Audit Before Editing

Record:

1. Brand tokens: palette, type, logo treatment, radius, imagery, and voice.
2. Information architecture: page tree, navigation, routes, anchors, and conversion paths.
3. Content blocks: what performs a clear job, what duplicates another section, and what is filler.
4. Signature patterns: recognizable hero, interaction, illustration, or content structure.
5. Defects: inaccessible states, broken responsive behavior, dead links, generic imagery, and performance traps.
6. Existing dial values for variance, motion, and density.
7. SEO and measurement baseline: ranking routes, metadata, structured data, social cards, analytics events, and conversion tracking.

Use the existing dial values as the starting point for preservation work.

## Preservation Gates

Do not change these silently:

- URL structure, route slugs, or anchor IDs.
- Primary navigation labels or hierarchy.
- Form field names, order, validation semantics, or analytics identifiers.
- Brand logo or wordmark.
- Legal, consent, privacy, or cookie text.
- Existing accessibility behavior that already works.
- Copy voice when the request is only visual.

Extract brand colors before applying general palette heuristics. An established violet brand remains violet. Preserve analytics hooks and downstream contracts even when visual components are replaced.

## Modernization Order

Apply the lowest-risk lever that meets the brief:

1. Typography and type hierarchy.
2. Spacing and vertical rhythm.
3. Color calibration and semantic tokens.
4. Interaction states and appropriately scaled motion.
5. Hero and key-section recomposition.
6. Full block replacement.

Stop when the outcome satisfies the brief. Do not turn a targeted evolution into an unrequested rebuild.

## Decision Rules

- If information architecture, content, SEO, and measurement are sound, use targeted evolution.
- If mobile behavior, information structure, or component foundations are structurally broken, propose a full redesign with content and contract preservation.
- If the brand itself is changing, treat the visual work as greenfield while migrating business-critical routes, data, and tracking deliberately.

## Block Contract

When a reusable pattern is worth capturing, document one block per file with:

1. Use and non-use conditions.
2. Compatible dial ranges.
3. Visual structure.
4. Props or content contract.
5. Minimal implementation approach.
6. Explicit mobile collapse.
7. Motion behavior by intensity band and reduced-motion fallback.
8. Theme and contrast requirements.
9. Common failure modes.
10. Production references where available.

Do not create a block only to preserve one-off styling. A reusable block must stand alone and pass the same preflight gate as the final page.

Store future block references under `references/taste/blocks/<category>/<name>.md`. Use one block
per file. A system-specific variant uses `<name>--<system>.md`.

Required frontmatter:

```yaml
---
name: asymmetric-split-hero
category: hero
dial_compatibility:
  variance: [6, 10]
  motion: [3, 10]
  density: [2, 5]
when_to_use: "One strong asset and one strong message."
not_for: "Editorial launches where the message is the visual system."
stack: ["react", "next", "tailwind", "motion"]
---
```

Each body must provide a visual sketch, props API, minimal implementation, mobile fallback,
motion variants for dial bands 1-3, 4-7, and 8-10, reduced-motion behavior, theme and contrast
notes, failure modes, and production references. A block must render independently and pass
`preflight.md` before reuse.

## Completion Evidence

Compare before and after for layout, routes, navigation, forms, analytics hooks, accessibility, responsive behavior, SEO metadata, and performance. State preserved contracts and approved breaks explicitly.
