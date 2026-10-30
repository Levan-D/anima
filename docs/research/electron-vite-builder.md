# electron-vite 6 / Vite 8 / electron-builder 26 reference notes

## Sources

Read successfully:
- https://electron-vite.org/guide/
- https://electron-vite.org/guide/dev
- https://electron-vite.org/guide/build
- https://electron-vite.org/guide/assets
- https://electron-vite.org/guide/env-and-mode
- https://electron-vite.org/guide/hmr-and-hot-reloading
- https://electron-vite.org/guide/dependency-handling
- https://electron-vite.org/guide/typescript
- https://electron-vite.org/guide/isolated-build
- https://electron-vite.org/guide/source-code-protection
- https://electron-vite.org/guide/troubleshooting
- https://electron-vite.org/guide/distribution
- https://electron-vite.org/guide/migration
- https://electron-vite.org/config/
- https://github.com/alex8088/electron-vite/blob/master/CHANGELOG.md
- https://vite.dev/guide/migration (titled "Migration from v7", covers v8 changes)
- https://vite.dev/guide/
- https://github.com/electron-userland/electron-builder (README)
- https://github.com/electron-userland/electron-builder/blob/master/MIGRATION.md
- https://github.com/electron-userland/electron-builder/tree/master/website
- https://github.com/electron-userland/electron-builder/tree/master/website/docs
- https://github.com/electron-userland/electron-builder/tree/master/website/docs/features
- https://github.com/electron-userland/electron-builder/blob/master/website/docs/configuration.md
- https://github.com/electron-userland/electron-builder/blob/master/website/docs/win.md
- https://github.com/electron-userland/electron-builder/blob/master/website/docs/nsis.md
- https://github.com/electron-userland/electron-builder/blob/master/website/docs/file-patterns.md
- https://github.com/electron-userland/electron-builder/blob/master/website/docs/contents.md
- https://github.com/electron-userland/electron-builder/blob/master/website/docs/toolsets.md
- https://github.com/electron-userland/electron-builder/blob/master/website/docs/troubleshooting.md
- https://github.com/electron-userland/electron-builder/blob/master/website/docs/cli.md
- https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/security.md
- https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/icons-and-images.md
- https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/code-signing/code-signing-win.md
- https://github.com/electron-userland/electron-builder/blob/master/website/docs/tutorials/adding-electron-fuses.md

## Version caveats

- **electron-vite:** the site header reads v5.0.0 and every docs page describes v5. The CHANGELOG has a 6.0.0 entry dated 2026-10-15, with betas from 6.0.0-beta.0 (2026-04-09). No v6 docs page was readable, so v6 facts below come from the changelog only.
- **Vite:** the docs header reads v8.3.4. The brief's npm target is 8.3.5.
- **electron-builder:** the docs read are the master branch, which is v27. The README calls v27 the current major and requires Node.js >=22.12.0. The 26.x key names below come from MIGRATION.md's v26-to-v27 mapping, not from v26 docs. I did not check npm dist-tags, so I cannot confirm 26.18.0 is still latest.

## electron-vite

**Layout and config**
- Default entries: main `src/main/{index|main}.{js|ts|mjs|cjs}`, preload `src/preload/{index|preload}.{js|ts|mjs|cjs}`, renderer `src/renderer/index.html`. A missing entry is an error; override with `build.rollupOptions.input`.
- Output: `out/main`, `out/preload`, `out/renderer`. Change with `--outDir=dist` or per-process `build.outDir`. package.json needs `"main": "./out/main/index.js"`.
- Config file: `electron.vite.config.ts` (also .js/.mjs/.cjs/.mts/.cts; `--config` overrides). Shape is `defineConfig({ main, preload, renderer })`. A top-level function `({ command, mode })` is allowed, with `command === 'serve'` for dev. Since v5, nested main/preload/renderer values must be static objects.
- Commands: `electron-vite dev`, `build`, `preview`. Args after `--` go to Electron (`dev -- p1 p2`). Dev also accepts `--inspect`, `--inspect-brk`, `--remote-debugging-port`, `--no-sandbox`.
- Stated requirements: Node 20.19+ or 22.12+. The same page also says "Vite 5.0+", which is stale.

**Externalizing dependencies (replaces externalizeDepsPlugin)**
- `externalizeDepsPlugin` was deprecated in v5. Use `build.externalizeDeps`, which is on by default.
- Main and preload: `dependencies` stay external. `devDependencies` and undeclared (phantom) packages are bundled if imported. Renderer: `dependencies` are bundled.
- `electron` and Node built-ins are external by default.
- `build.externalizeDeps: { exclude: ['foo'] }` bundles `foo`. `include` is named in prose with no example. `build.externalizeDeps: false` bundles everything.
- Node addons stay external via `build.rollupOptions.external: ['sqlite3']` (docs example).

**?modulePath and ?nodeWorker**
- `import workerPath from './worker?modulePath'`: the default export is the worker bundle path. The docs call this the recommended form for `new Worker(workerPath)` from `node:worker_threads`.
- `import createWorker from './worker?nodeWorker'`: the default export is a constructor. `createWorker({ workerData })` returns a Worker.
- `?modulePath` also serves `utilityProcess.fork()` and child_process fork.
- Modules imported with `?modulePath` get isolated builds by default in v5. The v6 changelog refactors the "?modulePath sub-build output strategy", but no page describes the new layout.
- Types: the docs only say to add `/// <reference types="electron-vite/node" />` or `compilerOptions.types: ["electron-vite/node"]`. The declaration text is not shown.

**Sandboxed preload**
- Preloads are sandboxed by default since Electron 20. A sandboxed preload can require only `events`, `timers`, `url`, and Electron renderer modules. Polyfilled globals are Buffer, process, setImmediate, and clearImmediate. Other imports fail with "Unable to load preload scripts -> Error: module not found".
- Option 1: `webPreferences: { sandbox: false }`.
- Option 2: bundle everything into one file with `preload.build.externalizeDeps: false`. With several preload entries that share imports, also set `build.isolatedEntries: true`.
- An ESM preload must be unsandboxed and end in `.mjs`. A sandboxed preload must be a single CJS file.
- Bytecode for preload also requires `sandbox: false`.

**Multiple entries**
- Renderer: `renderer.build.rollupOptions.input` takes a name-to-HTML map. Set `renderer.root: '.'` if the HTML is outside `src/renderer`.
- Preload: same map shape under `preload.build.rollupOptions.input`.
- Dev URL per page: `${process.env['ELECTRON_RENDERER_URL']}/view.html`. Prod: `loadFile(... '../renderer/view.html')`.
- Renderer `build.isolatedEntries: true` reduces chunk count.

**ESM vs CJS**
- Built-in main/preload `build.lib.formats` is `cjs` or `es`. `es` requires Electron 28+.
- ESM is enabled by `"type": "module"` in the nearest package.json (main becomes ESM, preload becomes `.mjs`), or by `build.rollupOptions.output.format: 'es'`. With `"type": "module"` on Electron below 28, output is CJS with `.cjs`.
- In ESM, `require` and `__dirname` are unavailable. The docs use `import.meta.dirname` or `fileURLToPath(new URL(..., import.meta.url))`. The docs also say electron-vite tolerates some CJS syntax, including `__dirname`. The ESM example shows a ReferenceError for `__dirname`, and the docs do not reconcile the two.
- Named imports from CJS-only packages can fail under ESM (`import { autoUpdater }` example). Default import works.
- Source-code protection supports CJS only.

**Assets and native modules**
- Public dir for main and preload: `<root>/resources` (`main.publicDir`, `preload.publicDir`). Public files are not copied to `out`, so electron-builder must package them.
- `import p from '../../build/icon.ico?asset'` gives a path string. Non-public assets are copied to `out/main/chunks/` (`build.assetDir` defaults to `chunks`).
- `?asset&asarUnpack` rewrites the path from `app.asar` to `app.asar.unpacked`.
- `?commonjs-external&asset` imports JSON as a file path.
- `.node` addon: either `import addon from '../../resources/hello.node'`, or `?asset` plus `createRequire(import.meta.url)`. The docs say addons depend on platform and arch, so the `?asset` form is the safer choice for multi-arch builds.
- `.wasm` via `?loader` (main process only).

**Env**
- Prefixes: `MAIN_VITE_` (main), `PRELOAD_VITE_` (preload), `RENDERER_VITE_` (renderer), `VITE_` (all). Override per process with `envPrefix`.
- Types: `/// <reference types="vite/client" />` plus an `ImportMetaEnv` interface.
- Modes: dev runs development; build and preview run production. `--mode` overrides.
- Conflict: the env page says env files load from the project root like Vite. The config page says electron-vite does not load `.env` by default and provides `loadEnv(mode)`.

**HMR and hot reload**
- Renderer HMR: `if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL'])` then `loadURL`, else `loadFile`. Dev HTML needs `<script type="module">`.
- Main and preload restart: `electron-vite dev --watch` (`-w`, preferred) or `build.watch: {}`. A main change rebuilds and restarts. A preload change rebuilds and reloads the renderer. Dev only.

**Source-code protection**
- `build.bytecode: true` or a `BytecodeOptions` object on main or preload. Production builds only.
- Options: `chunkAlias` (string or string[]), `transformArrowFunctions` (default true), `removeBundleJS` (default true), `protectedStrings` (string[]).
- Limits: `Function.prototype.toString` is unsupported. Caches are tied to the Node/V8 version and CPU arch, and cross-platform use is not recommended. Set `ELECTRON_EXEC_PATH` to compile for another arch.
- Runtime error text: "Invaild or incompatible cached data (cachedDataRejected)". Fix by compiling on the target platform and arch.
- ASAR integrity needs Electron 16+ on macOS and 30+ on Windows.

**TypeScript, isolated builds, other troubleshooting**
- Decorators: `swcPlugin` (exported by electron-vite) goes in `main.plugins` and needs `@swc/core`. The decorator content is on /guide/typescript. There is no separate typescript-decorator page in the sidebar.
- `build.isolatedEntries` is a boolean. The docs example has a full-width comma typo (`isolatedEntries: true，`).
- "Module externalized for browser compatibility" or `__dirname` in renderer: Node is not available in renderer, and nodeIntegration is unsupported.
- Routers: in production use a hash router (`createWebHashHistory` / `HashRouter`), and pass `{ hash: 'home' }` to `loadFile`.
- Packaged "Cannot find module": move the package from devDependencies to dependencies.
- `ERR_REQUIRE_ESM`: add the package to `build.externalizeDeps.exclude`.

**Deprecations and version history**
- v4 to v5: `externalizeDepsPlugin` becomes `build.externalizeDeps`. `bytecodePlugin` becomes `build.bytecode`. Function-valued nested configs are removed. The isolate options moved under `build`.
- v4 (2025-07-06) required Node 20.19+ and 22.12+, moved to Vite 7, and removed the electron-vite CJS build.

**v6.0.0 (CHANGELOG, 2026-10-15)**
- Breaking entries (`!`): "simplify resolve config and isolate user config for sub-builds"; "invoke the bytecode compiler only once"; "compatible with rollupOptions and rolldownOptions"; "use this.parse to find the last static import" (esmShim); update vite to v8; update magic-string to v1; update @babel/* to v8. An earlier entry also downgrades @babel/* to v7 for Node requirements, so the final state is unclear.
- Other: the ?modulePath output strategy is refactored. Bytecode is compiled through the Electron main or renderer process, not ELECTRON_RUN_AS_NODE. The config file is bundled with Rolldown instead of esbuild. swcPlugin disables oxc on Vite 8. Build compat targets are added for Electron 42, 43, and 44. Dev forwards termination signals to the Electron child. chunkAlias accepts RegExp.

## Vite 8 (from the migration page)

- **Bundler:** Rolldown and Oxc replace Rollup and esbuild. esbuild is now an optional dependency.
- **Deprecated renames (old names still work):**
  - `build.rollupOptions` becomes `build.rolldownOptions`.
  - `worker.rollupOptions` becomes `worker.rolldownOptions`.
  - `esbuild` becomes `oxc`.
  - `optimizeDeps.esbuildOptions` becomes `optimizeDeps.rolldownOptions`.
  - `transformWithEsbuild` becomes `transformWithOxc`.
  - `parseAst` becomes `parseSync` or `parse`.
- **Removed or replaced:**
  - `build.rollupOptions.watch.chokidar` is removed; use `build.rolldownOptions.watch.watcher`.
  - Object-form `output.manualChunks` is removed. The function form is deprecated in favor of `codeSplitting`.
  - Passing a URL to `import.meta.hot.accept` is removed.
- **No-ops:** `build.commonjsOptions` and `build.dynamicImportVarsOptions.warnOnError`.
- **Minify:** Oxc minifier. `build.minify: 'esbuild'` is a deprecated switch-back. CSS minification uses Lightning CSS, with `build.cssMinify: 'esbuild'` as the switch-back.
- **CJS interop:** default-import rules changed. `legacy.inconsistentCjsInterop: true` restores the old behavior but is deprecated. `require()` calls to externalized modules are now preserved; `esmExternalRequirePlugin` converts them. Format sniffing for browser/module fields is removed, so `resolve.mainFields` order is respected. `import.meta.url` is no longer polyfilled in UMD/IIFE output.
- **Errors:** `build()` throws `BundleError`, with individual errors in `.errors`.
- **Targets:** the `build.target` default `'baseline-widely-available'` moved to Chrome 111, Edge 111, Firefox 114, Safari 16.4.
- **Decorators:** Oxc does not lower native decorators. The docs suggest a Babel or SWC workaround.
- **Rolldown gaps:** `output.format` `'system'` and `'amd'` are unsupported.
- **Node:** Vite requires 20.19+ or 22.12+ (vite.dev/guide).

## electron-builder (docs are master/v27; 26.x notes)

**Version and config location**
- v27 requires Node.js >=22.12.0 and is native ESM. The `build()` API is unchanged and CJS `require` still works.
- Config: a `build` key in package.json, or `electron-builder.yml` (also json, json5, toml, js, ts via `--config`). `directories.output` defaults to `dist`.
- Implicit `--publish` is removed in v27. Pass `--publish` explicitly.

**26.x to 27.x key map (MIGRATION.md)**

| Concern | 26.x key | 27.x key |
|---|---|---|
| ASAR unpack | `asarUnpack` | `asar.unpack` |
| Bundled files | `files`, `extraResources`, `extraFiles` | `fileOptions.files`, `fileOptions.extraResources`, `fileOptions.extraFiles` |
| Windows signing | `win.signtoolOptions`, `win.azureSignOptions`, `signExecutable`, `signAndEditExecutable` | `win.sign` (type: signtool, hsm, pkcs11, azure); `signExecutable: false` becomes `win.sign: false`. The target for `signAndEditExecutable` is not spelled out. |
| Electron download mirror | `electronDownload` | `electronGet` |
| Native rebuild | `nativeRebuilder`, `npmSkipBuildFromSource` | `rebuildMode`, `buildDependenciesFromSource`, grouped under `nativeModules` |
| Default-ignore override | `disableDefaultIgnoredFiles`, `includePdb` | `fileOptions.files` naming the file; `fileOptions.excludedExts` |

- ia32 builds need Electron 43 or lower. Electron 44 removed Windows ia32, so an Electron 45 target has no ia32.

**Minimal Windows NSIS config**
- Every key below is documented. The combination is composed here, not copied from a documented sample.
- Windows target defaults to NSIS when no target is set.
- NSIS defaults to one-click. `nsis.oneClick: false` gives the assisted installer.

```yaml
appId: com.example.player          # NSIS GUID is derived from appId; keep it stable
productName: Player
directories:
  buildResources: build            # default is build
win:
  executableName: player
  icon: build/icon.ico             # optional; auto-discovered from build/
nsis:
  artifactName: ${name}-${version}-setup.${ext}
  shortcutName: ${productName}
  uninstallDisplayName: ${productName}
  createDesktopShortcut: always
asarUnpack:                        # 26.x; 27.x: asar.unpack
  - resources/**
extraResources:                    # 26.x root key; 27.x: fileOptions.extraResources
  - from: resources/mpv
    to: mpv
```

**Runtime resources and asar**
- `extraResources` lands in `resources/` on Windows and Linux (`Contents/Resources/` on macOS). `from` is relative to the project dir, `to` is relative to the resources dir, and `filter` defaults to `**/*`.
- Read these at runtime with `process.resourcesPath`. The docs recommend this for native binaries and CLI tools.
- The electron-vite docs say Node's child_process.exec and spawn cannot execute binaries inside asar. Keep spawned binaries in extraResources or unpack them.
- Unpack patterns from the docs: `**/*.node`, `node_modules/better-sqlite3/**`, `resources/**`, `resources/ffmpeg`.
- `asar.smartUnpack` defaults to true in v27. It auto-unpacks executables and native modules.
- Runtime error "Module did not self-register" means a native module sits inside asar.

**File selection**
- Default is `**/*` minus built-in excludes (devDependencies, `.git`, `*.pdb`, `*.obj`, and others). `package.json` and production node_modules are always included.
- If any non-`!` pattern appears in `files`, `**/*` is not added automatically.
- The electron-vite sample excludes `!src/**` and `!electron.vite.config.{js,ts,mjs,cjs}`.
- Macros: `${arch}`, `${os}`, `${platform}`, `${name}`, `${productName}`, `${version}`, `${channel}`, `${env.NAME}`.

**Native modules**
- electron-builder rebuilds native modules for the target Electron during a build.
- `electron-builder install-app-deps` is the command. The README suggests it as a postinstall script.
- `electron-builder node-gyp-rebuild` builds your own addons. The README pairs it with `nativeModules.nodeGypRebuild: true`.
- The electron-vite sample sets `npmRebuild: false`.

**electronFuses**
- Config key `electronFuses` (type `FuseOptionsV1`). Keys in the electron-builder tutorial: `runAsNode`, `enableCookieEncryption`, `enableNodeOptionsEnvironmentVariable`, `enableNodeCliInspectArguments`, `enableEmbeddedAsarIntegrityValidation`, `onlyLoadAppFromAsar`, `loadBrowserProcessSpecificV8Snapshot`, `grantFileProtocolExtraPrivileges`.
- The tutorial's true/false values are examples, not defaults.
- Fuses are flipped at package time, before code signing.
- Alternative: an afterPack hook calling `context.packager.addElectronFuses(context, fuses)` with `@electron/fuses`. Use `strictlyRequireAllFuses` to fail on missing fuses.
- Verify with `npx @electron/fuses read --app <path>`.
- ASAR integrity is on by default. `asar.disableIntegrity: true` turns it off.
- Key casing conflict: the electron-vite source-protection page uses PascalCase (`EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar`) in electron-builder.yaml. The electron-builder tutorial uses camelCase. Check against the FuseOptionsV1 type.

**Windows signing and winCodeSign**
- `win.sign` unset: credentials come from the environment (`WIN_CSC_LINK` or `CSC_LINK`, with `WIN_CSC_KEY_PASSWORD` or `CSC_KEY_PASSWORD`).
- `type: "signtool"` is the default. It dual-signs with SHA-1 and SHA-256 unless `signingHashAlgorithms` changes it.
- `hsm` (Windows only), `pkcs11` (macOS/Linux), and `azure` are marked beta.
- `win.sign: false` or `null` disables signing. Resource editing still runs.
- `win.verifyUpdateCodeSignature` defaults to true. In v27, `publisherName` must be a distinguished name; a bare name fails the build.
- winCodeSign is the toolset for signtool, osslsigncode, and rcedit. It downloads on first use and is cached as an archive. The Windows cache default is `%LOCALAPPDATA%/electron-builder/Cache`, and `ELECTRON_BUILDER_CACHE` overrides it.
- v27-only: `toolsets.winCodeSign: { url: "file:///..." }` pointing at a bare directory is used as-is, with no extraction and no checksum. The layout must match the built-in bundle. This is the only documented way I found to skip archive extraction.
- Default winCodeSign is 1.3.3 in v27. `"0.0.0"` pins the legacy bundle.

**Icons**
- Location: `build/` (`directories.buildResources`, default `build`).
- Windows accepts `.svg`, `.png`, or `.ico`. Minimum 256×256; recommended 512×512 or SVG. A pre-built `build/icon.ico` skips conversion.
- Search order: explicit `win.icon`, `icon.<format>`, `icon.png`, `icon.svg`, `icon.icns`, then an `icons/` or `icon/` directory. With no icon, the default Electron icon is used.
- NSIS images: installerHeader 150×57 BMP; installerSidebar and uninstallerSidebar 164×314 BMP (24-bit RGB, no alpha); installerIcon and uninstallerIcon `.ico`.

**NSIS notes**
- Unicode is on by default. Strings can be up to 8192 bytes.
- `nsis.guid` derives from appId (UUID v5). Do not change appId after release.
- Call `app.setAppUserModelId(appId)` before any BrowserWindow.
- `nsis.include` is recommended for custom macros. `nsis.script` replaces the whole script and disables the generated uninstaller and size verification.
- `electron-builder --dir` builds an unpacked directory for quick tests.

## Not settled by docs

- **electron-vite 6 docs:** none were readable. Its Node floor is not stated. Electron 45 is not in the changelog's compat list (42–44). The changelog says vite was updated to v8; no peer range was read.
- **?modulePath / ?nodeWorker:** TypeScript declaration text, and the output file layout for worker bundles.
- **import.meta.glob and ?raw in the main build:** no page read covers either.
- **.env loading:** the env page and config page disagree (see Env above).
- **rollupOptions vs rolldownOptions:** which name v6 docs prefer. The changelog says both work.
- **Renderer target:** whether electron-vite's `chrome*` target overrides Vite 8's new default. Not stated.
- **electron-builder 26.x:** option defaults, the `npmRebuild` default, whether `npmRebuild` moved under `nativeModules` in v27, whether `electronFuses` exists in 26.x (the tutorial is master), and v26 `signAndEditExecutable` semantics.
- **winCodeSign symlink privilege failure:** cause and a fix without Developer Mode. None of the pages read mention symlinks, "required privilege," or Developer Mode. The v27 levers above are documented but not verified against this error.
- **Option tables:** the GitHub source leaves the Common, Windows, and NSIS config tables as unexpanded placeholders. Many defaults (for example `nsis` artifact and install-mode defaults) are unconfirmed.
- **Dev-mode paths:** how `process.resourcesPath` and extraResources paths resolve during `electron-vite dev`. The docs describe only the packaged layout.
- **26.18.0 latest status:** not checked against npm.

## Fetch failures

- `https://electron-vite.org/guide/hmr` returned 404. `https://electron-vite.org/guide/hot-reloading` returned 404. Not retried. Used the sidebar-linked `/guide/hmr-and-hot-reloading`.
- `https://www.electron.build/configuration`, `/nsis`, `/win`, `/file-patterns`, and `/contents` returned HTTP 200 with empty bodies (client-rendered). Used the same docs source in the electron-userland/electron-builder repo under `website/docs`.
- `https://www.electron.build/electron-fuses` and `/install-app-deps` returned 404. Not retried. Used `website/docs/tutorials/adding-electron-fuses.md` and `website/docs/cli.md` instead.
- `https://github.com/electron-userland/electron-builder/tree/master/docs` returned 404. The docs live under `website/docs`.
- Not fetched: electron-vite `/guide/typescript-decorator` (not in the sidebar). electron.build's v27 breaking-changes page (JS-rendered; MIGRATION.md summarizes it).
