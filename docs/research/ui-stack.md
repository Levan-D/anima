# Tailwind 4, Radix Primitives, and Motion: reference notes

## Sources

Read (HTTP 200):
- https://tailwindcss.com/docs/installation/using-vite
- https://tailwindcss.com/docs/theme
- https://tailwindcss.com/docs/functions-and-directives
- https://tailwindcss.com/docs/hover-focus-and-other-states (second part read with offset 39934)
- https://tailwindcss.com/docs/responsive-design
- https://tailwindcss.com/docs/upgrade-guide
- https://tailwindcss.com/docs/dark-mode
- https://tailwindcss.com/docs/adding-custom-styles
- https://tailwindcss.com/docs/aspect-ratio (Tailwind sidebar link)
- https://www.radix-ui.com/primitives/docs/overview/getting-started
- https://www.radix-ui.com/primitives/docs/components/context-menu
- https://www.radix-ui.com/primitives/docs/components/dropdown-menu
- https://www.radix-ui.com/primitives/docs/components/dialog
- https://www.radix-ui.com/primitives/docs/components/slider
- https://www.radix-ui.com/primitives/docs/components/toast
- https://www.radix-ui.com/primitives/docs/components/tooltip
- https://www.radix-ui.com/primitives/docs/components/scroll-area
- https://www.radix-ui.com/primitives/docs/overview/accessibility
- https://www.radix-ui.com/primitives/docs/guides/composition (link from the Tooltip page)
- https://motion.dev/docs/react-quick-start
- https://motion.dev/docs/react-animation
- https://motion.dev/docs/react-animate-presence
- https://motion.dev/docs/react-motion-config
- https://motion.dev/docs/react-layout-animations
- https://motion.dev/docs/react-installation (link from the quick start)
- https://motion.dev/docs/react-motion-component (link from the animation page)

Failed (not read): https://motion.dev/docs/react-reduced-motion returned HTTP 404 Not Found. This is permanent, so sending the URL again would fail the same way. Reduced-motion details below come from the MotionConfig page instead.

## Tailwind CSS v4 (docs header reads v4.3)

### Vite setup
- `npm install tailwindcss @tailwindcss/vite`
- `vite.config.ts`: `import tailwindcss from '@tailwindcss/vite'`, then `plugins: [tailwindcss()]`.
- CSS entry: `@import "tailwindcss";`
- The upgrade guide recommends the Vite plugin over PostCSS (`@tailwindcss/postcss`). The PostCSS path no longer needs `postcss-import` or `autoprefixer`.
- Stated browser targets: Safari 16.4+, Chrome 111+, Firefox 128+. Electron is not mentioned, so check the bundled Chromium against these.

### @theme and theme variables
- `@theme { --color-mint-500: oklch(0.72 0.11 178); }` generates `bg-mint-500`, `text-mint-500`, and `fill-mint-500`, and also emits `var(--color-mint-500)` on `:root`.
- `@theme` must be top-level, not nested under selectors or media queries. Use `:root` for CSS variables that should not create utilities.
- Namespaces: `--color-*`, `--font-*`, `--text-*` (font size), `--font-weight-*`, `--tracking-*`, `--leading-*`, `--tab-size-*`, `--breakpoint-*` (responsive variants), `--container-*` (`@sm:` variants and `max-w-*`), `--spacing-*`, `--radius-*`, `--shadow-*`, `--inset-shadow-*`, `--drop-shadow-*`, `--blur-*`, `--perspective-*`, `--zoom-*`, `--aspect-*`, `--ease-*`, `--animate-*`.
- Override by redefining the variable inside `@theme`. Clear one namespace with `--color-*: initial;`. Clear everything with `--*: initial;`.
- `@theme inline`: utilities emit the value instead of `var(--name)`. The docs use it when a theme variable references another variable, e.g. `--font-sans: var(--font-inter);`.
- `@theme static`: emit every variable, not only the ones in use.
- Keyframes inside `@theme` are emitted when an `--animate-*` variable uses them. Keyframes outside `@theme` are always emitted.
- Spacing: the default is `--spacing: 0.25rem;`. `--spacing(4)` compiles to `calc(var(--spacing) * 4)`, so overriding `--spacing` rescales every numeric spacing utility. This is inferred from compiled output, since the docs don't use the word "rebase". The namespace table lists `--spacing-*`, but the defaults define only `--spacing`.

### @utility and @custom-variant
- Simple: `@utility tab-4 { tab-size: 4; }`. It works with `hover:` and `lg:` variants.
- Functional: `@utility tab-* { tab-size: --value(--tab-size-*); }`.
- `--value()` forms: theme keys (`--value(--tab-size-*)`), bare types (`--value(integer)`; types are number, integer, ratio, percentage), literals (`--value("inherit", "initial", "unset")`), and arbitrary (`--value([integer])`). `--default(4)` sets a default. `--modifier()` handles the `/` modifier.
- Negative values need a separate `-name-*` utility.
- `@utility` replaces v3's pattern of putting custom classes in `@layer utilities`. Custom utilities are sorted by property count.
- `@custom-variant theme-midnight (&:where([data-theme="midnight"] *));` is the shorthand. The block form uses `@slot;` inside the rule.

### Other directives and functions
- `@source` adds source paths. `@source inline(...)` replaces the v3 safelist.
- `@reference "tailwindcss";` (or your app CSS) makes `@apply` and `@variant` work in CSS modules or SFC `<style>` blocks.
- `@config` and `@plugin` are for compatibility. `theme()` is deprecated in favor of CSS variables.
- `--alpha(var(--color-lime-300) / 50%)` compiles to `color-mix(in oklab, ...)`.
- Default import order: `@layer theme, base, components, utilities;`.

### Hover, focus, and touch
- Quick reference: `hover` compiles to `@media (hover: hover) { &:hover }`. `focus`, `focus-visible`, `focus-within`, and `active` are not media-gated.
- Upgrade guide: `hover` applies only when the primary input device supports hover, so touch taps do not trigger hover styles.
- To restore v3 behavior, use `@custom-variant hover (&:hover);`. The docs say to treat hover as an enhancement.
- Docs example of an any-input variant: `@custom-variant any-hover { @media (any-hover: hover) { &:hover { @slot; } } }`.
- Pointer variants: `pointer-coarse` is `@media (pointer: coarse)`, plus `pointer-fine`, `any-pointer-coarse`, and `pointer-none`.
- Motion variants: `motion-reduce` is `(prefers-reduced-motion: reduce)`, and `motion-safe` is `(prefers-reduced-motion: no-preference)`.

### Breakpoints and containers
- Mobile-first: unprefixed utilities apply at every size, and `md:` applies at md and up.
- Default breakpoints (min-width): `sm` 40rem (640px), `md` 48rem (768px), `lg` 64rem (1024px), `xl` 80rem (1280px), `2xl` 96rem (1536px). These are emitted as `@media (width >= 40rem)`.
- Max variants: `max-sm` is `@media (width < 40rem)`, through `max-2xl` at `96rem`. Range example: `md:max-xl:flex`.
- Customize in `@theme`: `--breakpoint-sm: 30rem;`. Remove one with `--breakpoint-2xl: initial;`. Replace all with `--breakpoint-*: initial;`. The docs say to use rem for new breakpoints too, or sort order can break.
- One-offs: `min-[320px]:` and `max-[600px]:`.
- Container queries: put `@container` on the parent. Children use `@sm:`, `@md:` (mobile-first), `@max-md:` for below, or ranges like `@sm:@max-md:flex-col`.
- Named containers: `@container/main` with `@sm/main:`. `@container-size` is needed for block-size units like `cqb`. One-offs: `@min-[475px]` and `@max-[960px]`.
- Default container sizes run from `@3xs` (16rem) to `@7xl` (80rem). `--container-8xl: 96rem;` adds `@8xl:`.

### Aspect ratio
- `aspect-square` → `aspect-ratio: 1 / 1;`. `aspect-video` → `aspect-ratio: var(--aspect-video); /* 16 / 9 */`. `aspect-auto` → `auto`.
- Also `aspect-<ratio>` (e.g. `aspect-3/2`), `aspect-[<value>]`, and `aspect-(<custom-property>)`.
- Custom: `@theme { --aspect-retro: 4 / 3; }` gives `aspect-retro`. Responsive: `md:aspect-square`.

### Arbitrary values and CSS variables
- Parentheses: `bg-(--brand-color)` is shorthand for `bg-[var(--brand-color)]`. v3's `bg-[--brand-color]` form was replaced.
- Type hints when ambiguous: `text-(length:--my-var)` (font size) versus `text-(color:--my-var)`.
- Underscores become spaces: `grid-cols-[1fr_500px_2fr]`. Commas no longer work as spaces in `grid-cols-*`, `grid-rows-*`, or `object-*`.
- Arbitrary property: `[mask-type:luminance]`. Custom property: `[--scroll-offset:56px]`. Arbitrary variant: `[&.is-dragging]:cursor-grabbing`.
- Important modifier: trailing `!` (`flex!`). The leading `!` form still works but is deprecated.
- Stacked variants apply left to right.
- `--spacing(4)` works inside arbitrary values, e.g. `py-[calc(--spacing(4)-1px)]`.

### Dark mode
- Default: `dark:` is `@media (prefers-color-scheme: dark)`.
- Class-based: `@custom-variant dark (&:where(.dark, .dark *));`, with `.dark` on an ancestor such as `<html>`.
- Data attribute: `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));`.
- Three-way toggle: a head script sets the `dark` class from `localStorage.theme` or `matchMedia`. The docs advise running it inline in `<head>` to avoid a flash.

### v3 to v4 changes most likely to bite
- `@tailwind base/components/utilities` is removed. Use `@import "tailwindcss";`.
- Renames: `shadow-sm`→`shadow-xs`, `shadow`→`shadow-sm`, `rounded-sm`→`rounded-xs`, `rounded`→`rounded-sm`, `blur-sm`→`blur-xs`, `blur`→`blur-sm` (same pattern for `drop-shadow` and `backdrop-blur`), `outline-none`→`outline-hidden`, and `ring`→`ring-3`.
- Defaults: `ring` is 1px (was 3px) and `currentColor` (was blue-500). `border-*` and `divide-*` default to `currentColor` (was gray-200).
- Removed: `bg-opacity-*` and its text/border/divide/ring/placeholder equivalents (use `bg-black/50`), `flex-shrink-*`→`shrink-*`, `flex-grow-*`→`grow-*`, `overflow-ellipsis`→`text-ellipsis`, and `decoration-slice`/`decoration-clone`→`box-decoration-*`.
- Preflight: buttons use `cursor: default`. `dialog` margins are reset. Display classes no longer override the `hidden` attribute (except `hidden="until-found"`).
- `transform-none` no longer resets transforms. Reset the individual property instead, e.g. `scale-none`. `transition-[opacity,transform]` no longer covers `scale-*`; use `transition-[opacity,scale]`.
- `space-x-*`, `space-y-*`, and `divide-*` now use `:not(:last-child)` selectors.
- `corePlugins` and `resolveConfig` are removed. A JS config loads only through `@config`. `safelist` and `separator` are unsupported.
- `@apply` in CSS modules or SFC styles needs `@reference`. Sass, Less, and Stylus are unsupported.
- Automated migration: `npx @tailwindcss/upgrade` (Node 20+).

## Radix Primitives

### Import shape and asChild
- Install with `npm install radix-ui@latest`. This is the only install shown on the getting-started page.
- Import from the unified package: `import { Dialog } from "radix-ui";`, then `<Dialog.Root>`, `<Dialog.Trigger>`, and so on. The component pages use the same pattern for ContextMenu, DropdownMenu, Slider, Toast, Tooltip, and ScrollArea.
- Subpath entry, for tree-shaking: `import * as Popover from "radix-ui/popover";`.
- `asChild` on DOM-rendering parts: Radix clones the child and passes its props and behavior instead of rendering its own element.
- Child requirements: spread the incoming props onto the DOM node, and forward refs with `React.forwardRef`. Radix may attach a ref, for example to measure.

### Portals and containers
- Dialog, ContextMenu, DropdownMenu, and Tooltip use a `Portal` part. It takes `container` (default `document.body`) and `forceMount` (no default). Dialog's Overlay and Content go inside the Portal.
- Dialog's custom-container example sets an element from a ref callback into state, then passes it as `Dialog.Portal container={...}`.
- Toast has no Portal part. Its only container prop is the Provider's `announcerContainer` (default `document.body`). Toasts render into `Toast.Viewport`.

### ContextMenu (touch)
- Root: `modal` (default `true`), `open`, `onOpenChange`, `dir`.
- Trigger: `asChild` (`false`), `disabled` (`false`). Its `data-state` is open or closed.
- Opens at the pointer on right-click or long press. The features list says it "Triggers with a long press on touch devices."
- Content props: `loop` (`false`), `alignOffset` (`0`), `avoidCollisions` (`true`), `collisionPadding` (`0`), `sticky` (`"partial"`), `hideWhenDetached` (`false`). The table has no `side`, `sideOffset`, or `align` for Content, because it positions relative to the pointer.

### Dialog (focus)
- Parts: Root, Trigger, Portal, Overlay, Content, Title, Description, Close.
- Root: `open`, `defaultOpen`, `onOpenChange`, `modal` (default `true`).
- Content props: `forceMount`, `onOpenAutoFocus`, `onCloseAutoFocus`, `onEscapeKeyDown`, `onPointerDownOutside`, `onInteractOutside`. The page lists them without describing their behavior.
- A modal dialog traps focus and renders the underlying content inert. Esc closes it and moves focus to `Dialog.Trigger`.
- Title is announced on open. To hide it visually, wrap it in the Visually Hidden utility (`<VisuallyHidden asChild>`). That page was not fetched.
- Description is optional. **Correction, from the installed `@radix-ui/react-dialog` 1.3.1:** just omit the part. The docs also say to pass `aria-describedby={undefined}`, but `aria-describedby` now follows whether a `Dialog.Description` is mounted, and the code has no missing-title or missing-description warning.

### Slider
- Structure: `Slider.Root` contains `Slider.Track`, which contains `Slider.Range`. Render one `Slider.Thumb` per value.
- Root props and defaults: `defaultValue` and `value` (`number[]`), `onValueChange`, `onValueCommit`, `min` (`0`), `max` (`100`), `step` (`1`), `minStepsBetweenThumbs` (`0`), `orientation` (`"horizontal"`), `inverted` (`false`), `disabled` (`false`), `dir`, `name`, `form`.
- Inside a form, Root renders an `input` per thumb.
- Keyboard: ArrowRight and ArrowLeft step by `step`, with direction following orientation. ArrowUp and ArrowDown step up and down by `step`. PageUp, PageDown, Shift+ArrowUp, and Shift+ArrowDown use a larger step. Home sets the minimum and End sets the maximum.
- Pointer: click or touch on the Track sets the value, and the Thumb can be dragged.
- Caveat: `onMouseDown` and `onMouseUp` on Root do not fire. The docs recommend `onPointerDown` and `onPointerUp`.
- `Slider.unstable_ThumbProvider`, `unstable_ThumbTrigger`, and `unstable_BubbleInput` are marked unstable.

### Toast
- Provider props: `duration` (`5000`, unit not stated), `label` (required; default `"Notification"`), `swipeDirection` (`"right"`), `swipeThreshold` (`50`), `announcerContainer` (`document.body`).
- Viewport: `hotkey` (default `["F8"]`) and `label` (default `"Notifications ({hotkey})"`). Custom hotkeys use `event.code` values, e.g. `["altKey", "KeyT"]`.
- Root:
  - `type`: `"foreground"` (default) is announced immediately. `"background"` is announced at the next graceful opportunity and does not clear queued messages.
  - `duration` has no default and overrides the Provider's value, e.g. `duration={3000}`.
  - `defaultOpen` (`true`), `open`, `onOpenChange`, `onPause`, `onResume`, `onEscapeKeyDown`, `forceMount`.
  - Swipe callbacks: `onSwipeStart`, `onSwipeMove`, `onSwipeEnd`, `onSwipeCancel`.
- The timer pauses on hover, focus, and window blur.
- Swipe attributes: `data-swipe` is `start`, `move`, `cancel`, or `end`. `data-swipe-direction` is `up`, `down`, `left`, or `right`. CSS variables are `--radix-toast-swipe-move-x`, `--radix-toast-swipe-move-y`, `--radix-toast-swipe-end-x`, and `--radix-toast-swipe-end-y`.
- Action: `altText` is required. Toasts should not be held open for a user response. For that case, the docs say to portal an AlertDialog styled as a toast into the Viewport.
- Keyboard: F8 focuses the viewport. Esc closes a focused toast. Space or Enter on Action or Close closes it.

### Tooltip
- Provider: `delayDuration` (`700`), `skipDelayDuration` (`300`), `disableHoverableContent` (no default).
- Root: `delayDuration` (`700`), `open`, `defaultOpen`, `onOpenChange`, `disableHoverableContent`.
- Trigger: `asChild`. Its `data-state` is `closed`, `delayed-open`, or `instant-open`.
- Content: `side` (`"top"`), `sideOffset` (`0`), `align` (`"center"`), `alignOffset` (`0`), `avoidCollisions` (`true`), `aria-label`, `onEscapeKeyDown`, `onPointerDownOutside`.
- Opens on focus or hover. Tab opens or closes it without delay. Space, Enter, and Escape close an open tooltip.

### ScrollArea
- Parts: Root, Viewport, Scrollbar, Thumb, Corner. Scrollbar `orientation` defaults to `"vertical"`. Add a second Scrollbar with `orientation="horizontal"` for horizontal scrolling.
- Root: `type` (default `"hover"`; other values not listed), `scrollHideDelay` (`600`), `dir`, `nonce`, `asChild`.
- Scrolling is native. The scrollbar overlays content and takes no layout space. Keyboard scrolling is native too.

### Accessibility overview
- Radix follows the WAI-ARIA authoring practices and handles `aria` and `role` attributes, focus management, and keyboard navigation.
- Label custom controls with the `Label` primitive or ARIA naming. As an example, AlertDialog moves focus to Cancel on open.

## Motion (motion.dev, formerly Framer Motion)

### Package and import
- `npm install motion`. The installation page also shows yarn and pnpm.
- `import { motion } from "motion/react"`. Other imports shown in the docs also come from `motion/react`, including `AnimatePresence`, `MotionConfig`, `LayoutGroup`, `animate`, `useMotionValue`, `usePresence`, `usePresenceData`, `useIsPresent`, `arc`, and `correctParentTransform`.
- RSC and Next.js: `import * as motion from "motion/react-client"`. The docs say this reduces JS sent to the client. It does not apply to a Vite SPA (inference).
- Minimum React is 18.2 ("only compatible with React versions 18.2 and higher"). React 19 is not named.
- The quick start's npm link points to `framer-motion`. The package to install is `motion`.

### Animation basics
- `<motion.div animate={{ x: 100 }} />`. `initial={false}` skips the enter animation.
- Physical properties (`x`, `scale`) default to spring physics. Visual properties (`opacity`, colors) default to eased tweens.
- Gesture props: `whileHover`, `whileTap`, `whileFocus`, `whileDrag`, `whileInView`.
- `transition` sets timing per animation prop. `<MotionConfig transition>` sets a fallback for child components.
- Variants use string labels through `variants`. `custom` feeds dynamic variants. Orchestration uses `when`, `delayChildren`, and `stagger()`.
- Keyframes are arrays. `null` is a wildcard that means "current value". `transition.times` sets keyframe positions.
- Imperative: `useAnimate` for sequencing. `animate(motionValue, target, options)` for MotionValues.
- CSS variables work as targets, e.g. `backgroundColor: "var(--action-bg)"`. This also works with Tailwind theme variables.

### AnimatePresence
- Works on direct children only. Each child needs a unique, stable `key`. Index keys break tracking.
- Keep `AnimatePresence` mounted and put the conditional inside it.
- Props:
  - `initial={false}`: children present on first render get no initial animation.
  - `custom`: passed to dynamic exit variants, and read by children with `usePresenceData`.
  - `onExitComplete`.
  - `mode`: default `"sync"`.
  - `propagate`: default `false`. Without it, a nested AnimatePresence stops the parent's exit animations.
  - `root`: default `document.head`. Set a ShadowRoot for shadow DOM.
- Modes:
  - `sync`: enter and exit happen immediately, with no layout coordination.
  - `wait`: the entering child waits for the exiting one. The docs say it supports one child at a time.
  - `popLayout`: the exiting child is taken out of flow so siblings reflow. Pair it with `layout`. Custom component children must forward their ref. The animating parent needs a `position` other than `static`.
- Hooks: `usePresence()` returns `[isPresent, safeToRemove]`. `usePresenceData()` reads `custom`. `useIsPresent()` is the code import; the prose says `useIsPresence`.

### MotionConfig and reduced motion
- `import { motion, MotionConfig } from "motion/react"`. It applies to all child motion components.
- `reducedMotion` default is `"never"`. Values: `"user"` (respect the device setting), `"always"` (force, for debugging), `"never"`.
- When reduced motion is on, transform and layout animations are disabled. Other animations, such as opacity and backgroundColor, keep running.
- Other props: `transition`; `transformPagePoint` (default is identity, with `correctParentTransform(ref)` for scaled parents and `transformViewBoxPoint` for SVG); `nonce` for CSP.
- Tailwind's `motion-reduce:` changes CSS only. Motion's JS animations follow the OS setting only if `reducedMotion="user"` is set (inference from the default).

### Layout animations
- `layout` (`true`) animates size and position with transforms and corrects scale distortion. `layout="position"` or `layout="size"` animates only that axis.
- `layoutId` makes a shared-element transition. If the old element is still mounted, the two crossfade. Wrap it in `AnimatePresence` to animate it out.
- `layoutDependency` limits measurement to when the given value changes.
- `layoutAnchor` defaults to `{ x: 0, y: 0 }`, takes 0 to 1 progress values, and `false` disables relative projection.
- `layoutScroll` goes on scrollable ancestors. `layoutRoot` goes on `position: fixed` ancestors.
- `LayoutGroup` syncs layout animations across components that don't re-render together.
- Customize with `transition={{ duration }}`, or a dedicated `transition={{ layout: { duration } }}`. The path option is `transition.layout.path`, set with `arc()`.
- Rules from the docs:
  - Change layout through `style` or `className`, not through `animate` or `whileHover`.
  - Add `layout` to children to counter distortion.
  - `borderRadius` and `boxShadow` get corrected only when set through `style` or animate props.
  - Changing `border` triggers layout recalculation. The docs suggest a padded wrapper instead.
  - SVG is unsupported. `display: inline` elements can't be transformed. Layout animations are blocked during horizontal window resize.

### Compositor and performance
- The hybrid engine runs animations natively through the Web Animations API and ScrollTimeline. It falls back to JavaScript for spring physics, interruptible keyframes, and gesture tracking.
- The `<motion />` component animates `transform` and `opacity` on the compositor where possible, avoiding layout and paint. Prefer these over `width` or `top`.
- Independent transforms (`x`, `y`, `scale`, `rotate`, `skew`) and the `transform` property are hardware accelerated.
- Layout animations are transform-based (translate plus scale).
- Animating a CSS variable always triggers paint. Use a MotionValue instead.
- MotionValues (`useMotionValue`, or `style={{ x }}`) update without React re-renders.
- Inference: for hot paths, prefer transform and opacity tweens, since springs run through JavaScript.

### Bundle size
- The docs say Motion is tree-shakable, so you only include what you import.
- The docs say the layout animation engine is "around 12kb."
- `motion/react-client` is the RSC option (see above).
- LazyMotion and mini or `m` builds are not covered by any page read. They were not fetched.

### Refs
- `motion.create(Component)`: the component must pass a ref to the element being animated. React 18 uses `forwardRef`. React 19 can read `props.ref`. Don't call `motion.create` inside render.

## Settled by running them (Phase 1)

Tailwind 4.3, Radix 1.8, Motion 14.8, React 19.3, Chromium 156.

**Inline styles and a strict CSP** (`style-src 'self'`, no `'unsafe-inline'`):
- Tailwind injects nothing. All its output is in the built stylesheet.
- Motion's plain animations set properties through CSSOM, which `style-src` doesn't block, and they're fine with no change.
- Motion's `AnimatePresence mode="popLayout"` appends an empty `<style>`, then fills it with `insertRule`. The empty tag needs the hash of the empty string, `sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=`. The CSSOM rule itself isn't blocked.
- Radix's modal parts (Dialog, and DropdownMenu and ContextMenu with their default `modal`) inject a stylesheet through `react-remove-scroll-bar`. It was byte-identical across six zoom levels and five window sizes, hash `sha256-nzTgYzXYDNe6BAHiiI7NNlfK8n/auuOAhh2t92YvuXo=`. If an upgrade changes it, the console prints the new hash. Blocked, it costs nothing, since `body` never scrolls here, but it logs an error.

**Tailwind:**
- Redefining `--spacing` rescales the whole numeric scale as the notes inferred, and a value can be `calc(var(--spacing-cell) * 0.3)`.
- `--spacing-row` in `@theme` gives `h-row`, `px-row` and so on. `@custom-variant x (@media (…))` works. Primitives in `@theme` that `:root` references through `var()` are emitted.
- `@import '@fontsource-variable/inter/opsz.css'` works from the CSS entry and rewrites its font URLs. The family is `'Inter Variable'`, and `font-optical-sizing: auto` then uses the display cut at large sizes, so it needs less negative tracking than the text cut.
- `font-optical-sizing: auto` picks the cut from CSS pixels, not from how big text looks. Widths per em fell 6.7% between 14px and 30px, so UI text on the TV got the tighter cut, and a tab at 2x wasn't 2x as wide. `none` on `body` keeps it at the text cut at every size, and the big variants turn the cut back on.
- `cqi` is a percentage of the container's content box, so padding on the container counts against it.
- Chromium 156 has typed arithmetic: `calc(100vh / 480px)` is a number, usable in `min()` with one. Lightning CSS leaves it alone in a custom property.

**tailwind-merge:** without `extendTailwindMerge({ extend: { theme: { text: […], spacing: […] } } })`, it takes `text-body` for a color and drops it next to `text-text-muted`, and it doesn't know `h-row` conflicts with `h-4`.

**Radix and React 19:** `asChild` works on a plain function component that takes `ref` as a prop, so `forwardRef` isn't needed. A wrapper between a trigger and its child has to forward what it's handed: `<DropdownMenu><Tooltip><Button /></Tooltip></DropdownMenu>` only works when `Tooltip` passes its other props and `ref` on to its own `Trigger`. Otherwise the menu stays dead, with no type error.

**Radix popups:**
- `sideOffset` is a pixel number, so it doesn't scale. A margin through `data-[side=top]:mb-1` and so on does, since the wrapper measures its content's margin box. `collisionPadding` only takes a number.
- `Dialog.Close asChild` composes with the child's `onClick`, which runs first. Its `preventDefault()` keeps the dialog open.
- Menu items take real focus on hover. `:focus-visible` stays off for a menu opened with the mouse, so a ring only shows for the keyboard, unless the trigger already had a keyboard ring when it was clicked.
- Toast swipes: Radix sets `data-swipe` and the `--radix-toast-swipe-*` variables, and moves nothing itself. Without `touch-none` a finger's drag becomes a pan.

**Tooltip in tests:** after earlier pointer moves, Playwright's `hover()` sometimes doesn't open a Radix tooltip. A second small `mouse.move` on the trigger fixes it. The cause isn't confirmed, though Radix does track a pointer "in transit" after it leaves a trigger.

## Settled by running them (Phase 2)

**Radix Tabs:** the trigger calls `event.currentTarget.focus()` on mousedown. Chromium shows a ring for script focus unless the last focus came from the mouse, so the first tab clicked in a session lights up, and every tab clicked after it, until something else takes focus with the mouse. `onMouseDown` with `preventDefault` on the Trigger stops that and also stops Radix choosing the tab, so `onClick` does it. A controlled Root doesn't call `onValueChange` for the tab that's already active. With `activationMode="automatic"` tabbing through the tabs activates them, and with no tab active the first one is taken as soon as it's reached.

**Container queries:** `em` in a query condition is the container's own font size, so a query can follow the fluid type even though it can't use `var()`. `--container-wide: 52em` in `@theme` gives `@wide:`, and `calc(12em + 140px)` works too, for a condition that's part fixed. Variants stack: `side-by-side:@max-header:order-last`. An element with `container-type: inline-size` has no intrinsic width, so as a wrapping flex item it needs a `min-width`, or it never wraps.

**Flex items:** `shrink-0` on a wrapping tab list keeps it at its one-line width, so it overflows instead of wrapping.

## Settled by running them (Phase 3)

**The build rewrites tokens:** Lightning CSS turns `--dur-mid: 300ms` into `.3s` in a custom property, so anything reading one from script has to go by the unit.

**Tailwind transforms:** `scale-x-0`, `scale-y-50` and the `translate-*` family set the separate `scale` and `translate` properties, which multiply with whatever `transform` says, from an inline style or a keyframe. An element moved through `style.transform` can't have one of them as its starting point.

**Scrollable overflow counts transforms.** A layer moved along with `translateX` makes `scrollWidth` grow on every ancestor, including an `overflow: hidden` one, which script and focus can still scroll. `overflow-x: clip` around it stops that, and leaves `overflow-y` visible.

**A click says what made it,** in Chromium, as a `PointerEvent`: `pointerType` is `mouse`, `touch` or `pen`, and `''` from the keyboard, where `detail` is 0. `detail` counts: a double-click is a click with 1 and a click with 2, and a double tap the same. So one `onClick` can tell all of them apart, and `dblclick` isn't needed.

**Radix Slider:**
- It only reports a value that differs from the one it was given, and `onValueCommit` the same, against the value when the press began. A value no pointer can land on, such as -1 with a `min` of 0, makes it report every move.
- `onKeyDown` on the Root runs first, and one that calls `preventDefault` stops its stepping. The same goes for `onPointerDown`, which it needs, because it starts a drag on any button.
- Its Thumb's wrapper sits at `left: calc(x% + offset)`, worked out from the thumb's measured size, so a thumb of `size-0` never moves or re-renders by itself when its value doesn't.

**Radix ContextMenu:**
- `open` on the Root works, so a controlled `onOpenChange` can turn a menu down, for a press on something that shouldn't have one.
- The trigger can be a `display: contents` element around a whole list: it only needs the events that bubble, and the menu goes by the pointer.
- A long press opens it after 700 ms, with the finger still down, unless a move or a cancel comes first. It sets `WebkitTouchCallout: none`. The click that follows the release lands on `<html>`, because a modal menu sets `pointer-events: none` on the body, so the row under the finger doesn't get it.
- Shift+F10 opens it for what has focus, and Escape closes it and gives focus back, marking the event as used.

**Motion:**
- An animation with a `duration` of 0 still mounts at `initial` for a frame, and `onAnimationComplete` runs before that frame is painted over. Under reduced motion, where a token gives 0, render with `initial={false}` instead.
- Numbers only: there's no reading a CSS variable for a `transition`, so `lib/motionTokens` reads the token and hands over seconds.

**A looping CSS animation has the compositor drawing a frame per refresh,** even with `steps()`, for as long as the element is on screen. Three small bars took the GPU process from under 1% of a core to about 9%, on a 100 Hz display with a 4K back buffer, and writing their transforms from a timer eight times a second took it to about 2%.

**The playing bars are that CSS animation now, by choice** (2026-10-31): at 4 frames a second they looked like a slideshow, and Levan asked for them to really move. So the cost below is accepted, and only while the current row is on screen. Measured on the built app, playing silently, in a 1920x1080 window kept on top, with `npm run dev` open beside it:

| While it plays | Frames a second | GPU process, % of a core | Renderer, % of a core | GPU main-thread tasks of 40 ms or more in 30 s | Longest |
| --- | --- | --- | --- | --- | --- |
| No bars on screen, seekbar's tick alone | 3 to 4 | 2 | 2 to 2.4 | 26 and 28 | 526 ms |
| Bars on screen | 101 | 23 | 8 | 0 | none |
| Bars on screen, paused | 0 | 0.1 | 0.1 | 0 in 20 s | none |

The percentages are without tracing, which added about 5 to the GPU and renderer with bars on screen. The GPU figure is well over the earlier 9%. The stalls went the other way: it was the 4 frames a second that had them, where the table below has 0 to 1 at that rate. So that table may not hold for the app as it is now, or for every run, and this was one machine on one evening. The task the slices are in is `ThreadControllerImpl::RunTask`, and the trace doesn't say more.

**Frames 5 to 20 times a second stall the GPU process on my laptop** (Zenbook, Iris Xe, driver 31.0.101.4255, 120 Hz OLED). About once a second a `DXGISwapChainImageBacking::Present` or a `SkiaOutputSurfaceImplOnGpu::FinishPaintRenderPass` holds the GPU main thread for 50 to 450 ms, however little changed: it did it for 4x7 pixels. The page can't see why: a `long-animation-frame` entry shows `scripts: []` and no render time. A bare page in Electron does the same, three small bars on an interval, with none of this app in it:

| Frames a second | Stalls of 40 ms or more in 15 s | How long |
| --- | --- | --- |
| 4 | 0 to 1 | up to 99 ms |
| 5 to 6 | 7 to 13 | 43 to 238 ms |
| 8 | 12 to 15 | 156 to 265 ms |
| 10 | 12 | 230 to 311 ms |
| 16 to 20 | 10 to 13 | 353 to 423 ms |
| 30 | 1 | 453 ms |

`will-change: transform` only moves it from `Present` to `FinishPaintRenderPass`, with as many stalls. `--disable-direct-composition`, `--disable-gpu-vsync` and `--disable-gpu-rasterization` don't get rid of it either. So the player presents 4 frames a second, all in one tick, other than the playing bars since the choice above. With the bars on screen, back when they were in that tick, and nothing being touched, that took it from 17 stalls in 22 s to none in 60 s. Nothing else on this machine was using the GPU, and it's not known what's underneath, or whether other machines do it.

What's left is the first moments of a scroll, in the same two places in the GPU process. Real wheel input (`Input.dispatchMouseEvent` over CDP) stops for 100 to 500 ms on some bursts: a bare page with a long list on 2 of 25, the player with nothing playing on 3 of 25, and playing on 5 of 25. After a lot of scrolling it's more: 8 to 12 of 25 with nothing playing, and 10 to 17 playing. A run of frames from script straight after another, which is how the frame times above and in Phase 2 were taken, doesn't show it.

**A trace of it:** `contentTracing` writes Perfetto protobuf. CDP's `Tracing.start` on a page session, with `transferMode: 'ReturnAsStream'` and `streamFormat: 'json'`, then `IO.read` on the stream it gives back, gets all the processes as JSON.

**Radix Popover:** isn't modal by default, so it needs no scroll lock and adds no style tag. Escape closes it and gives focus back to its trigger, marking the event as used. `--radix-popover-content-available-width` works in `max-w-(…)`.

**Touch in Playwright:** `page.touchscreen` refuses a page that wasn't made with `hasTouch`, and Electron has no such option. `page.context().newCDPSession(page)` and `Input.dispatchTouchEvent` go through Chromium's gesture recognizer like a real finger, and give a `click` with `pointerType: 'touch'`.

## Not settled by docs
- ContextMenu long press: text selection, and any platform limits.
- DropdownMenu: which pointer event opens it on touch.
- Tooltip: touch behavior, and whether Provider is strictly required. The page only says it "wraps your app."
- Slider: when `onValueCommit` fires.
- Dialog: the default initial focus target, the default behavior of the `*AutoFocus` handlers, and any warning when Title is missing.
- ScrollArea: `type` values other than `"hover"`, and any CSS sizing requirements.
- Toast: the unit for `duration`.
- Motion reduced motion: no `useReducedMotion` hook appears in pages read. The dedicated reduced-motion page returned 404.
- Motion bundle size: LazyMotion and mini or `m` builds. The LazyMotion page was not among the given URLs, and no page read links to it, so it was not fetched.
- Motion compositor: which non-transform properties (filter, mask-image, box-shadow, backgroundColor) stay off the main thread.
- Radix version: no version-specific notes. Only `radix-ui@latest` appears.
- Tailwind changes after v4.0: no changelog was read. The upgrade guide covers v3 to v4.0 only.
