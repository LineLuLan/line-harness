# AI Tells And Bias Corrections

Use this reference as a rejection list, not as a replacement style. Context can override a rule only when the brief explicitly supports the pattern and the implementation remains accessible.

## Typography

- Do not default to Inter, oversized headings, or a decorative serif because the brief says "creative" or "premium."
- Use serif display type only for a genuinely editorial, publication, heritage, or explicitly serif brand language.
- Emphasize a word with weight or italic from the same family. Do not insert an unrelated serif into a sans-serif headline.
- Avoid overused display-serif defaults such as Fraunces and Instrument Serif unless the brand already specifies them.
- Give italic display words containing descenders enough line-height and bottom clearance.
- Keep body copy readable, with a controlled line length and a consistent type scale.
- Use one copy register per page. Do not mix technical fragments, poetic marketing, and editorial prose without a brand reason.

Visible page copy must not contain em dash or en dash characters. Rewrite with punctuation, parentheses, or a normal hyphen for ranges.

## Color, Material, And Shape

- Use one accent color and one neutral temperature across the page.
- Do not default to purple-blue glow, neon outer glow, gradient headings, or pure black.
- Do not default premium consumer work to cream, brass, clay, oxblood, and espresso. Rotate toward a brand-specific palette such as cool metallic neutrals, forest tones, high-contrast black and tan, cobalt with a neutral, rust with cool gray, or monochrome with one saturated accent.
- Use glass effects only when the brief supports them. Provide a solid fallback and maintain contrast without blur.
- Pick one radius system. A mixed system is valid only when each component role has a documented radius.
- Use cards only when containment or elevation communicates structure. Prefer spacing, grouping, or sparse dividers otherwise.
- Tint shadows to the surrounding palette and avoid generic shadows on every element.

## Hero And Navigation

- Fit the complete hero in the initial viewport.
- Keep the desktop headline to two lines and the supporting sentence to about 20 words.
- Keep hero top padding at or below roughly 6rem unless a measured composition requires less content.
- Limit hero text to an optional eyebrow or brand strip, headline, supporting text, and up to two actions.
- Put logo walls, pricing teasers, feature bullets, and trust details below the hero.
- Use one CTA label per intent across the page. Avoid synonyms that trigger the same action.
- Keep desktop CTA labels on one line and verify foreground-background contrast.
- Keep desktop navigation on one line and typically 64-72 pixels high, with 80 pixels as a cap.
- Do not add scroll cues, version labels, locale clocks, weather strips, decorative status dots, or ornamental text ribbons.

## Layout

- Reject the default row of three equal feature cards.
- Limit section eyebrows to at most one per three sections.
- Do not number sections, images, or steps when their names already communicate order.
- Avoid a split heading with a large title on the left and a small floating paragraph on the right. Stack the explanation unless the right side contains a real visual or interaction.
- Do not use three or more consecutive image-text zigzags.
- Match bento cell count to content count. Do not add empty cells.
- Give bento grids real visual variation through imagery, scale, color, or material.
- Do not place pills or decorative labels over images.
- Do not repeat hairlines above and below every row of a long list.
- Do not use filled progress tracks as a generic comparison device on marketing pages.
- Make every multi-column section define its mobile collapse explicitly.

## Images, Logos, And Product Views

- Use a real screenshot, a generated image, a real interactive preview, or a clearly labeled slot.
- Do not build fake dashboards, terminal windows, task lists, or product screenshots from decorative divs.
- Use real logos for real organizations. For invented organizations, create a consistent, accessible mark rather than a plain text logo wall.
- Keep logo walls to logos, accessible names, and optional links. Do not add category captions.
- Avoid decorative photo credits unless crediting a real photographer for a real image.
- Do not add fake version strings, build metadata, or stock counters.

## Content And Data

- Replace filler verbs such as "elevate," "unleash," "seamless," and "revolutionize" with concrete claims.
- Avoid generic people, generic startup names, and placeholder avatars in polished examples.
- Do not invent exact metrics, measurements, customer claims, or live inventory.
- Re-read every visible string for broken grammar, unclear references, forced metaphors, and empty craft language.
- Keep quotes short enough to scan, with a name, role, and optional organization.
- Use plain section labels. Avoid performative labels such as workshop, field notes, on the bench, or quietly trusted when they do not describe real content.
- Name process steps with the action itself, not generic labels such as Stage 1 or Pass Two.

## Interaction And States

- Implement loading, empty, error, success, disabled, hover, focus-visible, and active states as applicable.
- Use skeletons that match final geometry instead of a generic spinner where possible.
- Keep input labels visible above inputs. Place helper and error text in a stable, accessible structure.
- Check input, placeholder, label, focus-ring, and error contrast against the actual section background.
- Keep active feedback tactile but prevent pressed states from changing layout bounds.
- Use semantic status indicators and never encode status by color alone.

## Motion Tells

- Do not animate every card or run multiple infinite loops.
- Do not add GSAP because it is available. Each trigger must have a stated communication purpose.
- Do not mix competing animation libraries in the same component subtree.
- Do not use a custom cursor, gratuitous parallax, or repeated marquees.
- Do not claim a high motion level while shipping a static page.
- Do not ship an animation without cleanup, reduced-motion behavior, and mobile testing.

## Pattern Vocabulary

Use pattern names to discuss intent, not to force implementation.

| Area | Useful vocabulary |
| --- | --- |
| Hero | asymmetric split, editorial manifesto, media mask, kinetic type, curtain reveal, scroll-pinned |
| Navigation | magnetic button, morphing status pill, radial menu, speed dial, mega menu |
| Layout | bento grid, masonry, split-screen scroll, sticky stack |
| Containers | tilt card, spotlight border, glass panel, swipe stack, morphing modal |
| Scroll | sticky stack, horizontal pan, sequence scroll, zoom parallax, progress path |
| Media | coverflow, drag-to-pan grid, accordion gallery, hover image trail |
| Type | kinetic marquee, text mask, text scramble, circular path |
| Feedback | directional hover, ripple, skeleton shimmer, line drawing, shared-layout transition |

Choose the lowest-complexity pattern that communicates the intended hierarchy or interaction.
