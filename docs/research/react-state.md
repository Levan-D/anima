# React 19, Zustand 5, TanStack Query 5, TanStack Virtual 3, and Vercel React rules: reference notes

## Sources

Read successfully:
- React (react.dev): https://react.dev/learn/you-might-not-need-an-effect (rules and Recap verbatim; the Challenges section came only through a model summary), https://react.dev/reference/react/useSyncExternalStore, https://react.dev/reference/react/useEffectEvent, https://react.dev/reference/react/Activity, https://react.dev/reference/react/useTransition, https://react.dev/reference/react/useDeferredValue, https://react.dev/reference/react/useOptimistic, https://react.dev/reference/react-dom/client/createRoot, https://react.dev/reference/react/Component (error-boundary section verbatim)
- Zustand: https://zustand.docs.pmnd.rs/ (navigation only), https://zustand.docs.pmnd.rs/learn/getting-started/introduction, https://zustand.docs.pmnd.rs/learn/guides/updating-state.html, https://zustand.docs.pmnd.rs/learn/guides/prevent-rerenders-with-use-shallow.html, https://zustand.docs.pmnd.rs/learn/guides/beginner-typescript.html, https://zustand.docs.pmnd.rs/reference/hooks/use-shallow.html, https://zustand.docs.pmnd.rs/reference/migrations/migrating-to-v5.html, https://zustand.docs.pmnd.rs/reference/apis/create-store.html, https://zustand.docs.pmnd.rs/reference/hooks/use-store.html
- TanStack Query v5 (react), all under https://tanstack.com/query/v5/docs/framework/react/: guides/important-defaults, guides/queries, guides/query-invalidation, guides/query-keys, guides/query-functions, guides/mutations, guides/optimistic-updates, guides/network-mode, guides/migrating-to-v5, reference/useQuery, reference/QueryClient
- TanStack Virtual v3: https://tanstack.com/virtual/latest/docs/api/virtualizer, https://tanstack.com/virtual/latest/docs/framework/react/react-virtual, https://github.com/TanStack/virtual/blob/main/examples/react/dynamic/src/main.tsx, https://github.com/TanStack/virtual/blob/main/examples/react/window/src/main.tsx (reached through the examples/react/dynamic/src and examples/react/window/src folder listings)
- Vercel: https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/react-best-practices/AGENTS.md (read in full; "React Best Practices" v1.0.0, January 2026)

Failed, not retried (sending these again would fail the same way):
- https://zustand.docs.pmnd.rs/reference.html: HTTP 404
- https://tanstack.com/virtual/latest/docs/framework/react/examples/dynamic: HTTP 404 (GitHub source used instead)
- https://tanstack.com/virtual/latest/docs/framework/react/examples/window: HTTP 404 (GitHub source used instead)

## React 19

### createRoot
- `createRoot(domNode, options?)`. Options: `onCaughtError(error, errorInfo)`, `onUncaughtError(error, errorInfo)`, `onRecoverableError(error, errorInfo)`, `identifierPrefix` (for `useId`). `errorInfo.componentStack` is passed to each handler.
- Handler options go to `createRoot`, never to `root.render`, which takes one argument. Without handlers, React logs errors to the console.
- Usually one root per app; `root.render` can be called again to update. After `root.unmount()`, rendering that root throws "Cannot update an unmounted root"; create a new root on the node.

### Error boundaries
- Must be a class. `static getDerivedStateFromError(error)` returns fallback state and must be pure. Optional `componentDidCatch(error, info)` handles side effects such as logging; `info.componentStack` is available.
- Not caught: event handlers, server rendering, errors thrown by the boundary itself, and async callbacks (setTimeout, requestAnimationFrame). Exception: errors thrown inside a `startTransition` action reach the nearest boundary.
- In development, errors caught by `componentDidCatch` still bubble to `window`; in production they don't. There is no function form; the page points to the `react-error-boundary` package.

### Effects: do and don't
Do:
- Compute values during render from props and state (`const fullName = first + ' ' + last`). Add `useMemo` only for measured-expensive pure work.
- Put logic caused by a user action (submit, click) in the event handler.
- Use an Effect only to sync with an external system, or for work that should run because the component appeared (for example, a mount analytics event).
- Reset all state for a new entity by passing `key={id}` to the stateful child.
- Store the selected ID and derive the selected object during render.
- Update several components in one event handler; lift state up instead of syncing two states.
- Subscribe to mutable external stores with `useSyncExternalStore`.
- If an Effect fetches data, return a cleanup that ignores stale responses (`let ignore = false` ... `return () => { ignore = true; }`).
- Run once-per-app setup from a module-level guard or the root module, not a component Effect.
- Chaining Effects is acceptable only when each step synchronizes with the network (the page's dependent-dropdown case).

Don't:
- Copy props or state into state with an Effect (`setFullName` inside `useEffect`).
- Chain Effects that exist only to set state that triggers the next Effect; compute the next state in one handler.
- Reset state in an Effect on prop change (`useEffect(() => setComment(''), [userId])`); use a key.
- Pass child data up through an Effect; fetch in the parent and pass down, or call the parent callback in the same event.
- Use "adjust state during render" by default. It is the narrow fallback: same-component state only, guarded (for example `if (items !== prevItems)`).
- Assume mount Effects run once; StrictMode runs them twice in development.

### useEffectEvent
- Status: the fetched page shows no experimental or canary marker and no version. The stabilization version is not stated.
- Signature: `const onEvent = useEffectEvent(callback)`.
- Call only at the top level of a component or custom Hook, and only from Effects (useEffect, useLayoutEffect, useInsertionEffect) or other Effect Events in the same component. Never call during render, from event handlers, or pass to children or other Hooks. eslint-plugin-react-hooks enforces this.
- Never list an Effect Event in a dependency array (lint error). Its identity changes every render by design.
- Not a way to skip real dependencies. Use it for logic that should read latest values without re-running the Effect (the page's example reads `muted` without reconnecting).

### useSyncExternalStore
- `const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot?)`.
- `subscribe(callback)` returns an unsubscribe function. Pass a stable function (module scope, or `useCallback` with stable deps); a different `subscribe` on re-render causes resubscription.
- `getSnapshot()` must return the same value (compared with Object.is) while the store is unchanged, and the value must be immutable. Return the store's own reference (`store.todos`), never a new object literal. A new object per call produces the error "The result of getSnapshot should be cached" and an infinite loop. For mutable stores, cache the last snapshot and replace it only on change.
- `getServerSnapshot` runs only during server rendering and hydration. Omitting it is fine for a client-only app; server rendering without it throws.
- Don't suspend renders based on store values. Store updates cannot be non-blocking Transitions, so the nearest Suspense fallback replaces visible content.
- If the store changes during a non-blocking Transition, React re-reads `getSnapshot` before commit and reruns the update as blocking.
- The page recommends `useState` or `useReducer` when you own the state.

### Activity
- `<Activity mode="visible" | "hidden">`; `mode` defaults to visible.
- Hidden: children get `display: none`, their Effects are cleaned up, and their state and DOM are kept. Children still re-render, at lower priority.
- Visible again: state is restored and Effects are recreated.
- Hidden on first render: children pre-render without mounting Effects. Only data read through a Suspense-activating source (such as `use(promise)`) is pre-fetched; Effect-fetched data is not.
- Caveats: a hidden component that renders only text produces no DOM. For `<video>`, `<audio>`, and `<iframe>`, DOM side effects persist while hidden, so add a `useLayoutEffect` cleanup (for example `pause()`). StrictMode toggles Activity to expose missing cleanup.

### useTransition
- `const [isPending, startTransition] = useTransition()`. Takes no arguments and returns exactly two items.
- `startTransition(action)` runs `action` synchronously; only `set` calls made during that synchronous run become Transitions. Calls inside a `setTimeout` do not.
- After an `await` inside an action, wrap later `set` calls in another `startTransition`.
- Transitions cannot control a controlled text input. Keep a synchronous state for the input and derive the rest with a Transition or `useDeferredValue`.
- Transitions can be interrupted by other updates, and multiple Transitions are batched.
- `isPending` turns true at the first `startTransition` call and stays true until all actions finish.
- Errors thrown or rejected in an action reach the nearest error boundary.
- The standalone `startTransition` imported from react has no `isPending`, and error boundaries cannot catch its errors.
- Actions within one Transition do not guarantee completion order; use `useActionState` for ordered async state.
- The `startTransition` identity is stable, so it can be omitted from Effect deps.

### useDeferredValue
- `useDeferredValue(value, initialValue?)`. Without `initialValue`, the first render returns `value` with no deferral.
- On update: a render with the old value first, then a background render with the new value. New input interrupts the background render.
- Inside a Transition, it returns the new value directly.
- Wrap the slow child in `memo`, or the background render still re-renders it. Pass primitives or objects created outside render; a new object per render forces background re-renders.
- If the background render suspends, the old value stays visible (no fallback). Effects from background renders run after commit.
- It does not prevent extra network requests. Compare `query !== deferredQuery` for a stale indicator.

### useOptimistic
- `const [optimisticState, setOptimistic] = useOptimistic(value, reducer?)`.
- Call the setter only inside an Action: a `startTransition` callback, or an `action` prop (already inside a transition). Outside one, React logs an error and the optimistic value flashes and reverts.
- Never call the setter during render ("Cannot update optimistic state while rendering").
- The optimistic value shows only while the Action is pending. After it finishes, `value` is shown, so update the source state on success. On failure, `value` stays and the UI reverts.
- The reducer must be pure. React reruns it when `value` changes mid-Action, so use a reducer for lists.
- Pending check: `optimisticState !== value`, the page's approach.

## Zustand 5

### Creation (TypeScript)
- `import { create } from 'zustand'`. v5 drops default exports.
- TS pattern: `interface BearState { bears: number; increase: () => void }` then `export const useBearStore = create<BearState>()((set) => ({ bears: 0, increase: () => set((s) => ({ bears: s.bears + 1 })) }))`. The curried `create<T>()(...)` is the TS form; the JS form is `create((set) => ({...}))`.
- `ExtractState<typeof useBearStore>` (exported from 'zustand') gives the state type.
- `persist`, `devtools`, and `combine` come from 'zustand/middleware'. In v5, `persist` no longer writes initial state at creation; call `setState` after creation if it must be stored.

### Updates
- `set(partial)` shallow-merges. `set(next, true)` replaces state; in v5 TypeScript, a replace requires a complete state object (`setState({}, true)` is a type error).
- For nested objects, spread each level, or use the Immer middleware (`set(produce((s) => { ... }))`). The guide also mentions optics-ts and Ramda (not read).

### Selector stability and infinite loops
- v5 compares selector results with Object.is. A selector that returns a new object or array on each call, such as `useStore((s) => [s.searchValue, s.setSearchValue])`, throws "Maximum update depth exceeded" in v5.
- Fixes: (a) wrap the selector in `useShallow`; (b) use one selector per value (`useStore((s) => s.searchValue)`); (c) use a module-level constant for fallbacks (`const FALLBACK_ACTION = () => {}`, then `s.action ?? FALLBACK_ACTION`).
- v5 `create` takes no equality argument. For v4 behavior, use `createWithEqualityFn` from 'zustand/traditional', which needs the `use-sync-external-store` peer dependency.

### useShallow
- Signature: `useShallow<T, U = T>(selectorFn: (state: T) => U): (state: T) => U`.
- Usage: `useStore(useShallow((s) => ({ a: s.a, b: s.b })))`. It returns a memoized selector that shallow-compares the result's entries.
- Import path is 'zustand/react/shallow' in the reference and guides (see Not settled).

### Vanilla stores and subscribe
- `import { createStore } from 'zustand/vanilla'` (also exported from 'zustand'). `createStore<T>()((set, get, store) => ({...}))` returns a `StoreApi<T>` with `getState`, `setState`, `getInitialState`, and `subscribe`.
- Don't call `set`, `get`, or `store` synchronously during initialization.
- Outside React: `store.subscribe(listener)`. The examples subscribe a render function that reads the state argument, and call it once with `getInitialState()` to paint the first frame. Multiple listeners are allowed.
- In React: `useStore(store, selectorFn?)`, signature `useStore<T, U = T>(store: StoreApi<T>, selectorFn?: (state: T) => U): U`.
- Scoped stores: create with `useState(() => createStore(...))` inside a provider, pass through context, then call `useStore(store, selector)`.

## TanStack Query 5 (React)

### Defaults
| Option | Default | Notes |
|---|---|---|
| staleTime | 0 | number, `Infinity`, or `'static'` |
| gcTime | 5 min (300000 ms) | inactive queries; `Infinity` disables GC; max about 24 days |
| retry | 3 on client, 0 on server | `false`, `true`, number, or `(failureCount, error) => boolean` |
| retryDelay | exponential, capped at 30 s | number or `(attempt, error) => number` |
| networkMode | `'online'` | also `'always'`, `'offlineFirst'` |
| refetchOnMount | `true` | `'always'` refetches even when fresh (not with `'static'`) |
| refetchOnWindowFocus | `true` | |
| refetchOnReconnect | `true` | `false` when networkMode is `'always'` |
| refetchInterval | `false` | polling, independent of staleTime |
| throwOnError | `false` | |
| placeholderData | `undefined` | |
| structuralSharing | `true` | |
| enabled | `true` | |

### networkMode for a local named-pipe source
- Set `networkMode: 'always'` on each query, or globally in `defaultOptions.queries`. Queries never enter `paused`, retries don't pause, and failures go straight to `error`.
- With `'always'`, `refetchOnReconnect` defaults to false.
- `'online'` (default) pauses queries and mutations when TanStack sees no connection (`fetchStatus: 'paused'`). In v5, online status starts as online and follows the online/offline events, not `navigator.onLine`.
- `'offlineFirst'` runs the queryFn once and then pauses retries. It doesn't fit an always-local source.
- Mutations accept `networkMode` too. Default-mode mutations queue offline and resume in order.

### retry
- Disable with `retry: false`, per query or in defaults. Mutations do not retry by default; set `retry` to enable.
- `queryClient.query()` disables retries unless `retry` is set.
- `setQueryDefaults` merges matching registrations in registration order, so register generic keys first and specific keys after.

### staleTime for data that changes only through invalidation
- Use `staleTime: Infinity`. The query never goes stale by itself, but `invalidateQueries` still marks it stale and refetches active queries.
- Don't use `'static'` here. It blocks invalidation (`invalidateQueries` has no effect) and also blocks `'always'` refetch settings. Use `'static'` only for data that cannot change while the app runs (boot flags, login-time permissions).

### throwOnError
- `false` (default): failures go to `error` state.
- `true`: failures throw to the nearest React error boundary, so wrap the component.
- `(error, query) => boolean`: decide per error.
- v5 renamed `useErrorBoundary` to `throwOnError`.

### placeholderData replaces keepPreviousData
- v5 removed the `keepPreviousData` option and the `isPreviousData` flag.
- Replacement: `import { keepPreviousData } from '@tanstack/react-query'` and `placeholderData: keepPreviousData` (an identity function). Read `isPlaceholderData` instead of `isPreviousData`.
- Caveats: placeholder data always gives `success` status (old `keepPreviousData` could carry an `error` status); `dataUpdatedAt` stays 0 while placeholder data shows; `useQueries` does not receive previous data.

### Keys, query functions, invalidation
- Query keys are arrays. Object key order doesn't matter; array order does. Include every variable the queryFn reads.
- The queryFn must throw or reject to signal failure. Resolving `undefined` counts as failure; resolve `null` for "nothing".
- `fetch` doesn't reject on HTTP errors; throw when `!response.ok`.
- queryFn context: `queryKey`, `client`, `signal`, `meta`.
- `status` (pending/error/success) describes data; `fetchStatus` (fetching/paused/idle) describes the queryFn.
- `invalidateQueries({ queryKey: ['todos'] })` matches by prefix; `exact: true` and `predicate` narrow it. It marks matches stale (overriding staleTime) and refetches active ones by default (`refetchType` defaults to `'active'`).
- Other cache APIs: `refetchQueries`, `cancelQueries` (reverts by default), `removeQueries`, `resetQueries`, `setQueryData` (immutable updater; returning `undefined` leaves the cache unchanged), `setQueriesData` (existing queries only), `getQueryData` (non-reactive; don't read it in render), `getQueryState`, `isFetching`, `isMutating`, `resumePausedMutations` (no-op while offline).

### Mutations and optimistic updates
- `useMutation({ mutationFn, onMutate, onError, onSuccess, onSettled, retry, scope })`. `mutate` is fire-and-forget; `mutateAsync` returns a promise; `reset()` clears state.
- Callbacks passed to `mutate(vars, { onSuccess })` run once, for the latest call, and only if still mounted. Hook-level callbacks run on every call.
- `scope: { id }` serializes mutations that share an id.
- UI-only optimistic: render `variables` while `isPending`. `variables` survive an error, so you can offer a retry.
- Cache optimistic: in `onMutate(vars, context)`, `await context.client.cancelQueries(...)`, snapshot with `getQueryData`, write with `setQueryData`, return the snapshot. `onError` restores it from `onMutateResult`; `onSettled` calls `invalidateQueries`.

### Other v5 changes
- Single-object signatures everywhere (`useQuery({ queryKey, queryFn })`).
- `onSuccess`, `onError`, `onSettled` are removed from useQuery (still on useMutation). `remove` is removed from useQuery; use `queryClient.removeQueries({ queryKey })`.
- `cacheTime` is now `gcTime`. `status: 'loading'` is now `'pending'`. `isLoading` now means `isPending && isFetching`; `isInitialLoading` is deprecated.
- Window-focus refetch listens to `visibilitychange`, not `focus`.
- `getQueryData` and `getQueryState` take only a key. The custom `context` prop is removed; pass a `queryClient` as the second hook argument.
- `fetchQuery`, `prefetchQuery`, `ensureQueryData`, and infinite variants are deprecated for removal in v6. Use `query()` and `infiniteQuery()`; for ensure semantics, use `staleTime: 'static'`.
- Infinite queries require `initialPageParam`. Server-side retries default to 0.

## TanStack Virtual 3

### Hooks and React 19
- `useVirtualizer(options)` returns a Virtualizer for an element scroll container. `useWindowVirtualizer(options)` scrolls the window and does not need `getScrollElement`.
- react-virtual option `useFlushSync` defaults to true. React 19 can log "flushSync was called from inside a lifecycle method" while scrolling; set `useFlushSync: false` to remove it.
- `directDomUpdates` (default false): the virtualizer writes item positions and container size straight to the DOM and re-renders only when the visible range or `isScrolling` changes. Requirements: items are `position: absolute`; in `'transform'` mode (the default) they are also `top: 0; left: 0`; item styles must not set the main-axis position; the inner container uses `ref={virtualizer.containerRef}` and sets no height or width. Set it once at mount. `directDomUpdatesMode` is `'transform'` (default) or `'position'`.

### Options and defaults (Virtualizer API)
| Option | Default |
|---|---|
| overscan | 1 (with `lanes > 1`, counts whole rows) |
| getItemKey | index |
| directDomUpdates | false (mode `'transform'`) |
| laneAssignmentMode | `'estimate'` |
| anchorTo | `'start'` |
| useCachedMeasurements | false |
| initialMeasurementsCache | `[]` |
| isScrollingResetDelay | 150 ms |
| scrollEndThreshold | 1 px |
| followOnAppend | false |
| useScrollendEvent | false |
| useAnimationFrameWithResizeObserver | false (docs advise against enabling) |
| lanes | not stated |

- Required: `count`; `getScrollElement: () => element | null` (may return null early); `estimateSize(index) => number` in px. The docs advise estimating the largest reasonable size when measuring dynamically.
- `getItemKey(index)` should return stable IDs; memoize it with `useCallback`.
- The `measureElement` option `(element, entry, instance) => number` overrides sizing; the default uses `getBoundingClientRect()`. Don't confuse it with the instance method `virtualizer.measureElement` (the ref callback, which needs `data-index` on the item).
- `scrollMargin` is the distance from the scroll origin to the list. In absolute layouts, subtract it from `start` in the transform.
- `enabled: false` disables the observers and resets state.
- `observeElementRect` (default) tracks `clientWidth` and `clientHeight` (excluding borders and scrollbars) continuously.
- `gap` is in px. `lanes` and `laneAssignmentMode` are covered under Grids below. `rangeExtractor` (default exported as `defaultRangeExtractor`) handles sticky rows.

### Scrolling and instance methods
- `scrollToIndex(index, { align?: 'start' | 'center' | 'end' | 'auto', behavior?: 'auto' | 'smooth' })`. `scrollToOffset` takes the same options. `scrollBy(delta, { behavior })`. `scrollToEnd({ behavior?: 'auto' | 'smooth' | 'instant' })` for "jump to latest". The default `behavior` for `scrollToIndex` is not stated.
- After `scrollToIndex`, the virtualizer keeps correcting toward the target while items are measured. Call `cancelScroll()` from wheel, touchstart, or keydown handlers so user scrolling wins.
- During smooth scrolling, only items near the target are measured. The docs recommend block translation (translate the whole rendered block by the first item's `start`) over per-item absolute positions.
- Other methods: `getVirtualItems()`, `getVirtualIndexes()`, `getTotalSize()`, `measure()` (resets prior measurements), `takeSnapshot()` plus `initialMeasurementsCache` (restore position after navigation), `isAtEnd()`, `getDistanceFromEnd()`, `resizeItem(index, size)`.

### Grids
- `lanes` sets the number of columns (vertical lists) or rows (horizontal). Each item goes to the shortest lane. `laneAssignmentMode: 'estimate'` fixes lanes from estimates; `'measured'` waits for measurement, then fixes lanes.
- With `directDomUpdates`, you still set the cross-axis position in JSX, for example `left: ${(item.lane * 100) / lanes}%`.
- The dynamic example's grid does not use `lanes`. It uses a window row virtualizer plus a horizontal column virtualizer (`overscan: 5`, `estimateSize: getColumnWidth`).

### Resizing containers and changing row heights
- Container resize: the built-in rect observer tracks the scroll element's client size continuously, so resizing the container updates the visible range with no extra code. A custom `observeElementRect` must report the same dimensions.
- Row heights that change with width or content: attach `ref={virtualizer.measureElement}` and `data-index` to every rendered row. Measured sizes replace estimates and `getTotalSize()` updates incrementally. The `useCachedMeasurements` text implies that a ResizeObserver drives re-measurement.
- For better initial positions, estimate the largest reasonable row size.
- Call `virtualizer.measure()` for a full reset. The docs describe only that it resets prior measurements.
- Window lists with content above that can change height: measure `scrollMargin` with getBoundingClientRect or a ResizeObserver.
- Hidden containers (`display: none`): set `useCachedMeasurements: true` before hiding and back to false when shown.
- The window example reads `scrollMargin` from a ref that a `useLayoutEffect` writes after the first render. A ref write does not re-render, so the first render uses 0 (my reading of the code). Store the offset in state, or measure before the first render, if it matters.

### Dynamic example (main.tsx)
- Scroll element: `style={{ height: 400, width: 400, overflowY: 'auto', contain: 'strict', overflowAnchor: 'none' }}`.
- Hook: `useVirtualizer({ count, getScrollElement: () => parentRef.current, estimateSize: () => 45, enabled, directDomUpdates: true })`.
- Inner container: `ref={virtualizer.containerRef}` with `position: relative; width: 100%`.
- Rows: `key={v.key}`, `data-index={v.index}`, `ref={virtualizer.measureElement}`, `style={{ position: 'absolute', top: 0, left: 0, width: '100%' }}`. No transform; `directDomUpdates` writes it.
- On mount: `virtualizer.scrollToIndex(count - 1, { align: 'end' })`.

### Window example (main.tsx)
- `useWindowVirtualizer({ count: 10000, estimateSize: () => 35, overscan: 5, scrollMargin: listOffsetRef.current })`.
- Rows: `position: absolute; top: 0; left: 0; width: 100%; height: ${item.size}px; transform: translateY(${item.start - virtualizer.options.scrollMargin}px)`.

## Vercel React best practices (client-only subset)

Source: AGENTS.md, React Best Practices v1.0.0 (January 2026). Skipped: section 3 (server), 4.3 (SWR; this app uses TanStack Query), hydration rules 6.5 and 6.6, and Next.js-only details.

- 1.1 Check cheap synchronous conditions before awaiting flags or remote values.
- 1.2 Move `await` into the branch that needs the value.
- 1.3 For partly dependent async work, start each task once its own inputs resolve (promise chaining needs no extra dependency).
- 1.5 Run independent async calls with `Promise.all`.
- 1.6 Put Suspense around only the slow subtree (the doc's example is an async RSC; the idea holds for `use()` and `lazy`).
- 2.1 Import large packages from specific module paths (lucide-react, date-fns, lodash, MUI); check subpath typings first.
- 2.2 Load large modules with `import()` only when their feature is enabled.
- 2.3 Load non-critical libraries (analytics, extra error reporting) with `import()` after first render.
- 2.4 Lazy-load components not needed for first paint (the doc uses `next/dynamic`; use `React.lazy` here).
- 2.5 Keep `import()` specifiers literal or chosen from an explicit map.
- 2.6 Preload a heavy module on hover or focus of its trigger.
- 4.1 Share one window listener across hook instances through a module-level registry.
- 4.2 Pass `{ passive: true }` to touch and wheel listeners that never call `preventDefault`.
- 4.4 Version localStorage keys, store only the fields the UI needs, and wrap get and set in try/catch.
- 5.1 Compute derived values during render; don't mirror them into state through effects.
- 5.2 Read dynamic values (location, localStorage) inside the handler, not by subscribing in render.
- 5.3 Skip `useMemo` for cheap boolean, number, or string expressions.
- 5.4 Hoist component definitions to module scope and pass props; nested definitions remount on every render.
- 5.5 Default function or object props of `memo` components to a module-level constant, not an inline literal.
- 5.6 Move expensive subtrees into `memo` children so the parent can return early (for example, while loading).
- 5.7 List primitive deps (`user.id`) and precompute booleans (`isMobile`) for effect deps.
- 5.8 Run click or submit side effects in the handler, not in an effect triggered by a state flag.
- 5.9 Put independent computations or effects in separate hooks so unrelated deps don't re-run them.
- 5.10 Subscribe to a derived boolean (a media query), not a continuously changing value (window width).
- 5.11 Use `setX(prev => ...)` when the next state depends on the previous state.
- 5.12 Pass an initializer function to `useState` when the initial value is expensive.
- 5.13 Wrap frequent, low-priority updates (scroll tracking) in `startTransition`.
- 5.14 Feed a `useDeferredValue` value into `useMemo` for the heavy derived list.
- 5.15 Keep fast-changing values (pointer position) in a ref and write to the DOM directly.
- 6.1 Animate a wrapping `div`, not the `<svg>` element itself.
- 6.2 For non-virtualized long lists, apply `content-visibility: auto` with `contain-intrinsic-size` (mostly redundant under TanStack Virtual).
- 6.3 Hoist unchanging JSX such as large icons to module constants; skip if React Compiler is enabled.
- 6.4 Reduce SVG path precision (for example `svgo --precision=1`).
- 6.7 Wrap costly, often-toggled UI in `<Activity mode>`; add `useLayoutEffect` cleanup for media elements.
- 6.8 Applies only to hand-written `<script>` tags in index.html (my applicability note; the doc's advice is Next-specific).
- 6.9 Use `count > 0 ? <X /> : null` rather than `count && <X />`, because 0 renders as text.
- 6.10 Optional: react-dom `preload` or `preconnect` for known critical assets such as fonts (the doc's examples are server-oriented).
- 6.11 Replace manual loading booleans around async updates with `useTransition`'s `isPending`.
- 7.1 Batch DOM writes, then read layout once (or toggle a class).
- 7.2 Build a `Map` once for repeated `find()` by key.
- 7.3 Copy nested property reads and array length into locals before hot loops.
- 7.4 Memoize pure, repeated computations in a module-level `Map` keyed by input.
- 7.5 Keep an in-memory mirror of localStorage or cookie reads; update on writes; invalidate on `storage` events.
- 7.6 Replace several `filter` passes over one array with a single loop.
- 7.7 Move analytics, persistence, and prefetch into `requestIdleCallback` with a timeout; keep user-initiated work out.
- 7.8 Compare lengths before sorting or serializing arrays.
- 7.9 Return at the first decisive check.
- 7.10 Hoist RegExp literals to module scope or `useMemo`; watch `lastIndex` on `/g` patterns.
- 7.11 Use `flatMap` to transform and drop items in one pass.
- 7.12 Use one loop for min or max; don't sort or spread huge arrays into `Math.max`.
- 7.13 Use `Set` or `Map` for repeated membership checks.
- 7.14 Use `toSorted()`, `toReversed()`, and `with()` instead of mutating `sort()` or `reverse()` on state or props.
- 8.1 Never put an Effect Event in a dependency array.
- 8.2 Guard app-wide init with a module-level flag or run it in the entry module, not in a component's `useEffect([])`.
- 8.3 Keep latest callbacks in a ref so subscriptions stay stable; prefer `useEffectEvent` where available.
- 8.4 Wrap a callback in `useEffectEvent` so effects read the latest value without listing it (for example, a debounced search).

## Settled by running them (Phase 2)

React 19.3, TanStack Virtual 3.14 (core 3.19), TanStack Query 5.105.

**TanStack Virtual:**
- A scroll only re-renders when the range or `isScrolling` changes (`maybeNotify`), with or without `directDomUpdates`. So for fixed-size rows that option buys nothing, and it needs `measureElement` on every row to work at all.
- Keep `useFlushSync` at its default. Without it the rows land a frame after the scroll position: scrolling by script at 20,000 px/s, 92% of frames had blank rows on Tracks, and none with it. Frame times were the same, and with fixed-size rows the React warning in the notes above never appeared.
- It caches sizes against `getItemKey`'s identity, not `estimateSize`'s. A new `getItemKey` is what makes it take new sizes, in the same render, which `measure()` doesn't manage.
- `initialOffset` is scrolled to in a layout effect, so a list whose rows arrive a render later needs the position put back once they have.
- It reads the viewport from `clientWidth` and `clientHeight`, and calls `scrollTo` optionally, so jsdom only needs those two stubbed.
- `eslint-plugin-react-hooks`' `incompatible-library` warns on every `useVirtualizer`. It's advice for React Compiler, which this build doesn't use, so it's off for `VirtualList.tsx` alone.

**React:** a ref callback can return its cleanup, and a `setState` from a ref callback re-renders before paint, so an element can be measured without an effect or a flash.

**TanStack Query:** `mutate` calls the `mutationFn` in a later microtask, so a test has to `waitFor` the call. Removing a query doesn't re-render whoever's observing it; they only pick up the removal on their next render.

**Testing Library:** `waitFor` also retries on any DOM change, so a `renderHook` inside its callback loops until the worker runs out of memory, and the test run just hangs.

## Not settled by docs
- `useEffectEvent` release status and stabilization version: the page shows neither.
- The react.dev pages were fetched without version info; none states which React 19.x release introduced each API.
- Zustand `subscribe`: the return value (unsubscribe) and the listener's arguments are not spelled out in the pages read.
- Zustand `useShallow` import path: the reference and guides use 'zustand/react/shallow', while the v5 migration snippets use 'zustand/shallow'. The docs don't reconcile them.
- Zustand: the Immer gotchas page, the optics-ts and Ramda options, and the create, persist, devtools, immer, and subscribeWithSelector reference pages were not read.
- TanStack Virtual: default for `lanes`, and default `behavior` for `scrollToIndex`.
- TanStack Virtual: sizing requirements for the scroll element. The examples use an explicit height and `overflowY: 'auto'`.
- TanStack Virtual: whether `measure()` is needed after a width change that doesn't resize rows.
- TanStack Virtual: the lanes-based grid example was not read.
- React: the `useActionState` page was not read (referenced only).
- Vercel rules 6.8 and 6.10 target Next.js and server components; their fit for a Vite SPA is a judgment call (noted above).
