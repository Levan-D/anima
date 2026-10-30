# Reference notes: Vitest 5, Playwright Electron, ESLint 10 and typescript-eslint, eslint-plugin-boundaries v7, Zod 4, electron-log 5, MediaSession

## Sources

All 39 pages returned HTTP 200 in this run. Items tagged (summary) come from the model-extracted tail of a page the fetch tool truncated.

- https://vitest.dev/guide/
- https://vitest.dev/config/
- https://vitest.dev/guide/projects
- https://vitest.dev/guide/migration
- https://vitest.dev/guide/environment
- https://vitest.dev/config/pool
- https://vitest.dev/config/globals
- https://vitest.dev/config/isolate
- https://vitest.dev/config/execargv
- https://vitest.dev/config/maxworkers
- https://v4.vitest.dev/guide/migration
- https://playwright.dev/docs/api/class-electron
- https://playwright.dev/docs/api/class-electronapplication
- https://playwright.dev/docs/api/class-jshandle
- https://typescript-eslint.io/getting-started/
- https://typescript-eslint.io/getting-started/typed-linting/
- https://typescript-eslint.io/users/dependency-versions
- https://eslint.org/docs/latest/use/configure/configuration-files
- https://eslint.org/docs/latest/use/migrate-to-10.0.0
- https://eslint.org/docs/latest/rules/no-restricted-syntax
- https://eslint.org/docs/latest/rules/no-restricted-imports
- https://eslint.org/docs/latest/extend/selectors
- https://github.com/javierbrea/eslint-plugin-boundaries
- https://www.jsboundaries.dev/docs/quick-start/
- https://www.jsboundaries.dev/docs/guides/typescript-support/
- https://www.jsboundaries.dev/docs/rules/
- https://www.jsboundaries.dev/docs/releases/migration-guides/v5-to-v6/
- https://www.jsboundaries.dev/docs/releases/migration-guides/v6-to-v7/
- https://zod.dev/v4
- https://zod.dev/api
- https://zod.dev/v4/changelog
- https://zod.dev/basics
- https://zod.dev/error-formatting
- https://github.com/megahertz/electron-log
- https://github.com/megahertz/electron-log/blob/master/docs/initialize.md
- https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API
- https://developer.mozilla.org/en-US/docs/Web/API/MediaSession
- https://developer.mozilla.org/en-US/docs/Web/API/MediaSession/setActionHandler
- https://developer.mozilla.org/en-US/docs/Web/API/MediaSession/setPositionState

## Version context

- Vitest docs: v5.0.5. Vitest 5 requires Vite >= 6.4.0 and Node.js >= 22.12.0.
- typescript-eslint docs: v8.72.1. Its TypeScript range is `>=4.8.4 <6.1.0`, so TypeScript ~6.0 is in range and the cap is below 6.1.
- ESLint "latest" docs: v10.13.0.
- eslint-plugin-boundaries docs: 7.4.0 (current).
- Zod docs: Zod 4 is stable; the banner reads "Zod 4.6 is out".
- Playwright pages carry no version header, but newest options are marked "Added in: v1.59".

## Vitest 5

### Config file and shape
- Install with `npm install -D vitest`. With Yarn, add `vite` explicitly, since it is a required peer that Yarn does not install.
- Lookup in project root: `vitest.config.{ts,mts,cts,js,mjs,cjs}` first, then `vite.config.*`. A vitest config replaces vite.config entirely, so its options are ignored. `--config` overrides lookup. v5 no longer searches parent directories.
- Import `defineConfig` from `vitest/config`. Test options go under `test`. Vite options such as `plugins`, `resolve.alias` and `define` stay top-level.
- Default test files must contain `.test.` or `.spec.` in the name.

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'node', environment: 'node', include: ['src/main/**/*.test.ts'] } },
      { test: { name: 'renderer', environment: 'jsdom', include: ['src/renderer/**/*.test.tsx'] } },
    ],
  },
})
```
The project names and paths are illustrative. The shape follows the docs.

### Globals vs imports
- `globals` defaults to `false`. Enable with `globals: true` or the CLI flag `--globals` (`--no-globals` and `--globals=false` also exist).
- Default style is `import { describe, expect, test, vi } from 'vitest'`.
- With globals, add `"vitest/globals"` to `compilerOptions.types` in tsconfig.
- The docs note that libraries such as @testing-library/react rely on globals for auto-cleanup.

### Projects and environments (node vs jsdom)
- `test.projects` replaces `workspace` (renamed in 3.2). Entries can be globs, config-file paths, or inline objects.
- Names must be unique. Project config files should use `defineProject` rather than `defineConfig`. `coverage`, `reporters`, `resolveSnapshotPath` and `attachmentsDir` are root-only.
- Inheritance: since v5, `extends` defaults to `true`, so inline projects inherit root options such as plugins, pool and resolve.alias. Use `extends: false` to opt out. Arrays such as `setupFiles` are concatenated. `name` and `projects` are never inherited, and `globalSetup` is not inherited from root. Config files referenced by path inherit nothing.
- The root config is not a project unless listed. Root-level reporters and coverage still apply.
- `--project` filters the run (repeatable; supports `*` and `!`).
- `environment` defaults to `node`. Built-ins: `node`, `jsdom`, `happy-dom`, and `edge-runtime` (which uses @edge-runtime/vm).
- Per file, use a control comment such as `// @vitest-environment jsdom` at the top of the file. The page shows the `//` line form only.
- Environments exist only for Node. Browser runs are a test project, not an environment.
- The environment page gives no install command for jsdom or happy-dom.
- For CSS or asset import errors under jsdom or happy-dom, add the packages to `server.deps.inline`.

### Pool and native-module options
- `pool` accepts `'threads' | 'forks' | 'vmThreads' | 'vmForks'`. Default `'forks'`. CLI `--pool=threads`.
- The docs say native-code libraries such as Prisma, bcrypt and canvas can segfault in threads, and that "it is advised to use `forks` pool instead."
- vm pools: errors from native modules such as `fs` reference a different Error constructor, so `instanceof Error` is false. The docs also warn about ESM memory leaks.
- `poolOptions` no longer exists. It was removed in v4, and the v5 config index does not list it. Its replacements are top-level options:
  - `isolate`: boolean, default `true`, CLI `--no-isolate`. No effect on vm pools.
  - `execArgv`: `string[]`, default `[]`. Extra Node flags for the runner worker. The docs warn that some flags (for example `--prof` and `--title`) can crash the worker.
  - `maxWorkers`: number or percent string. Default is all available parallelism, or half when `watch` is on. CLI `--maxWorkers=4`.
  - `fileParallelism` and `vmMemoryLimit`: not fetched.
- Since v4, isolate, execArgv and fileParallelism can be set per project.

### Breaking changes
v4 to v5:
- `clearMocks` now defaults to `true`, so `vi.clearAllMocks()` runs before each test.
- `vi.mock`, `vi.unmock` and `vi.hoisted` called inside a function, block or describe now throw. Keep them top-level. `vi.doMock` and `vi.doUnmock` may be called anywhere.
- Unawaited `resolves`, `rejects` and `toMatchFileSnapshot` assertions now fail the test.
- `test.sequential`, `describe.sequential` and the `sequential` option were removed. Use `{ concurrent: false }`.
- `bench` is no longer a top-level import. It is a test-context fixture, and `bench.only`, `.skip` and `.todo` were removed.
- `expect.poll` rejects when it times out.
- `testNamePattern` (`-t`) matches full names joined with `' > '`.
- `toThrow('')` matches any error message.
- The `json` and `junit` reporters write to files by default (`.vitest/json/output.json`, `.vitest/junit/output.xml`) unless `stdout: true` is set.
- `sharedViteServer` defaults to `true` for inline projects.
- Worker and pool IDs start at 1.
- Entry points were removed: `vitest/coverage` and `vitest/reporters` moved to `vitest/node`; `vitest/environments` and `vitest/snapshot` moved to `vitest/runtime`; `vitest/runners` moved to `TestRunner` from `vitest`.
- Minimum versions rose to Vite 6.4 and Node 22.12.

v3 to v4:
- `poolOptions` was removed. `maxThreads` and `maxForks` became `maxWorkers`. `singleThread` and `singleFork` became `maxWorkers: 1, isolate: false`. VM `memoryLimit` became `vmMemoryLimit`. `threads.useAtomics` was removed. `VITEST_MAX_THREADS` and `VITEST_MAX_FORKS` became `VITEST_MAX_WORKERS`.
- `environmentMatchGlobs` and `poolMatchGlobs` were removed in favor of `projects`.
- `deps.inline`, `deps.external` and `deps.fallbackCJS` moved to `server.deps.*`.
- `coverage.all` and `coverage.extensions` were removed. Default excludes are now only `node_modules` and `.git`.
- Vitest does not enable globals by default.

### ELECTRON_RUN_AS_NODE
No fetched Vitest page covers this. See Not settled.

## Playwright Electron (experimental)

- The docs import with `const { _electron: electron } = require('playwright');`. Electron v21+ is supported. No `@playwright/test` import appears on these pages.

```js
const { _electron: electron } = require('playwright')
const electronApp = await electron.launch({ args: ['main.js'] })
const win = await electronApp.firstWindow()
await win.screenshot({ path: 'intro.png' })
await electronApp.close()
```

- `electron.launch(options?)` returns `Promise<ElectronApplication>`. Options and defaults:
  - `executablePath`: defaults to the Electron binary at `node_modules/.bin/electron`.
  - `args`: usually the main script name.
  - `cwd`.
  - `env`: defaults to `process.env`.
  - `timeout`: 30000 ms by default; `0` disables it.
  - `colorScheme`: `'light'` by default.
  - Others: `locale`, `timezoneId`, `offline` (false), `bypassCSP` (false), `ignoreHTTPSErrors` (false), `acceptDownloads` (true), `chromiumSandbox` (false; added in 1.59), `artifactsDir` (1.59), `tracesDir` (1.36), `recordVideo` (`dir`, `size`, `fps` default 25), `recordHar`, `extraHTTPHeaders`, `geolocation`, `httpCredentials`.
- `electronApp.firstWindow({ timeout? })` returns `Promise<Page>`. Its default timeout is 30000 ms.
- `electronApp.evaluate(pageFunction, arg?)` runs in the main process. The first parameter is the result of `require('electron')`, as in `({ app }) => app.getAppPath()`. Non-serializable return values become `undefined`, except `-0`, `NaN`, `Infinity` and `-Infinity`. `evaluateHandle` returns a JSHandle.
- `electronApp.browserWindow(page)` returns `Promise<JSHandle>` for that page's BrowserWindow. `jsHandle.evaluate(fn, arg?)` passes the handle as the first argument.
- Setting window size has no docs example. These two routes are inferred from the pages above:
  - `await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))`
  - `const h = await electronApp.browserWindow(page); await h.evaluate((win) => win.setSize(1280, 800))`
- Other methods: `windows()` (synchronous, returns `Page[]`), `context()`, `process()` (ChildProcess), `waitForEvent(event, optionsOrPredicate?)` (30000 ms default), and `close()`.
- Events: `'window'` fires for each window once it is created and loaded, and yields a Page. `'console'` (added in 1.42) carries main-process console output. `'close'` fires when the app exits.
- If launch times out, check that Electron's `EnableNodeCliInspectArguments` fuse (`nodeCliInspect`) is not set to `false`.
- Playwright does not intercept native dialogs (`showOpenDialog`, `showSaveDialog`, `showMessageBox`, and the Sync variants). Stub them in main with `electronApp.evaluate`. The stub persists until the app closes.

## ESLint 10 and typescript-eslint

### ESLint 10
- ESLint 10.0.0 supports Node.js 20.19.0+, 22.13.0+ and 24+. Node below 20.19, plus 21 and 23, is dropped.
- Flat config only. The migration guide says: "Starting with ESLint v10.0.0, the old configuration format is no longer supported." `FlatESLint` and `LegacyESLint` were removed (use `ESLint`). `Linter` rejects `configType: "eslintrc"`.
- Config files are `eslint.config.{js,mjs,cjs,ts,mts,cts}`. Each exports an array of config objects, typically built with `defineConfig([...])` from `eslint/config`. TypeScript config files need jiti >= 2.2.0.
- The v10 default lookup starts at each linted file's directory and searches upward. `--config path` pins a specific file.
- Config object keys: `name`, `basePath`, `files`, `ignores`, `extends`, `language`, `languageOptions`, `linterOptions`, `processor`, `plugins`, `rules`, `settings`.
- `ignores` used with no other key (besides `name`) acts as global ignores. Default ignores are `**/node_modules/` and `.git/`. Use `globalIgnores()` from `eslint/config`.
- Default lint targets are `**/*.js`, `**/*.cjs` and `**/*.mjs`. Add `.ts` and `.tsx` through `files`. Patterns are minimatch-style and relative to the config file.
- `linterOptions`: `noInlineConfig`; `reportUnusedDisableDirectives` defaults to `"warn"`; `reportUnusedInlineConfigs` defaults to `"off"`.
- Other v10 changes: `eslint:recommended` adds `no-unassigned-vars`, `no-useless-assignment` and `preserve-caught-error`. JSX references are tracked. `/* eslint-env */` comments are errors. `no-shadow-restricted-names` reports `globalThis` by default. Codemod: `npx codemod @eslint/v9-to-v10`.

### typescript-eslint
- Install: `npm install --save-dev eslint @eslint/js typescript typescript-eslint`.
- Quickstart flat config:

```js
import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'
export default defineConfig({
  files: ['**/*.{js,ts}'],
  extends: [js.configs.recommended, tseslint.configs.recommended],
})
```
  The quickstart suggests `files: ['**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}']` to cover `.tsx`. The `tseslint.config()` helper does not appear on these pages.
- Presets: `recommended`, `strict`, `stylistic`. Typed variants: `recommendedTypeChecked`, `strictTypeChecked`, `stylisticTypeChecked`.
- Typed linting needs two changes: use a `...TypeChecked` preset, and set `languageOptions.parserOptions.projectService: true`.

```js
export default defineConfig({
  files: ['**/*.{js,ts}'],
  extends: [js.configs.recommended, tseslint.configs.recommended, tseslint.configs.recommendedTypeChecked],
  languageOptions: { parserOptions: { projectService: true } },
})
```
- To enable one typed rule without the preset, add `'@typescript-eslint/no-floating-promises': 'error'` under `rules`. `parserOptions` must still be set.
- `projectService` is recommended. `project` is the older alternative.
- The legacy example sets `tsconfigRootDir: __dirname`. The flat example omits it.
- Cost: TypeScript builds the project before linting. The docs say "a few seconds or less" for small projects. A parse error about type information means the FAQ's error case applies: no tsconfig includes the file.
- Supported ranges (dependency-versions page):
  - TypeScript `>=4.8.4 <6.1.0`.
  - ESLint `^8.57.0 || ^9.0.0 || ^10.0.0`.
  - Node `^18.18.0 || ^20.9.0 || >=21.1.0`.
- Unsupported TypeScript versions produce a warning. The parser option `onUnsupportedTypeScriptVersion` can make it throw instead.
- Inference: ESLint 10's Node floor (20.19) is stricter than typescript-eslint's Node range.

## eslint-plugin-boundaries v7 (docs 7.4.0)

- Install with `npm install eslint eslint-plugin-boundaries --save-dev`. Register it with `plugins: { boundaries }` in a flat config object.
- Settings keys always use the `boundaries/` prefix:
  - `"boundaries/elements"`: entries shaped `{ type, pattern, capture? }`. Patterns match folders, such as `components/*/*`, not files.
  - `"boundaries/files"`: entries shaped `{ pattern, category }`. Categories are independent of elements, and one file can match several.
  - `"boundaries/elements-single-match"`: default `true`. Set `false` to let an element accumulate multiple types.
  - `"boundaries/dependency-nodes"`: default `["import","export","require","dynamicImport"]` since v6.
  - `"boundaries/legacy-warnings"`: `false` skips legacy-pattern detection.
- Dependency rule in v7 form:

```js
rules: {
  "boundaries/dependencies": ["error", {
    default: "disallow",
    policies: [
      { from: { element: { type: "component" } }, allow: { to: { element: { type: "helper" } } } },
      { disallow: { to: { file: { categories: "test" } } } },
    ],
  }],
}
```
  `policies` is the v7 name for the old `rules` option. The old name still works and warns.
- `from` and `to` accept entity selectors with `element`, `file` and `module` sub-selectors. Flat selectors still work but warn once per policy.
- By default only local targets are checked. Set `checkAllOrigins: true` to check external and core modules. Match them with `to: { module: { origin: ["external","core"], source: "react" } }`.
- Presets: `boundaries.configs.recommended.rules` suits existing projects, and `strict` suits new projects. In v7 the presets no longer list the deprecated element-types, entry-point and external rules. `strict` enables `no-ignored-dependencies` and `no-unknown-dependencies`.
- Active rules: `boundaries/dependencies`, `boundaries/no-unknown-files`, `boundaries/no-unknown-dependencies`, `boundaries/no-ignored-dependencies`.
- Deprecated but still working: `boundaries/element-types` (alias of dependencies), `boundaries/entry-point`, `boundaries/external`, `boundaries/no-private`.
- TypeScript path aliases: install `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin` and `eslint-import-resolver-typescript`. Set `languageOptions.parser` to the TS parser, and set `settings["import/resolver"] = { typescript: { alwaysTryTypes: true } }`. The resolver reads `compilerOptions.paths` (and `baseUrl`) from tsconfig.json.
- v5 to v6 (guide):
  - `boundaries/element-types` was renamed `boundaries/dependencies`.
  - Object-based element selectors replace the string and tuple forms, which are deprecated.
  - `importKind` is deprecated in favor of `dependency.kind`. `${ }` templates are deprecated in favor of `{{ }}`.
  - `entry-point`, `external` and `no-private` are deprecated.
  - Flagged as breaking: the new `dependency-nodes` default (set `["import"]` to keep the old behavior) and the removal of `boundaries/no-private` from the recommended config. The guide's heading also says the `to` property in allow and disallow is now required.
- v6 to v7 (guide, "close to zero config changes"):
  - `rules` became `policies`. `{{rule.*}}` templates became `{{policy.*}}`.
  - `boundaries/no-unknown` became `no-unknown-dependencies`, which adds a `require` option (`"any"` default, plus `"element"`, `"file"`, `"all"`). `boundaries/no-ignored` became `no-ignored-dependencies`. `strict` now enables the new names, so old `eslint-disable` comments stop suppressing violations. The `strict-legacy` preset keeps the old names.
  - `no-unknown-files` now counts file descriptors, and its message text changed. Default report messages changed generally, so update snapshots.
  - TypeScript-only removed exports: `ElementTypesRule`, `ElementTypesRuleOptions`, `ElementSelectors`, `ElementsSelector`, `ElementSelectorWithOptions`, `isElementsSelector`, `isElementDescriptorMode`, `isImportKind`, `IMPORT_KINDS_MAP`. Replacements: `DependenciesPolicy`, `DependenciesRuleOptions`, `ElementSelector`, `isDependencyKind`, `DEPENDENCY_KINDS_MAP`.
  - Deprecated but working: `category` in descriptors (use `boundaries/files`), `dependency.module` (use `to.module.source`), and `mode` in descriptors (drop `"folder"`, move `"file"` to file descriptors, and change `"full"` to `partialMatch: false`).

## Banning useEffect in .tsx

- `no-restricted-syntax` takes selector strings or `{ selector, message }` objects, and the two forms can be mixed. Selectors use ESTree node types and AST selector syntax, including attribute selectors such as `CallExpression[callee.name='require']`.

```js
{
  files: ["**/*.tsx"],
  rules: {
    "no-restricted-syntax": ["error",
      { selector: "CallExpression[callee.name='useEffect']", message: "Do not call useEffect." },
      { selector: "CallExpression[callee.property.name='useEffect']", message: "Do not call useEffect." },
    ],
  },
}
```
  - The first selector catches bare `useEffect(...)` calls.
  - The second catches `React.useEffect(...)` and any `x.useEffect(...)`. It is inferred from the documented nested-attribute syntax (`[attr.level2="foo"]`), and no docs example shows it.
- `no-restricted-imports` can use `paths: [{ name: "react", importNames: ["useEffect"], message: "..." }]`. It applies to static imports only, not dynamic ones.
  - Not settled: whether `export { useEffect } from "react"` is caught, and whether `React.useEffect` property access is caught.
  - (summary) Import-name restrictions reportedly do not apply to TypeScript import-equals declarations.

## Zod 4

- Install with `npm install zod@^4.0.0`. The docs import with `import * as z from "zod";`. Documented subpaths are `zod/mini` (functional, tree-shakable), `zod/locales`, and `zod/v4/core`. The release notes mention `"zod/v3"` and `"zod/v4"` in a benchmark. A `{ z }` named import is not shown.
- Objects:
  - `z.object({...})` strips unknown keys by default.
  - `z.strictObject({...})` throws on unknown keys.
  - `z.looseObject({...})` passes unknown keys through.
  - `.strict()` and `.passthrough()` are deprecated and kept as legacy. `.strip()` is deprecated. `.merge()` is deprecated; use `.extend()` or `...Schema.shape`. `.nonstrict()` and the `.deepPartial()` method were dropped, but top-level `z.deepPartial()` is documented.
  - `.safeExtend()` is new. It refuses non-assignable overrides and keeps refinements. Plain `.extend()` throws on schemas with refinements.
- Discriminated unions: `z.discriminatedUnion("status", [ ...object schemas ])`. The discriminator can be a literal, a union of literals, or a pipe. Unions can nest.
- `safeParse(data)` returns a discriminated union. On success it is `{ success: true, data }`. On failure it is `{ success: false, error }`, where `error` is a `ZodError` with an `issues` array. `parse()` throws the same `ZodError`. Async refinements and transforms need `parseAsync` or `safeParseAsync`.
- Types: `z.infer<typeof S>`. With transforms, `z.input<typeof S>` and `z.output<typeof S>` differ.
- Error formatting:
  - `z.treeifyError(err)` returns a nested `{ errors, properties?, items? }` tree.
  - `z.prettifyError(err)` returns a string with one line per issue, followed by an "at path" line.
  - `z.flattenError(err)` returns `{ formErrors, fieldErrors }`.
  - `z.formatError` is deprecated in favor of `treeifyError`. `ZodError.format()` and `.flatten()` are deprecated. `.formErrors` and `.errors` were removed, so use `.issues`. `.addIssue()` and `.addIssues()` are deprecated.
- Error customization, v3 to v4:
  - A single `error` parameter takes a string or a function. `message` still works but is deprecated.
  - `invalid_type_error` and `required_error` were dropped. Use `error: (issue) => issue.input === undefined ? "required" : "not a string"`.
  - `errorMap` was renamed `error`. A function may return a string, or `undefined` to pass control to the next map.
  - A schema-level error map now takes precedence over one passed to `parse()`.
- Defaults, v3 to v4:
  - `.default(x)` short-circuits when the input is `undefined`, so `x` must match the output type. `.prefault(x)` restores the v3 behavior of parsing `x` through the schema.
  - Defaults inside optional fields now apply. `z.object({ a: z.string().default("tuna").optional() }).parse({})` gives `{ a: "tuna" }`; v3 gave `{}`.
  - `z.coerce.*` inputs are typed `unknown`, and a missing key on a coerce field now errors.
  - `z.unknown()` and `z.any()` keys are required at parse time from 4.4.0, so use `.optional()` for keys that may be absent.
- Other changes: string formats are top-level (`z.email()`, `z.uuid()`, `z.url()`, `z.ipv4()`), and the method forms are deprecated. `.ip()` and `.cidr()` were dropped. `z.uuid()` is stricter, and `z.guid()` is the loose option. `.base64url()` takes no padding. `z.number().int()` accepts safe integers only, so use `z.int()`. `z.nativeEnum()` is deprecated in favor of `z.enum(Enum)`. `z.record()` needs two arguments. `z.array().nonempty()` infers `string[]`. `z.function({ input, output })` is no longer a schema. `.refine()` no longer narrows through type predicates. `z.intersection()` merge conflicts throw a plain `Error`. `z.promise()` is deprecated. `z.ZodTypeAny` was removed in favor of `z.ZodType`.

## electron-log 5

- Install with `npm install electron-log`. v5 requires Electron 13+ or Node.js 14+. Use v4 for older runtimes.
- Main process:

```js
import log from 'electron-log/main'
log.initialize()
log.info('Log from the main process')
```
  `log.initialize()` enables renderer logging. It injects a built-in preload into the default session and into any session created after the call. Options: `getSessions: () => [customSession]`, `includeFutureSession: false` (disables injection), and `spyRendererConsole: true` (captures renderer `console` calls, but object arguments arrive degraded).
- Renderer:
  - With a bundler and contextIsolation or sandbox enabled (the docs' "most common case"), use `import log from 'electron-log/renderer'`.
  - Without a bundler, use the global `__electronLog`. It exposes log functions only, with no errorHandler or scope.
  - For manual injection, add `import 'electron-log/preload'` to your own preload script.
- Preload: the README says to import `electron-log/renderer` inside preload scripts. The `electron-log/preload` entry is only a bridge and exports no logger. Direct IPC works in a preload when contextIsolation is enabled or nodeIntegration is disabled. Send on channel `'__ELECTRON_LOG__'` with a LogMessage-like object (`data`, `level`, `variables`).
- Default log file:
  - Windows: `%USERPROFILE%\AppData\Roaming\{app name}\logs\main.log`.
  - macOS: `~/Library/Logs/{app name}/main.log`.
  - Linux: `~/.config/{app name}/logs/main.log`.
  - Override with `log.transports.file.resolvePathFn = () => path.join(APP_DATA, 'logs/main.log')`.
- Levels: `error`, `warn`, `info`, `verbose`, `debug`, `silly`.
- Transports (console and file are on by default):
  - `console`: level `'silly'`. Main format `'%c{h}:{i}:{s}.{ms}%c > {text}'`. Renderer format `'{h}:{i}:{s}.{ms} > {text}'`.
  - `file` (main only): level `'silly'`. Format `'[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'`.
  - `ipc`: shows main-process logs in the renderer DevTools. Level is `'silly'` in dev and `false` in production.
  - `remote` (main only): POSTs a JSON LogMessage to `url`. Level defaults to `false`.
  - Disable a transport by setting its level to `false`. A custom transport is a function `(msg) => void`.
- Catching: `log.errorHandler.startCatching(options?)` catches unhandled errors and rejected promises. Its options live in docs/errors.md, which was not fetched. `log.eventLogger.startLogging(options?)` logs Electron events.
- Other: `log.create({ logId })` makes separate instances, each configured on its own. `log.scope('name')` adds scope labels. `log.buffering.begin()`, `commit()` and `reject()` buffer logs. `electron-log/node` is for plain Node. Utility-process logs are not forwarded automatically.

## MediaSession

- Entry point is `navigator.mediaSession`. Do not construct it. Feature-check with `"mediaSession" in navigator`. MDN marks the API as limited availability.
- Metadata: `navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album, artwork: [{ src, sizes, type }] })`. MediaMetadata also carries chapter information.
- `playbackState` takes `"none"`, `"paused"` or `"playing"`.
- `setActionHandler(type, callback)` returns `undefined`. Pass `null` as the callback to remove a handler. The callback receives an object with an `action` property.
  - Action names listed on MDN: `enterpictureinpicture`, `hangup`, `nextslide`, `nexttrack`, `pause`, `play`, `previousslide`, `previoustrack`, `seekbackward`, `seekforward`, `seekto`, `skipad`, `stop`, `togglecamera`, `togglemicrophone`, `togglescreenshare`.
  - Extra callback fields: `seekOffset` for seekforward and seekbackward (optional), `seekTime` for seekto (required), `fastSeek` for seekto (optional), and `enterPictureInPictureReason`.
  - The MDN examples wrap calls in try/catch, which implies an unsupported name can throw. The page does not name the exception.
- `setPositionState(stateDict?)` takes `duration` (positive; `Infinity` for live streams), `playbackRate` (1 is normal, negative is reverse), and `position` (seconds). An empty object clears the state. It throws `TypeError` when duration is missing, negative or null, when position is negative or greater than duration, or when playbackRate is zero. The page does not give a playbackRate default.
- Also available: `setCameraActive()`, `setMicrophoneActive()`, and `setScreenshareActive()`.
- Autoplay: MDN notes that some browsers block autoplay on mobile until a user gesture. Its example calls `audio.play()` inside a `pointerup` handler, then sets up the session.
- With several open pages, the user agent routes actions to the right page and falls back to defaults when a page sets no handler.

## Not settled by docs

- Vitest under Electron's Node: no fetched Vitest page covers `ELECTRON_RUN_AS_NODE`. Electron's environment-variable reference (https://www.electronjs.org/docs/latest/api/environment-variables) is the place to check. It was not fetched.
- Native addons: no fetched page covers rebuilding native modules for Electron's ABI, or better-sqlite3 specifically. The pool docs name only Prisma, bcrypt and canvas.
- Vitest: install commands for jsdom and happy-dom; defaults for `fileParallelism`, `vmMemoryLimit` and `environmentOptions` (not fetched).
- Playwright: whether `@playwright/test` exports `_electron`, and the TypeScript import form. No window-size example exists, so the two routes above are inferred. Whether a `browserWindow()` JSHandle evaluates in the main process is also inferred.
- ESLint and typescript-eslint: whether flat typed-lint config needs `tsconfigRootDir`. The `tseslint.config()` helper does not appear on the fetched pages.
- no-restricted-imports: whether `importNames` covers `export { x } from` and `React.useEffect` property access.
- eslint-plugin-boundaries: the ESLint and Node versions required by v7.
- Zod: minimum TypeScript version for v4, and the `{ z }` named import.
- electron-log: sandbox specifics beyond the "most common case" note, `startCatching` options, and the file transport's `maxSize` default (docs/transports/file.md was not fetched).
- MediaSession: the criteria for an active session (which page's session is shown or receives media keys), whether silent or muted audio counts, the `setPositionState` playbackRate default, and the exception type for unsupported action names. The W3C spec at https://w3c.github.io/mediasession/ is the place to check. It was not fetched.
