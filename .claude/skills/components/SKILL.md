---
name: components
description: Use when writing or reviewing React components, hooks or JSX in src/renderer. Covers exports, props, effects, async states, splitting, accessibility, touch and keyboard.
---

# Component conventions

Before writing React, skim `docs/research/react-state.md` and `docs/research/ui-stack.md`. The Vercel rules that apply to a client-only SPA are listed there. Follow them, especially the re-render ones.

## Shape & exports

- Named function declarations: `export function TrackRow({ track }: Props) { … }`.
- One exported component per file, named after the file. Small private helpers may sit unexported in the same file while they're used once.
- Never define a component inside another component.

## Props

- Declared above the component, `type`, not `interface`.
- Not exported → `Props`. Exported → `<Component>Props`. Never `PropsType`.
- Destructure in the signature, with `className` and `...props` last.
- Wrapping one element: `type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }`, then spread.
- Reusable components accept `className` and merge it last through `cn()`.

## useEffect: never inline

**`useEffect` only lives in a custom hook in a `.ts` file**, named for its purpose (`useScrollLock`). Lint fails it in `.tsx`. Same spirit for gnarly `useMemo`/`useCallback` chains: if it's logic, it's a hook.

Most effects shouldn't exist. Derive during render, handle things in event handlers, use `useSyncExternalStore` for external sources. See "You Might Not Need an Effect" in the research notes.

## Data and async states

Database reads are TanStack Query through `lib/`. Every view handles four states as early returns before the main JSX:

```tsx
const albums = useAlbums();

if (albums.isPending) return <AlbumGridSkeleton />;
if (albums.isError) return <ErrorState error={albums.error} onRetry={albums.refetch} />;
if (albums.data.length === 0) return <EmptyState title="No albums yet" action={…} />;

return <AlbumGrid albums={albums.data} />;
```

Never render the main JSX with silently missing data. An empty array is a normal state with a next step, never a crash.

## Playback state

- Read with narrow Zustand selectors: `usePlayer((s) => s.status)`. In Zustand 5 a selector returning a new object each time causes an infinite loop: use `useShallow` or select primitives.
- **Position is transient.** It changes constantly, so it never lives in React state. The seekbar reads it through a ref-based hook and writes to the DOM with `requestAnimationFrame`.
- Commands go through `lib/api`, and React never decides what plays next. It sends a command and renders the state main sends back.

## Long lists

Anything that can reach thousands of rows uses `@tanstack/react-virtual` through `components/music`. Rows must be cheap: no per-row effects, stable handlers, stable keys from ids.

## JSX stays simple

- Readability beats compactness.
- Ternaries are fine with exactly 2 outcomes. **No nested ternaries.** Use early returns or a named variable above the `return`.
- For conditional rendering where the left side could be `0` or `''`, use a ternary rather than `&&`.
- Anything conceptually complex gets a named variable above the return.

## Buttons and text

- `<Button>` for everything clickable that acts. Never a bare `<button className="…">`. Missing look? Add a variant.
- `<Text>` for copy, with `variant` and `color`. `className` on Text is layout only. Writing `font-` or `text-` on it means a variant is missing.
- Buttons never move on interaction: hover darkens, active scales to 0.97, focus-visible shows a ring.

## Splitting

Past about 200–300 lines, check whether the file does two jobs. Below that, prefer fewer files. Never split just to hit a line count.

## Input: every screen, three ways

The same app runs on a 10" touch laptop and a 65" TV with a keyboard.

- **Touch:** targets at least `size-tap` (44px). No hover-only affordances. Context menus also open on long-press (Radix ContextMenu does this). `touch-action` set deliberately on sliders and draggable things.
- **Keyboard:** everything reachable and operable. Visible `focus-visible` ring, big enough to see from a couch. Lists use one tab stop with arrow-key navigation. Escape closes and goes back.
- **Mouse:** hover states through Tailwind's default `hover:`, which only applies on devices that can hover.

## Accessibility

- Semantic elements first, then ARIA.
- Interactive state gets matching ARIA (`aria-pressed`, `aria-current`, `aria-selected`).
- Sliders and menus come from Radix, so their keyboard and ARIA behavior is already right.
- Icon-only buttons need an `aria-label`.
- Motion respects reduced-motion through `MotionConfig reducedMotion="user"`.

## Error boundaries

Each feature mounted in `app/` sits in its own boundary. A throw shows "Try again" in that panel, gets logged through IPC, and playback continues.
