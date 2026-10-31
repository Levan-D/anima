---
name: styles
description: Use when styling anything in src/renderer. Tailwind classes, colors, typography, spacing, scaling across screens, motion, dark mode, global CSS. Encodes the token system.
---

# Styling conventions

Tailwind 4, CSS-first. No `tailwind.config.js`. Everything lives in `src/renderer/styles/globals.css` (`@theme`) and `typography.css`. See `docs/research/ui-stack.md`.

## The three-layer token system

```
1. primitives   @theme in globals.css   --color-neutral-900
                ↓ never referenced by components
2. semantic     :root                   --bg, --surface, --text, --border, --accent
                ↓ bridged into Tailwind
3. utilities    @theme inline           bg-bg, bg-surface, text-text-muted, border-border
```

**Components use layer 3 only.** Never a raw hex, never a primitive. If no semantic token fits, add one to `:root` and expose it via `@theme inline`. Don't invent a one-off value.

The app is dark by design. Tokens still go through the semantic layer so a light theme stays possible, and so album-driven color works.

## Album-driven color

`--accent` follows the current album art. Main computes the art's average color, `lib/` turns it into a color with guaranteed contrast and sets it on the root. Components use `bg-accent`, `text-accent`, and transitions on the variable make track changes feel alive. Never hardcode an accent.

## Everything scales from one unit

This is how one UI fits a 10" laptop and a 65" TV.

```css
--fluid: calc(min(1.05vw, 1vh) * var(--scale));  /* 1% of the shorter axis */
--spacing-cell: max(10px, min(12px, calc(var(--fluid) * 1.5)), calc(var(--fluid) * 1.2)); /* floors simplified here */
--spacing: calc(var(--spacing-cell) * 0.3);      /* rebases Tailwind's numeric scale */
```

- Because `--spacing` is redefined, **Tailwind's entire numeric scale is fluid**: `gap-4`, `p-6`, `size-11` all grow with the window. No special classes needed.
- Semantic steps for what recurs: `h-row` (list rows), `size-tap`, `p-gutter`, `gap-gap`, `p-section`, `h-transport`, `h-title-bar`. Prefer these to a bare number when one fits.
- `side-by-side:` is the variant for "the art sits beside the list". Unprefixed classes are the stacked layout.
- `--ui-scale` is the interface-size setting, which stops at `UI_SCALE_MAX` (2.25). It scales the tokens directly, limited only by what the window can hold (`--scale`). There's no `setZoomFactor`: zoom shrinks the CSS width and height, which flips the layout queries when the person asks for a bigger UI. Any new formula with `vw` or `vh` must go through `--fluid`, and any floor through `--floor-scale`, or it ignores the setting.
- `--spacing-card` is exactly 11.46 cells on purpose: it decides how many album lanes each window gets, so it isn't a value to round.
- Under `pointer: coarse` (a touch-first device, not a touch laptop with a trackpad) the scrollbar widens so a finger can hold it, and `--spacing-gutter` gives that room back, so rows and album lanes don't change.
- It follows the **shorter** axis, so a wide-but-short window doesn't overflow.
- **There is no ceiling. Use `max(floor, fluid)`, never `clamp(a, b, c)`.** A cap would make the UI stop growing and shrink into the middle of a TV.
- **Mobile-first bands: `min-width` queries only.** Bands meet at their edges so nothing jumps.

**Never write a raw px size** for spacing, icons, media or type. It becomes the one thing that doesn't scale. Exceptions: `size-tap` (44px floor for touch targets, only ever scales up), hairline borders, `ring-*`.

CSS only sees pixels, not physical inches, so judge layouts at 1280×800 (10" laptop), 1920×1080, 2560×1440 and 3840×2160.

## The art comes first

The square album art is the biggest thing on screen. In landscape it takes the full window height, capped so the list keeps a usable width. In narrow or portrait windows the art goes on top. All of it in CSS.

## Screen-size differences are CSS

Never a JS breakpoint. Layout changes use responsive classes. Two truly different subtrees: render both and toggle with `hidden lg:block`.

## No grid: flex only

Levan's standing decision, carried over from their other projects. Stacks are `flex flex-col`, centering is `flex items-center justify-center`, wrapping grids are `flex flex-wrap` with `[&>*]:flex-[1_0_<basis>]`. Virtualized album grids compute lanes from measured width.

## Typography

- Bundled font via `@fontsource-variable`, never a network font.
- Fluid scale from `typography.css`: `text-meta`, `text-body`, `text-lead`, `text-title`, `text-heading`, `text-display`. All `max(floor, min(vw, vh))`, with the fluid part being `var(--fluid)`. `text-cover` follows its container instead, for the album title on the art pane.
- Never `text-[15px]`. Numbers that tick (time, counts) use `tabular-nums`.
- Text styling goes through `<Text>` variants.

## Hover and touch

- Tailwind 4's `hover:` already applies only on devices that can hover. Don't gate it further.
- Never hide an action behind hover alone. Touch and keyboard need it too.

## Motion

- `motion` for presence and layout (art crossfade, panels). CSS transitions for simple states.
- Durations are tokens: `duration-(--dur-fast)`, `--dur-mid`, `--dur-slow`. Never `duration-300`.
- Animate only `transform` and `opacity`, so it stays on the compositor. Color fades use short CSS transitions.
- A few purposeful animations, not many. Levan said so.
- Reduced motion is respected centrally with `MotionConfig reducedMotion="user"` and a CSS block for looping animations.
- What moves with the music registers with `usePlayerPosition` and stays within `PAINT_EVERY_MS`. The exception is the playing bars: compositor keyframes, current row only, by Levan's choice. Other CSS loops are only for things that don't last.
- Anything that loops forever stops when it's not visible. Background throttling is off, so the Page Visibility API can't tell: CSS animations pause through `data-window-hidden` on the root, and JS loops read `isHidden` from `window.state`.

## Performance

- `backdrop-blur` is avoided. Scrims darken instead. Ask before introducing it.
- Long lists are virtualized. Large images are thumbnails with `loading="lazy"` and `decoding="async"`, except the current now-playing art.

## Class composition

- `cn()` from `@/lib/cn` (clsx + tailwind-merge). Always when merging a `className` prop, and `className` comes last so callers win.
- Conditionals inline in `cn()` as `condition && 'classes'`, one per line.
- Variant maps as `Record<Variant, string>` above the component.
- Class order comes from `prettier-plugin-tailwindcss`. Don't hand-sort.

## Global CSS

- `@utility` only for what can't be expressed inline. Not a substitute for a component.
- `@layer base` holds only element defaults.
- Window drag regions use `app-region: drag` and `no-drag` through named utilities. Anything interactive inside a drag region must be `no-drag`.
