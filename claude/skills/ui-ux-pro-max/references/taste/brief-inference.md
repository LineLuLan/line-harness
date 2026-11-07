# Brief Inference

Use this gate for landing pages, portfolios, editorial pages, and redesigns. Do not apply it as a blanket style layer to dashboards, dense product interfaces, data tables, multi-step forms, code editors, or native mobile applications.

## Design Read

Read the brief before choosing a visual language. Inspect:

1. Page kind: SaaS, consumer, agency, event, portfolio, editorial, or redesign.
2. Audience: procurement team, design-conscious consumer, recruiter, public user, or another specific group.
3. Explicit vibe words and named references.
4. Existing brand assets: logo, palette, typography, photography, and voice.
5. Constraints: accessibility, regulation, trust, performance, or child safety.
6. Redesign intent: preserve, evolve, or overhaul.

State one line before implementation:

> Reading this as: `<page kind>` for `<audience>`, with a `<vibe>` language, leaning toward `<design system or aesthetic family>`.

Ask one focused question only when two materially different directions remain plausible. Otherwise, state the read and proceed.

## Anti-Default Discipline

Do not default to purple-blue gradients, a centered hero over a dark mesh, three equal feature cards, global glassmorphism, constant looping motion, or one stock font and neutral palette. Derive each choice from the design read.

## Foundation Selection

Use an official design system when the brief maps to an established product language. Do not imitate an official system with hand-written CSS or mix two systems in one project.

| Brief signal | Foundation |
| --- | --- |
| Microsoft or enterprise SaaS | Fluent UI |
| Material-flavored product | Material Web and Material 3 tokens |
| Enterprise analytics | Carbon |
| Shopify admin surface | Polaris |
| Atlassian-style product | Atlassian Design System |
| GitHub-style developer product | Primer |
| UK public service | GOV.UK Frontend |
| US public service | USWDS |
| Fast local-business MVP | Bootstrap |
| Accessible React foundation | Radix Themes |
| Owned modern React components | shadcn/ui, customized |
| Utility-first marketing site | Tailwind CSS |

Treat glassmorphism, bento, brutalism, editorial layouts, dark-tech styling, mesh gradients, and kinetic typography as aesthetics, not official systems. Implement them with native CSS and maintained libraries. Label Apple-like glass effects as web approximations, not Apple platform material.

Verify current package names and installation commands in official documentation before adding dependencies.

## Foundation Installation And Sources

Use these commands only after confirming the package is absent and the project package manager is
known. Recheck the linked official documentation before installation.

| Foundation | Install | Canonical source |
| --- | --- | --- |
| Material Web | `npm install @material/web` | `https://material-web.dev/theming/material-theming/` |
| Fluent UI React | `npm install @fluentui/react-components` | `https://fluent2.microsoft.design/components/web/react/` |
| Fluent UI Web Components | `npm install @fluentui/web-components @fluentui/tokens` | `https://learn.microsoft.com/en-us/fluent-ui/web-components/` |
| Carbon | `npm install @carbon/react @carbon/styles` | `https://carbondesignsystem.com/developing/react-tutorial/overview/` |
| Radix Themes | `npm install @radix-ui/themes` | `https://www.radix-ui.com/themes/docs/components/theme` |
| shadcn/ui | `npx shadcn@latest init` | `https://ui.shadcn.com/docs` |
| Primer CSS | `npm install --save @primer/css` | `https://github.com/primer/css` |
| Primer Brand | `npm install @primer/react-brand` | `https://github.com/primer/brand` |
| GOV.UK Frontend | `npm install govuk-frontend` | `https://github.com/alphagov/govuk-frontend` |
| USWDS | `npm install uswds` | `https://designsystem.digital.gov/documentation/developers/` |
| Atlassian Design System | `yarn add @atlaskit/css-reset @atlaskit/tokens @atlaskit/button` | `https://atlassian.design/get-started/develop` |
| Bootstrap | `npm install bootstrap` | `https://getbootstrap.com/docs/5.3/` |
| Shopify Polaris | Load the documented Polaris web components for Shopify app surfaces. | `https://shopify.dev/docs/api/app-home/web-components` |

Additional canonical references:

- Material 3: `https://m3.material.io/develop/web`
- Fluent UI source: `https://github.com/microsoft/fluentui`
- Carbon source: `https://github.com/carbon-design-system/carbon`
- Atlassian tokens: `https://atlassian.design/tokens/design-tokens`
- Primer system: `https://primer.style/`
- GOV.UK layout: `https://design-system.service.gov.uk/styles/layout/`
- USWDS components: `https://designsystem.digital.gov/components/`
- Tailwind dark mode: `https://tailwindcss.com/docs/dark-mode`
- Native backdrop filtering: `https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter`
- Native scroll-driven animation: `https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations`

## Honest Web Glass Approximation

Apple documents Liquid Glass for Apple platform APIs, not as a web package. Label a CSS treatment
as a frosted-glass approximation and provide contrast without blur.

```css
.liquid-glass-web-approx {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 0.32);
  background:
    linear-gradient(135deg, rgb(255 255 255 / 0.3), rgb(255 255 255 / 0.08)),
    rgb(255 255 255 / 0.12);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.48),
    0 18px 60px rgb(0 0 0 / 0.18);
}

.liquid-glass-web-approx::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background: radial-gradient(circle at 20% 0%, rgb(255 255 255 / 0.55), transparent 34%);
  pointer-events: none;
}

@media (prefers-color-scheme: dark) {
  .liquid-glass-web-approx {
    background: rgb(15 23 42 / 0.82);
  }
}

@media (prefers-reduced-transparency: reduce) {
  .liquid-glass-web-approx {
    background: rgb(255 255 255 / 0.96);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
```

Reduced-transparency support varies by browser. Test the fallback and maintain readable contrast in
every state. Use Apple's Human Interface Guidelines and developer materials only for Apple-native
implementation claims.

## Architecture Defaults

- Match the existing framework and styling stack before introducing another one.
- In Next.js, keep static layout in Server Components and isolate motion, pointer tracking, and scroll listeners in small Client Component leaves.
- Use local React state for discrete local state. Use motion values, not React state, for continuous pointer or scroll values.
- Use one icon family and one global stroke-weight rule. Do not hand-draw SVG paths when a maintained icon exists.
- Use one breakpoint system, bounded containers, CSS Grid for multi-column layouts, and `min-height: 100dvh` for viewport-height sections.
- Load fonts through the framework or self-hosted `@font-face` with `font-display: swap`.
- Check the project manifest before importing any third-party package.

## Content And Asset Grounding

Landing pages are visual products. Prefer, in order:

1. Project or brand assets supplied by the user.
2. Purpose-built generated images when image generation is authorized and available.
3. Licensed or clearly permitted real images.
4. Explicitly labeled image slots with required dimensions.

Do not substitute div-based fake screenshots, generic text wordmarks, or decorative hand-built SVG scenes. Use real screenshots, actual embedded components, recognizable SVG logos, or honest placeholders.

Use specific, evidence-backed copy and data. Mark mock values as examples. Do not invent precise metrics, product specifications, customer claims, or social proof.

## Scope Exit

Route dense product UI to the relevant product design system. Route data tables to a table library, native mobile to platform guidelines, and specialized editors or collaboration surfaces to their domain patterns. Apply this taste gate only to the marketing, portfolio, or editorial surfaces that remain in scope.
