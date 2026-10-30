---
name: folder-structure
description: Use when creating ANY new file in this repo (component, hook, module, util, type, feature) or reviewing where code should live. Decides file placement and how features are structured.
---

# Folder structure & file placement

```
src/
  shared/          imported by main and renderer. No Node, Electron or React.
    ipc/           contract.ts (commands, events, zod inputs), channels.ts (names only)
    domain.ts      Track, Album, Playlist, PlayerState…
    result.ts      Ok | Err, AppError
  main/
    index.ts       lifecycle and wiring only
    ipc.ts         binds the contract to modules, validates input and sender
    playback/      the only place that knows mpv exists
    library/       scanner worker, reconcile, CUE parser, art
    db/            connection, migrations/*.sql, queries grouped by table
    lyrics/ waveform/ stats/ settings/
    system/        windows, protocols, security, thumbar, reveal, binaries, logging
  preload/
    index.ts       one sandboxed CJS file. Exposes the typed api, nothing else
  renderer/
    app/           root, providers, window routing, error boundaries
    features/      what the app can do, one folder per capability
    components/ui/     domain-agnostic primitives. Know nothing about music
    components/music/  domain parts used by more than one feature
    hooks/         generic hooks only
    lib/           non-React logic plus shared stores: cn, api, playerStore, queryKeys, format
    styles/        globals.css, typography.css
```

## Placement decision list (first match wins)

**Main process**

1. Talks to mpv → `main/playback/`.
2. SQL → `main/db/` queries grouped by table, or the owning module if only it needs that query.
3. Runs as a worker → a `*.worker.ts` file in the module that owns the job, plus a small function that starts it.
4. Pure logic (parsers, queue moves, matching) → a pure `.ts` file in the owning module, with a `.test.ts` beside it.
5. Electron window, protocol or OS integration → `main/system/`.

**Renderer**

1. Root, providers, which window is this → `renderer/app/`.
2. The UI-lib test: would this plausibly exist in shadcn/Radix (Button, Slider, Dialog, Toast, Skeleton)? → `components/ui/<Name>.tsx`. A Button never lives in a feature.
3. Knows about tracks or albums AND is used by 2+ features → `components/music/`.
4. A capability → `features/<Feature>/`. This is the default home for most new code.
5. Generic hook that knows nothing about music → `hooks/`. If it mentions tracks, playback, or the library, it stays in the feature or `lib/`.
6. Non-React logic → `lib/`, or the feature's `utils/` if only one feature needs it.
7. Types: next to the code that owns them. Shapes crossing IPC → `shared/domain.ts`.

**If placement isn't obvious from these rules, ask. Don't guess.**

## Feature anatomy

```
features/MyFeature/
  MyFeature.tsx          main component, same name as the folder
  MyFeatureContents.tsx  optional: when the main file fetches and early-returns, this renders with data guaranteed
  components/            feature-internal components
  hooks/                 feature-internal hooks (.ts)
  utils/                 feature-internal pure functions
```

Prefer flat. Only add a subfolder once there are a few files to put in it.

## Dependency arrow

- `app → features → components → lib`. Enforced by `eslint-plugin-boundaries`.
- Features never import other features. If two features need something, it moves down to `components/music` or `lib`. Composition across features happens in `app/`.
- `components/ui` never imports `components/music`.
- Main and renderer never import each other. Both may import `shared/`.
- `shared/` imports nothing from Node, Electron, or React. `zod` is allowed.

## Naming

- Components: PascalCase files (`TrackList.tsx`).
- Hooks, stores, modules: camelCase (`usePlayerPosition.ts`, `playerStore.ts`, `gaplessWindow.ts`).
- Tests beside the code: `gaplessWindow.test.ts`. End-to-end tests in `tests/e2e/`.
- SQL migrations: `NNN_description.sql`.
- No barrel files.

## Imports

- Aliases across folders: `@/` is `src/renderer/`, `@shared/` is `src/shared/`, `@main/` is `src/main/`.
- Relative only for same-folder siblings (`./queue`).
- `import type` for type-only imports.
