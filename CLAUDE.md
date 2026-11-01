# Project notes

## What this is

A personal foobar2000-style music player for Windows. It plays my own local FLAC and MP3 files (`D:\Music`, about 5,700 tracks). No streaming, no tag editing, no file conversion: foobar2000 stays the tool for those. The one file action is Reveal in File Explorer.

**The now-playing view is the cornerstone.** It's a very visual app: album art as big as the screen allows, the rest of the screen is the giant media list, and minimal chrome.

Screens run from a 10" touch laptop to a 65" TV (laptop over HDMI, wireless keyboard).

Read before working: [docs/FEATURES.md](docs/FEATURES.md) (what), [docs/PLAN.md](docs/PLAN.md) (how, and the rules), [docs/spike-results.md](docs/spike-results.md) (proven engine facts). Library notes are in [docs/research/](docs/research/README.md).

## Hard rules

- **Never write to `D:\Music` or anything else outside this repo while developing.** In Git Bash, run `. scripts/dev-env.sh` before the app or the tests: it keeps `MUSIC_PLAYER_DATA_DIR`, tool caches and temp files inside `.dev/`, unsets the crash handler an agent's shell inherits, and sets the mpv arguments below. `npm run dev` and the e2e suite pass their own `--user-data-dir` inside `.dev/`. Reading `D:\Music` is fine. Known leftover: Chromium rewrites `%APPDATA%\Microsoft\Spelling\en-US\` on every launch, and no setting stops it.
- **Tests and dev runs never make sound.** Use `MUSIC_PLAYER_MPV_ARGS=--ao=null` (or `--ao=pcm`). For a real-device check, keep it at volume 0 and keep it short: exclusive mode cuts off Discord and foobar for its duration.
- **Never commit audio, `resources/mpv/`, `resources/models/` or `lyrics-library/`.** The model's license is non-commercial, no derivatives. Generate fixtures with ffmpeg at test time. Lyrics are copyrighted, and this repo goes on GitHub.
- **Audio work gets real research first.** Anything about audio science or DSP (EQ, target curves, headphone measurements, loudness, psychoacoustics) comes from primary sources: standards, published papers, the measurement's own authors. Never from memory, forums or a plausible guess. Record sources and what's uncertain in `docs/research/`, check results by measuring bytes where possible, and if it can't be researched or built well, say so instead of shipping something that only looks right. This is Levan's explicit rule: these features have to work, not just look nice.
- **Read the docs first.** Before writing against a library, read its notes in `docs/research/`, then the docs for the installed version or its types in `node_modules`. If docs don't settle it, test it. If a digest is stale or wrong, fix the digest.

## Tech stack

- Electron 45 + electron-vite 6 + Vite 8, React 19, TypeScript `~6.0` (strict + `noUncheckedIndexedAccess`).
- Tailwind 4 CSS-first (no `tailwind.config.js`), `motion`, `lucide-react`, Radix primitives from `radix-ui`, `cn()` from `@/lib/cn`.
- Zustand 5 for playback state, TanStack Query 5 for database reads, `@tanstack/react-virtual` for lists.
- `better-sqlite3` 13 with plain SQL and no ORM, `music-metadata` 12, `zod` 4, `electron-log` 5 (main only).
- mpv 0.41 and the Discogs-EffNet model (`npm run fetch:binaries`), `ffmpeg-static`, `onnxruntime-node`.
- Vitest 5 and Playwright. Tests run on plain Node, since the SQLite binary is N-API.

## Commands

```sh
npm run fetch:binaries  # mpv into resources/mpv, once after cloning
npm run dev             # electron-vite dev, with its data in .dev/dev-user-data
npm run build           # type-check and production build
npm run typecheck
npm run lint
npm run test            # vitest
npm run test:e2e        # Playwright against the built app
npm run dist            # installer (Phase 7)
```

Prettier: `core.autocrlf` can flag every file on Windows; use `--end-of-line auto` to see real issues only.

## Architecture rules

1. **Only `src/main/playback/` knows mpv exists.**
2. **Main owns all state.** Windows are views: they send commands and render events. React never decides what plays next.
3. **One typed contract:** `src/shared/ipc/contract.ts`. Inputs validated in main, types shared. The renderer never sends a file path, only ids.
4. **Dependencies point one way, enforced by lint.** `app → features → components → lib`. Features don't import other features; if two need it, it moves to `components/music` or `lib`. Main and renderer share only `shared/`, which imports no Node, Electron or React.

Use deep modules: a small interface hiding a lot. No pass-through layers (`service → repository → dao`). Split by knowledge, not by the order things happen. Split a file when it does two jobs; a long file doing one job is fine, a 200–300 line file is a prompt to check.

Slow work never runs on the main thread. Logic is pure functions wherever it can be; async stays at the edges.

## Errors

Follow "Error handling and states" in PLAN.md. In short:

- Expected failures return `Result` from `@shared/result`. Exceptions mean a bug and are caught at the top of each process.
- Every IPC command returns a `Result`.
- Outside data is validated once at the edge, then trusted.
- `null` for "no value" in domain types, never `undefined`.
- Every async view has loading, error (with an action), empty (with a next step) and data states, as early returns.
- Every failure gets exactly one response: handled silently, retried then told, toast with fallback, skipped and reported, or a screen asking me to fix it.

## Code conventions

Skills in `.claude/skills/` hold the detail: `folder-structure`, `components`, `typescript`, `styles`, `main-process`. Read the relevant one before writing code in that area. If placement isn't obvious from them, ask.

`vercel-react-best-practices` is Vercel's, installed as is. Use its re-render, rendering and bundle rules. Its server, hydration and Next.js rules don't apply to an Electron app. Where it conflicts with this repo's conventions, this repo wins.

- Named exports. `export default` only where a tool requires it.
- `type`, not `interface`. No `Type` suffix. No `enum`. No `any`, no `@ts-ignore`.
- `useEffect` lives in named custom hooks in `.ts` files, never in a component. Lint enforces it.
- No nested ternaries. Compute complex values above the `return`.
- Screen-size differences are CSS, never JS. Flex only, no grid.
- Every button goes through `<Button>`. Text styling goes through `<Text>`. Lint also enforces color and weight on plain elements outside `components/ui`.
- Tokens only: no raw hex, no raw px for spacing, type or icons. `size-tap` is the one fixed floor (44px).

### Comments: write far fewer

Default to no comment. Only comment when a reader would otherwise **get it wrong**: a non-obvious constraint, why a surprising choice was made, a genuine TEMP/HACK.

Never write changelog comments, restatements of the code, or essays. Put reasoning in the commit message.

### UI copy

Short descriptors (helper text, labels, tooltips) take no trailing period. Full sentences in dialogs and alerts keep normal punctuation.

## Verifying your work

Run `npm run typecheck`, `npm run lint` and `npm run test` before calling something done. For UI, build it and capture screenshots through Playwright at 1280×800, 1920×1080 and 3840×2160, and look at them. Resize with `resizeWindow` from `tests/e2e/helpers/app.ts`: `setViewportSize` leaves the title bar's `env()` values stale and collapses the header. Playwright scrolls to whatever it clicks, and overscan keeps off-screen rows in the DOM, so click something on screen when scroll position matters. How it sounds and feels on real hardware is Levan's to verify.

A test removes only its own subfolder of `.dev/test-tmp`, since other tests run beside it.

Levan commits nothing by hand here: Claude commits, Levan pushes. End commit messages with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```
