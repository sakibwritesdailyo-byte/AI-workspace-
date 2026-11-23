# Personal AI Studio — Design Token Application Contract

## Brand direction
Warm, technical, focused. The product is a developer workspace, not a marketing site: surfaces stay quiet, typography is compact and legible, and code uses a dedicated monospace voice.

## Signature move
**One accent, used only on interactive elements, never decorative.** The brass `signal` role is reserved for active navigation, primary actions, focus/selection cues, and other direct interaction affordances. Do not use it as ambient decoration or on non-interactive illustration. Semantic `success`, `warning`, and `danger` roles are reserved for status feedback.

## Application rules
- `tokens.json` is the source of truth; `tokens.css` is its CSS-variable translation.
- The app defaults to dark mode (`html.dark` is already present in the supplied ZIP); light mode is also defined and must keep the same role names.
- Use semantic roles: `bg-surface`, `bg-raised`, `bg-sunken`, `text-ink`, `text-muted`, `text-faint`, `border-border`, `bg-signal`, `text-on-signal`, and status roles.
- Use `font-ui` for interface text and `font-mono` for code, paths, identifiers, and technical metadata.
- Use the named type steps; do not invent arbitrary font sizes in new components. Body measure is `68ch`; wide measure is `84ch`.
- Use only the named spacing scale. Component internal padding/gaps should normally use `space-3` through `space-7`; larger workspace-region separation may use `space-8` through `space-12`.
- Use one radius consistently per component class: inputs `radius-1`, buttons/tags `radius-2`, cards/panels `radius-3`, dialogs/large surfaces `radius-4`, pills/avatars `radius-full`.
- Use only the three declared shadow tiers. Do not invent additional elevation styles.
- Use only named easing and duration tokens. Respect `prefers-reduced-motion`.
- Focus indicators must remain visible and must not be animated away.

## Forbidden
- Raw hex values in component files.
- Arbitrary spacing, radii, font sizes, shadows, or durations outside `tokens.json`.
- `transition: all`.
- Using the brass `signal` color for decoration or non-interactive accents.
- Pure black or pure white surfaces/text.

## Anti-list — never animate
- Layout properties (`width`, `height`, `top`, `left`).
- `filter`, `backdrop-filter`, or `box-shadow` on repeatedly hovered elements.
- Text color on hover; use opacity or a surface treatment instead.
- Elements inside a scroll container already being scrubbed.
- Focus-visible outline or outline-offset.

## Tailwind integration
The supplied project uses Tailwind CSS v4 through `@tailwindcss/vite` and has no `tailwind.config.js`. The recommended integration is CSS variables plus a small compatibility config loaded explicitly with `@config`; the exact proposed code is provided alongside these tokens. No component files are changed in this stage.

## Validation and design limitation
The token validator checks theme parity, declared WCAG AA text pairs, spacing/type monotonicity, font fallback declarations, and orphan roles. A passing result establishes arithmetic consistency, not aesthetic approval; review the rendered app after component migration.
