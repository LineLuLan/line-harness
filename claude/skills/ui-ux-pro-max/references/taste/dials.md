# Design Dials

Set three explicit values after the design read. Treat them as global project variables and do not invent aliases.

- `DESIGN_VARIANCE`: 1 is strict symmetry; 10 is controlled asymmetry.
- `MOTION_INTENSITY`: 1 is static; 10 is cinematic or physics-driven.
- `VISUAL_DENSITY`: 1 is gallery-like; 10 is compact and data-heavy.

Use `8 / 6 / 4` only as a landing-page baseline. Override it when the brief provides stronger evidence.

## Presets

| Signal | Variance | Motion | Density |
| --- | ---: | ---: | ---: |
| Minimal, calm, editorial, or restrained | 5-6 | 3-4 | 2-3 |
| Premium consumer or brand-led | 7-8 | 5-7 | 3-4 |
| Playful, experimental, or creative agency | 9-10 | 8-10 | 3-4 |
| Mainstream SaaS landing | 7 | 6 | 4 |
| Designer or studio portfolio | 8 | 7 | 3 |
| Developer portfolio | 6 | 5 | 4 |
| Public service or accessibility-critical | 3-4 | 2-3 | 4-5 |
| Redesign, preserve | Match existing | Existing + 1 at most | Match existing |
| Redesign, overhaul | Existing + 2 | Existing + 2 | Match existing |

## Variance Rules

- Levels 1-3: regular grid, balanced spacing, predictable alignment.
- Levels 4-7: controlled offsets, mixed aspect ratios, selective overlap.
- Levels 8-10: asymmetric grids, masonry, deliberate empty space, and stronger scale contrast.
- At every level above 3, collapse complex layouts to an explicit single-column mobile layout below the project breakpoint.
- When variance exceeds 4, avoid a centered hero unless the brief is editorial, manifesto-like, or launch-focused.
- Do not repeat the same section layout family. Across eight sections, use at least four distinct composition families.
- Limit alternating image-text zigzags to two consecutive sections.

## Motion Rules

- Levels 1-3: static layout with hover, focus, and active feedback only.
- Levels 4-7: restrained entry transitions and state changes using transform and opacity.
- Levels 8-10: scroll-linked or choreographed motion with explicit narrative purpose.

Every animation must communicate hierarchy, story sequence, feedback, or state change. Remove motion that exists only as decoration.

Use Motion for component-level transitions, enter-on-view reveals, and shared-layout changes. Use GSAP with ScrollTrigger only for real pinning, scrubbing, or scroll storytelling. Keep animation systems in isolated client leaves and clean them up on unmount.

For a sticky stack or horizontal pan:

- Pin when the section reaches the viewport top.
- Use `start: "top top"` and a scroll distance based on actual travel.
- Drive transforms from the next item or the measured track distance.
- Recalculate on refresh when dimensions can change.
- Provide a static reduced-motion fallback.

Do not use scroll listeners that write to React state, request-animation-frame loops that update React state, or unbounded perpetual effects. Use motion values, Intersection Observer, ScrollTrigger, or CSS scroll-driven animation.

Use at most one marquee per page. If `MOTION_INTENSITY` exceeds 4, the delivered page must contain working, motivated motion. If scope cannot support that, lower the dial.

## Canonical Motion Protocols

Use Motion for entry and layout transitions. Use GSAP with ScrollTrigger only for real pinning,
scrubbing, or scroll storytelling. Isolate either approach in a Client Component and clean up every
effect. These examples require `motion` and `gsap`; after checking the project manifest and package
manager, the npm form is `npm install motion gsap`.

### Sticky Stack

Pin each card except the last at the viewport top. Drive the previous card's scale and opacity from
the next card so the stack visibly accumulates.

```tsx
"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "motion/react";

gsap.registerPlugin(ScrollTrigger);

export function StickyStack({ cards }: { cards: React.ReactNode[] }) {
  const root = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce || !root.current) return;
    const context = gsap.context(() => {
      const elements = gsap.utils.toArray<HTMLElement>(".stack-card");
      elements.slice(0, -1).forEach((card, index) => {
        ScrollTrigger.create({
          trigger: card,
          start: "top top",
          endTrigger: elements.at(-1),
          end: "top top",
          pin: true,
          pinSpacing: false,
        });
        gsap.to(card, {
          scale: 0.92,
          opacity: 0.55,
          ease: "none",
          scrollTrigger: {
            trigger: elements[index + 1],
            start: "top bottom",
            end: "top top",
            scrub: true,
          },
        });
      });
    }, root);
    return () => context.revert();
  }, [reduce]);

  return (
    <div ref={root}>
      {cards.map((card, index) => (
        <section key={index} className="stack-card sticky top-0 min-h-[100dvh]">
          {card}
        </section>
      ))}
    </div>
  );
}
```

### Horizontal Pan

Pin the wrapper when its top reaches the viewport top. Set scroll distance from the measured track
width and invalidate measurements on refresh.

```tsx
"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "motion/react";

gsap.registerPlugin(ScrollTrigger);

export function HorizontalPan({ children }: { children: React.ReactNode }) {
  const wrapper = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce || !wrapper.current || !track.current) return;
    const context = gsap.context(() => {
      const distance = track.current!.scrollWidth - window.innerWidth;
      gsap.to(track.current, {
        x: -distance,
        ease: "none",
        scrollTrigger: {
          trigger: wrapper.current,
          start: "top top",
          end: () => `+=${distance}`,
          pin: true,
          scrub: 1,
          invalidateOnRefresh: true,
        },
      });
    }, wrapper);
    return () => context.revert();
  }, [reduce]);

  return (
    <section ref={wrapper} className="overflow-hidden">
      <div ref={track} className="flex min-h-[100dvh] items-center">
        {children}
      </div>
    </section>
  );
}
```

### Lightweight Reveal

For unpinned enter-on-view motion, avoid ScrollTrigger and use Motion.

```tsx
"use client";

import { motion, useReducedMotion } from "motion/react";

export function Reveal({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
```

Do not use window scroll listeners, React state for scroll progress, request-animation-frame loops
that update React state, or unmanaged triggers. Use `layout` and `layoutId` only for visible layout
changes, not as a default wrapper.

## Density Rules

- Levels 1-3: large spacing, sparse copy, and strong image presence.
- Levels 4-7: standard application spacing and moderate information load.
- Levels 8-10: tight grouping, fewer container cards, separators for structure, and tabular numerals for dense data.

Default each marketing section to a short headline, a paragraph of about 25 words or fewer, and one visual or action. Replace lists longer than five items with grouped columns, tabs, an accordion, cards, a carousel, or a disclosure based on the content.

Do not render a long product specification sheet as identical divider rows. Prefer grouped clusters, featured metrics plus a disclosure, a small card grid, or horizontal scroll-snap items.

## Performance And Accessibility

- Animate only transform and opacity when possible.
- Honor `prefers-reduced-motion` for any motion above level 3.
- Avoid scroll-jacking without a complete keyboard and reduced-motion path.
- Reserve image and embed dimensions to prevent layout shift.
- Prioritize or preload the true hero image.
- Keep main-thread work small and lazy-load heavy, below-fold motion libraries.
- Apply grain and noise to fixed, pointer-transparent overlays, not scrolling containers.
- Define a small z-index scale rather than scattering arbitrary values.
- Target LCP below 2.5 seconds, INP below 200 milliseconds, and CLS below 0.1, then verify with project tooling.

## Theme Lock

Choose light, dark, or system-driven mode at the page root. Do not invert isolated sections. Adjacent tonal variations inside one theme are fine. A deliberate full-page theme transition is acceptable only when the brief explicitly calls for it.

Use one token strategy: paired utility variants or semantic CSS variables. Verify hierarchy, brand recognition, focus states, and WCAG contrast in every supported mode.
