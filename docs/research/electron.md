# Electron 45.1.0 reference notes: security, processes, protocol, windows

## Sources (pages read)

- https://www.electronjs.org/docs/latest/tutorial/security
- https://www.electronjs.org/docs/latest/tutorial/sandbox
- https://www.electronjs.org/docs/latest/tutorial/context-isolation
- https://www.electronjs.org/docs/latest/api/context-bridge
- https://www.electronjs.org/docs/latest/tutorial/ipc
- https://www.electronjs.org/docs/latest/api/structures/ipc-main-event
- https://www.electronjs.org/docs/latest/tutorial/esm
- https://www.electronjs.org/docs/latest/tutorial/process-model
- https://www.electronjs.org/docs/latest/api/protocol
- https://www.electronjs.org/docs/latest/api/structures/custom-scheme
- https://www.electronjs.org/docs/latest/api/global-shortcut
- https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts
- https://www.electronjs.org/docs/latest/api/browser-window
- https://www.electronjs.org/docs/latest/api/structures/browser-window-options
- https://www.electronjs.org/docs/latest/api/structures/base-window-options
- https://www.electronjs.org/docs/latest/tutorial/window-customization
- https://www.electronjs.org/docs/latest/tutorial/custom-title-bar
- https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions
- https://www.electronjs.org/docs/latest/api/utility-process
- https://www.electronjs.org/docs/latest/api/app
- https://www.electronjs.org/docs/latest/api/shell
- https://www.electronjs.org/docs/latest/api/dialog
- https://www.electronjs.org/docs/latest/api/session
- https://www.electronjs.org/docs/latest/api/net
- https://www.electronjs.org/docs/latest/tutorial/fuses
- https://www.electronjs.org/docs/latest/tutorial/asar-integrity
- https://www.electronjs.org/docs/latest/tutorial/automated-testing
- https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules
- https://www.electronjs.org/docs/latest/breaking-changes
- https://releases.electronjs.org/
- https://releases.electronjs.org/release/v45.1.0

Named but not fetched: tutorial/native-code-and-electron, api/command-line-switches (linked from the sandbox doc), api/web-contents, api/structures/thumbar-button, api/structures/render-process-gone-details, api/structures/window-open-handler-response.

## Version facts

- Electron 45.1.0 is the stable release (released Oct 27, 2026). It embeds Chromium 156.0.8078.49, Node.js 24.22.1 and V8 15.6.75.19.
- The releases index shows a v45.2.0 build in progress. It was not listed as stable.
- The testing doc's Playwright example was written against @playwright/test 1.52.0.

## Highest-impact items for this project

- Sandboxed preloads (45.0): `Buffer`, `setImmediate`, `clearImmediate`, and the `events`/`timers`/`url` require shims are gone.
- Dialogs (43.0): `defaultPath` now defaults to Downloads (or home). Pass the music root explicitly.
- Packaging (42.0): the `electron` npm package no longer downloads in postinstall. The binary arrives on the first `electron` bin run.
- Clipboard (44.0): `clipboard` is removed from renderers. Main-process clipboard methods are Promise-based.
- Architecture (44.0): Windows ia32 binaries are no longer published.
- Protocols: `registerSchemesAsPrivileged` is one-shot, before ready. `protocol.handle` is per session.
- Native modules (better-sqlite3): rebuild after every Electron upgrade.

## 1. Security checklist (local app with a custom protocol)

- Node integration is off by default (since 5.0.0). Never enable it for remote content.
- Context isolation is on by default (since 12.0.0). Turning it off also disables the sandbox.
- The sandbox is on for renderers by default (since 20.0.0). `nodeIntegration: true` disables it. `sandbox: false` disables it per window. `app.enableSandbox()` must run before ready and overrides `sandbox: false`. `--no-sandbox` also disables utility processes (testing only).
- Keep `webSecurity` true. Setting it false disables same-origin and turns on `allowRunningInsecureContent`. Defaults: `allowRunningInsecureContent` false, `experimentalFeatures` false, `webviewTag` false. Avoid `enableBlinkFeatures`.
- Permissions: Electron auto-approves all permission requests unless a handler is set. Set `session.setPermissionRequestHandler((webContents, permission, callback, details) => …)` and `session.setPermissionCheckHandler(...)`. The docs say both are needed for complete handling. Checklist item 5 targets sessions that load remote content.
- CSP: use either a `Content-Security-Policy` header via `session.defaultSession.webRequest.onHeadersReceived((details, callback) => …)`, or a `<meta http-equiv="Content-Security-Policy">` tag. The header route cannot be used for `file://`. Doc samples use `default-src 'self'; script-src 'self'`. The title bar sample adds `style-src 'self' 'unsafe-inline'`. A scheme registered with `bypassCSP: true` skips CSP for its resources.
- Navigation: use `contents.on('will-navigate', (event, navigationUrl) => …)` and call `event.preventDefault()` to block. Parse with `new URL()` and compare `origin`. Prefix string checks are bypassable (the docs cite `https://example.com.attacker.com`).
- Window open: `contents.setWindowOpenHandler(({ url }) => …)`. The default deny response is `{ action: 'deny' }`. The opt-in form is `{ action: 'allow', overrideBrowserWindowOptions: {…} }`.
- Never pass untrusted input to `shell.openExternal`.
- If `<webview>` is used, handle `will-attach-webview`. Delete `webPreferences.preload`, set `nodeIntegration = false`, and validate `params.src`.
- IPC sender validation: check `event.senderFrame` (WebFrameMain or null) and compare `senderFrame.origin` against an allowlist. Compare origin, not URL, because `about:blank`, `blob:`, and sandboxed documents' URLs don't identify their controller. `senderFrame` can be null after navigation or destruction.
- Don't expose `ipcRenderer` itself, and don't pass raw IPC callbacks through contextBridge, since the event exposes `sender`. Wrap them as `(_event, value) => callback(value)`.
- Avoid `file://`, since such pages can read any file. Serve through `protocol.handle` on a custom scheme.
- `grantFileProtocolExtraPrivileges` is enabled by default. Disable that fuse if you don't use `file://`.
- Keep Electron current, and migrate one major version at a time (checklist 16).
- Security warnings print only when the binary is named Electron. `ELECTRON_ENABLE_SECURITY_WARNINGS` and `ELECTRON_DISABLE_SECURITY_WARNINGS` force them on or off.

## 2. Processes, IPC, contextBridge

- The main process runs Node.js and owns `app` and `BrowserWindow`. Destroying a window terminates its renderer. Preload is set with `webPreferences.preload`, which takes an absolute path.
- Renderer→main, one-way: `ipcRenderer.send(channel, ...args)` pairs with `ipcMain.on(channel, (event, ...args) => …)`.
- Renderer→main, two-way: `ipcRenderer.invoke(channel, ...args)` (returns a Promise) pairs with `ipcMain.handle(channel, (event, ...args) => …)`. Errors thrown in a handler reach the renderer with only `message`.
- Legacy: `event.reply`, `ipcRenderer.sendSync` (blocks; the docs advise against it), and `event.returnValue`.
- Main→renderer: `webContents.send(channel, ...args)` pairs with `ipcRenderer.on` in the preload. There is no invoke equivalent.
- Renderer→renderer: no direct channel. Relay through main, or pass MessagePorts.
- `IpcMainEvent` fields: `type` (`'frame'`), `processId`, `frameId`, `returnValue`, `sender` (WebContents), `senderFrame` (WebFrameMain or null, read-only), `ports`, and `reply(channel, ...args)`.
- Not serializable by structured clone: DOM objects, C++-backed Node objects (`process.env`, some Stream members), and Electron objects (WebContents, BrowserWindow, WebFrame).
- contextBridge: `exposeInMainWorld(apiKey, api)`. `api` must be a Function, string, number, Array, boolean, or nested objects of those with string keys. Functions are proxied. Other values are copied and frozen, so later changes don't cross the bridge. Symbols and prototypes are dropped. Errors are copied, which can change `message`/`stack` and lose custom properties. Promises and cloneable types work. Sending `ipcRenderer` yields an empty object; since 29.0.0 it cannot be sent. **Correction, measured on 45.1.0:** not when it comes back as a return value. `() => ipcRenderer.removeListener(channel, fn)` implicitly returns the emitter, and the page received its own properties, `_events` included, with the other listeners as callable proxies. Prototype methods such as `send` and `invoke` were dropped. An exposed function has to return nothing, so use a block body.
- `exposeInIsolatedWorld(worldId, apiKey, api)`: world 999 is the preload context, so use 1000 or higher. `executeInMainWorld` is experimental.
- Process scope: `app`, `dialog`, `session`, `protocol`, `globalShortcut`, and `BrowserWindow` are main-only. `shell` works in main or non-sandboxed renderers, not sandboxed ones. `net` works in main and utility processes.

### utilityProcess

- `utilityProcess.fork(modulePath[, args][, options])` can only be called after `ready`.
- Options and defaults: `env` (default `process.env`), `execArgv`, `cwd`, `session` or `partition`, `stdio` (default `inherit`; `pipe`, `ignore`, or `inherit`; stdin must be `ignore`), `serviceName` (default `"Node Utility Process"`), `respondToAuthRequestsFromMainProcess` (default false). macOS-only: `allowLoadingUnsignedLibraries`, `disclaim`.
- Instance: `postMessage(message, [transfer])`, `kill()` (returns boolean; SIGTERM on POSIX), `pid` (undefined before spawn and after exit), `stdout`/`stderr` (null unless piped). Events: `spawn`, `error` (experimental), `exit(code)`, `message`, `login`.
- In the child, use `process.parentPort`.
- Utility processes can open MessagePort channels to renderers. Custom protocols are not supported inside them.
- If the `runAsNode` fuse is disabled, `child_process.fork` throws. The docs recommend utility processes instead.

## 3. Sandboxed and ESM preloads

- A sandboxed preload's `require` loads only `electron` (aliases `electron/renderer` and `electron/common`). That covers `contextBridge`, `crashReporter`, `ipcRenderer`, `nativeImage`, `webFrame`, and `webUtils`. `process` is reduced, and `global` aliases `globalThis`.
- As of 45.0, `require('events')`, `require('timers')`, and `require('url')` are gone in sandboxed preloads. `Buffer`, `setImmediate`, and `clearImmediate` are no longer in scope. Replacements: `EventTarget`/`Event`; `setTimeout`/`clearTimeout`/`queueMicrotask`; `URL`/`URLSearchParams`; `Uint8Array`, `TextEncoder`/`TextDecoder`, `atob`/`btoa`; or a bundled polyfill.
- As of 45.0, `ipcRenderer`, `webFrame`, and the preload `process` use a native EventEmitter. Instance methods are unchanged. The static helpers `once`, `listenerCount`, and `init` from `require('events')` are not provided.
- A sandboxed preload cannot be split into several CommonJS files, because `require` cannot load files. Bundle it (the docs name webpack or Parcel).
- Sandboxed preloads run as plain JavaScript. ESM `import` is unsupported in them.
- Unsandboxed preloads with contextIsolation can be ESM. They must use the `.mjs` extension, because `"type": "module"` is ignored for preloads. They use Node's ESM loader. Dynamic `import()` works only with contextIsolation on.
- An unsandboxed ESM preload can run after page load if the page body is empty (Content-Length 0). A CommonJS preload always blocks page load.
- Renderer ESM uses Chromium's loader. It cannot import Node built-ins or bare `node_modules` packages, so bundle renderer code.

## 4. ESM in the main process

- Supported since 28.0.0.
- Enabled by Node's rules: a `.mjs` file, or a nearest `package.json` with `"type": "module"`.
- Modules load asynchronously. Only static imports' side effects run before `ready`. A top-level dynamic `import()` may resolve after `ready`. Await anything that must run before ready, such as `app.setPath`.
- Code transpiled from CommonJS can change timing, because `require` is synchronous.

## 5. Custom protocols

- `protocol.registerSchemesAsPrivileged(customSchemes)`: call before ready, and only once. Entries are `{ scheme, privileges }`. All privileges default to false:
  - `standard`: uses RFC 3986 generic syntax, so relative URLs resolve and the FileSystem API works. Non-standard schemes have localStorage, sessionStorage, WebSQL, IndexedDB, and cookies disabled.
  - `secure`: listed only, with no behavior described.
  - `bypassCSP`: skips CSP for the scheme's resources.
  - `allowServiceWorkers`: allows service worker registration.
  - `supportFetchAPI`: enables fetch.
  - `corsEnabled`: default false. No description in the pages read.
  - `stream`: for streaming media. `<video>` and `<audio>` expect buffered responses unless this is set.
  - `codeCache`: V8 code cache. Works only with `standard: true`.
  - `allowExtensions`: allows Chrome extensions on pages served from the scheme.
- `protocol.handle(scheme, handler)`: call after ready. The handler receives a GlobalRequest and returns a `Response` or a Promise of one.
  - `request.initiatorOrigin` is the origin that issued the request. It is null for opaque origins and absent for browser-started requests. Page code cannot control it, so prefer it for access decisions.
  - To serve a file, return `net.fetch(pathToFileURL(p).toString())`. The docs guard paths with `path.relative(root, p)`, rejecting empty results, results starting with `..`, and absolute results.
- Session scope: a protocol belongs to one session. For windows using `partition` or `session`, register on that session with `session.fromPartition(p).protocol.handle(...)`. Module-level calls apply only to the default session.
- `protocol.unhandle(scheme)` removes a handler or source. `protocol.isProtocolHandled(scheme)` checks both.
- `protocol.registerSource(scheme, source)` is experimental. It serves directories with no JavaScript handler.
  - `routes` take `match: { host, path }` and `source: { type: 'directory', root, headers? }`. The longest path prefix wins.
  - Paths outside `root`, missing files, unmatched routes, and methods other than GET or HEAD fail with `net::ERR_FILE_NOT_FOUND`. A trailing `/` serves the route's `index`.
  - Files stream like `file:` URLs, including from asar. `webRequest` listeners still apply.
  - 45.1.0 fixed fetch-rule parity with `protocol.handle`.
- The `register*Protocol` and `intercept*Protocol` methods were deprecated in 25.0.0. Use `protocol.handle`.
- `net.fetch` uses the default session. It supports custom protocols and `file:`. Setting `bypassCustomProtocolHandlers: true` forwards a request to the built-in handler. It doesn't support `data:` or `blob:`, ignores `integrity`, and returns incorrect `Response.type` and `.url`. It requires ready.

## 6. Windows window features (BrowserWindow)

- Thumbnail toolbar: `win.setThumbarButtons(buttons)` returns a boolean. The docs say to keep it at no more than 7 buttons. Each button has `icon` (NativeImage), `click`, optional `tooltip`, and optional `flags` (default `['enabled']`). Flags: `enabled`, `disabled`, `dismissonclick`, `nobackground`, `hidden`, `noninteractive`. Once added, the toolbar cannot be removed. Pass `[]` to clear its buttons.
- Overlay icon: `win.setOverlayIcon(overlay, description)` takes a 16×16 image. Pass `null` to clear it.
- Progress: `win.setProgressBar(progress[, options])`. Range is 0 to 1.0. A negative value removes the bar, and a value above 1 switches to indeterminate. `options.mode` (Windows) is `none`, `normal`, `indeterminate`, `error`, or `paused`. Without a mode, a value in range uses `normal`.
- Always on top: `win.setAlwaysOnTop(flag[, level][, relativeLevel])`. Levels: `normal`, `floating`, `torn-off-menu`, `modal-panel`, `main-menu`, `status`, `pop-up-menu`, `screen-saver`, `dock` (deprecated). `level` defaults to `floating` when the flag is true and resets to `normal` when it is false. From `floating` through `status`, the window sits below the taskbar. `pop-up-menu` and above sit above it. `relativeLevel` is macOS-only. The `alwaysOnTop` constructor option defaults to false.
- Fullscreen: `setFullScreen(flag)`, `isFullScreen()`, and the `fullScreen` property. The `enter-full-screen` and `leave-full-screen` events matter on macOS, where transitions are asynchronous. HTML fullscreen fires `enter-html-full-screen` and `leave-html-full-screen`. The `disableHtmlFullscreenWindowResize` webPreference defaults to false. The constructor `fullscreen` option defaults to false. Since 34.0, the menu bar is hidden in fullscreen on Windows. `setSimpleFullScreen`, `isSimpleFullScreen`, and `simpleFullScreen` are macOS-only.
- Show: the `show` option defaults to true. With `show: false`, `ready-to-show` fires after the first render. It never fires if `paintWhenInitiallyHidden` is false. `show()` focuses the window, and `showInactive()` does not.
- Background: the `backgroundThrottling` webPreference defaults to true. It throttles animations and timers in background pages and changes the Page Visibility state. On Windows, the page reports `hidden` only when the window is minimized or hidden with `hide()`. With throttling off, it stays `visible`. The docs advise pausing expensive work while hidden.
- Session end (Windows): `query-session-end` can delay shutdown when `preventDefault` is called. `session-end` cannot be prevented.
- App commands (Windows, Linux): `win.on('app-command', (event, command))` is emitted for "keyboard media keys or browser commands." Names are lowercased, underscores become hyphens, and the `APPCOMMAND_` prefix is dropped. For example, `APPCOMMAND_BROWSER_BACKWARD` becomes `browser-backward`. Only `browser-backward` and `browser-forward` are documented for Linux.
- Window message hooks (Windows): `hookWindowMessage(message, callback)`, `isWindowMessageHooked`, `unhookWindowMessage`, and `unhookAllWindowMessages`. The docs don't tie them to media keys.
- Other Windows-relevant options:
  - `skipTaskbar` defaults to false. `focusable: false` implies it on Windows.
  - `thickFrame` defaults to true.
  - `backgroundMaterial` accepts `auto`, `none`, `mica`, `acrylic`, or `tabbed`.
  - `transparent` defaults to false and needs a frameless window on Windows.
  - `roundedCorners` defaults to true.
  - `backgroundColor` defaults to `#FFF`.
  - `autoHideMenuBar` defaults to false.

## 7. Title bar and drag regions

- `titleBarStyle` defaults to `'default'`. `'hidden'` removes the title bar. On Windows, window controls appear only together with `titleBarOverlay`. `'hiddenInset'` and `'customButtonsOnHover'` are macOS-only, and the latter is experimental.
- `titleBarOverlay` is `false` by default, or `true` for system colors, or an object with `color`, `symbolColor`, and `height`. `color` and `symbolColor` (Windows and Linux) default to the system color and accept `rgba()`, `hsla()`, and `#RRGGBBAA`. `height` is an integer and defaults to the system height. It requires a `titleBarStyle` other than `'default'`.
- The docs sample is `titleBarStyle: 'hidden'` plus `titleBarOverlay: true` on non-darwin platforms.
- `win.setTitleBarOverlay(options)` (Windows, Linux) exists, but I only saw it in a model summary of the page tail. It is not verified.
- Drag regions use `app-region: drag`. `app-region: no-drag` excludes a rectangle. Draggable areas ignore all pointer events, so buttons inside them get no clicks. If the whole window is draggable, mark buttons `no-drag`. Add `user-select: none` to drag bars. Don't use custom context menus on drag regions, because the system menu appears there. `ELECTRON_DEBUG_DRAGGABLE_REGIONS` is an experimental debugging aid.
- Safe-area CSS variables: `env(titlebar-area-x, 0px)`, `env(titlebar-area-width, 100%)`, and `env(titlebar-area-height, 30px)`.

## 8. Global shortcuts and media keys

- `globalShortcut` is main-only and cannot be used before ready. Methods: `register(accelerator, callback)` returns a boolean. `registerAll(accelerators[], callback)`, `isRegistered(accelerator)`, `unregister(accelerator)`, and `unregisterAll()`. `setSuspended(suspended)` and `isSuspended()` are available since 42.0.0. Suspension stops listening, and new registrations fail while suspended.
- Shortcuts work without app focus.
- Media accelerators: `MediaPlayPause`, `MediaNextTrack`, `MediaPreviousTrack`, `MediaStop`. Volume: `VolumeUp`, `VolumeDown`, `VolumeMute`.
- Accelerator syntax: case-insensitive. `Command` has no effect on Windows or Linux, so use `CommandOrControl`. Other modifiers: `Alt`, `Shift`, `Super`/`Meta`.
- Conflicts: if another app holds the accelerator, `register` fails silently and `isRegistered` returns false. The docs say the OS intends this.
- The only media-key restriction documented is macOS 10.14+, which requires a trusted accessibility client. It does not apply to Windows.
- Windows-specific media-key behavior is not documented.
- In-app alternatives: `Menu` accelerators work only while the app is focused. `webContents`'s `before-input-event` in main fires before the renderer's keydown/keyup.

## 9. app, shell, dialog, session, net

### app (main)

- `requestSingleInstanceLock([additionalData])` returns a boolean. If false, another instance holds the lock, so quit. The primary instance emits `second-instance(event, argv, workingDirectory, additionalData)`. That event is guaranteed to fire after ready. `argv` may be reordered or have arguments appended. It is empty if the second instance runs as a different user. On macOS and Linux, the arguments and `additionalData` travel as one message capped at 32 MB. Oversized messages make the call return false and suppress the event. Windows is not described.
- `hasSingleInstanceLock()` and `releaseSingleInstanceLock()` (releases all locks).
- `render-process-gone(event, webContents, details)` fires when a renderer crashes or is killed.
- `child-process-gone(event, details)` covers non-renderer processes. `details.type` is one of `Utility`, `Zygote`, `Sandbox helper`, `GPU`, `Pepper Plugin`, `Pepper Plugin Broker`, or `Unknown`. `details.reason` is one of `clean-exit`, `abnormal-exit`, `killed`, `crashed`, `oom`, `launch-failed`, `integrity-failure`, or `memory-eviction`. Other fields are `exitCode`, `systemErrorCode` (Windows, launch-failed only), `serviceName`, and `name`.
- `getPath(name)` accepts `home`, `appData`, `assets` (Windows and Linux), `userData`, `sessionData`, `temp`, `exe`, `module`, `desktop`, `documents`, `downloads`, `music`, `pictures`, `videos`, `recent` (Windows only), `logs`, and `crashDumps`. On Windows, the app name must not contain `< > : " \ / | ? *`.
- `setPath(name, path)` accepts only names from `getPath`. It throws if the directory doesn't exist. Override `sessionData` before ready.
- `setAppUserModelId(id)` (Windows) changes the AUMID. The docs give no timing guidance.
- `setToastActivatorCLSID(id)` (Windows) should be called early, before notifications. An empty or invalid value throws.
- Ordering: `isReady()` and `whenReady()` report initialization. `ready` fires after the first event-loop tick, so calls made before it must be synchronous at top level. `enableSandbox()` must run before ready. `getLocale()`, `getSystemLocale()`, and `configureHostResolver()` must run after ready. `disableHardwareAcceleration()` must run before ready. `utilityProcess.fork` and `session.defaultSession` require ready.

### shell (main; non-sandboxed renderer)

- `showItemInFolder(fullPath)` shows the file in a file manager and selects it if possible. No return value is documented.
- `openPath(path)` returns `Promise<string>`, resolving to an error message or `""`.
- `openExternal(url[, options])` returns `Promise<void>`. The URL is capped at 2081 characters on Windows. Options: `activate` (macOS), `workingDirectory` (Windows), and `logUsage` (Windows, default false).
- `trashItem(path)` returns `Promise<void>`. Use `path.resolve` so separators are correct on Windows.
- `readShortcutLink` and `writeShortcutLink(shortcutPath[, operation], options)` are Windows-only.
- `shell` does not function in sandboxed renderers.

### dialog (main only)

- `showOpenDialog([window, ]options)` returns `Promise<{ canceled, filePaths, bookmarks? }>`. Passing a `window` makes the dialog modal.
- Options: `title`, `defaultPath` (defaults to Downloads since 43.0), `buttonLabel`, `filters` (`{ name, extensions }`; extensions without dots; `'*'` for all), and `properties`.
- `properties` values: `openFile`, `openDirectory`, `multiSelections`, `showHiddenFiles` (macOS, Windows), `promptToCreate` (Windows), `dontAddToRecent` (Windows). `createDirectory`, `noResolveAliases`, and `treatPackageAsDirectory` are macOS-only.
- On Windows, `['openFile', 'openDirectory']` shows a directory picker only.
- `showOpenDialogSync` returns `string[] | undefined`. `showSaveDialog` returns `Promise<{ canceled, filePath, bookmark? }>`. `showMessageBox` returns `Promise<{ response, checkboxChecked }>` and accepts `noLink` (Windows).
- `showErrorBox(title, content)` is safe to call before ready.

### session (main)

- `fromPartition(partition[, options])` and `fromPath(path[, options])` (absolute path) return sessions. `defaultSession` is available after `whenReady`. A `persist:` prefix makes the partition persistent.
- `setPermissionRequestHandler(handler)` calls `handler(webContents, permission, callback, details)`. `callback(boolean)` grants or denies. Pass `null` to clear. Permission names include `notifications`, `media`, `display-capture`, `fileSystem`, `fullscreen`, `clipboard-read`, `clipboard-sanitized-write`, `geolocation`, `midi`, `usb`, `hid`, `serial`, `openExternal`, `pointerLock`, `keyboardLock`, `screen-wake-lock`, `system-wake-lock`, `persistent-storage`, and `unknown`. `media` covers camera and microphone. `display-capture` covers screen, window, and tab capture.
- `setPermissionCheckHandler(handler)` returns a boolean and receives `(webContents | null, permission, requestingOrigin, details)`. Details include `requestingUrl`, `isMainFrame`, `mediaType` (`video`, `audio`, or `unknown`), and, for some permissions, `securityOrigin`, `embeddingOrigin`, `filePath`, `isDirectory`, and `fileAccessType`.
- `setDisplayMediaRequestHandler(handler[, opts])` passes a `video` source and an `audio` value. `audio: 'loopback'` (or `'loopbackWithMute'`) captures system audio, which is Windows-only.
- `setDevicePermissionHandler`: if unset, permissions granted through the device picker apply, and are kept in memory by default.
- `setBluetoothPairingHandler` (Windows, Linux): if unset, pairings that need extra validation are cancelled.
- `ses.fetch(input[, init])` makes requests from a specific session.

### net (main, utility)

- `net.fetch` is described above. `net.request(options)` returns a ClientRequest. `net.isOnline()` and `net.online` report connectivity, but `true` is inconclusive. `net.resolveHost`, and `net.WebSocket` (main only), also exist.
- Since 44.0, `net.request` rejects `Sec-Fetch-Dest` values of `document`, `frame`, `iframe`, or `fencedframe` unless `Sec-Fetch-Mode` is `navigate`.

## 10. Fuses, ASAR integrity, native modules, testing

### Fuses (flipped at package time, before code signing)

| Fuse (`FuseV1Options`) | Default | Effect |
|---|---|---|
| RunAsNode | Enabled | Respects `ELECTRON_RUN_AS_NODE`. When disabled, `child_process.fork` throws. |
| EnableCookieEncryption | Disabled | Encrypts the cookie store with OS keys. One-way. |
| EnableNodeOptionsEnvironmentVariable | Enabled | Respects `NODE_OPTIONS` and `NODE_EXTRA_CA_CERTS`. |
| EnableNodeCliInspectArguments | Enabled | Respects `--inspect` and similar flags. |
| EnableEmbeddedAsarIntegrityValidation | Disabled | Validates `app.asar` on load (macOS, Windows). |
| OnlyLoadAppFromAsar | Disabled | Searches only `app.asar`. |
| LoadBrowserProcessSpecificV8Snapshot | Disabled | Uses a separate V8 snapshot for the main process. |
| GrantFileProtocolExtraPrivileges | Enabled | Gives `file://` pages extra privileges. Disable if unused. |
| WasmTrapHandlers | Enabled | Uses signal-based wasm bounds traps (Windows x86_64 supported). |

- Flip with `flipFuses(path or require('electron'), { version: FuseVersion.V1, [FuseV1Options.RunAsNode]: false })` from `@electron/fuses`. Inspect with `npx @electron/fuses read --app <path>`. Electron Forge uses `@electron-forge/plugin-fuses`.

### ASAR integrity

- Supported on macOS from 16.0.0 and on Windows from 30.0.0.
- Enable with the `EnableEmbeddedAsarIntegrityValidation` fuse, normally with `OnlyLoadAppFromAsar`.
- The header hash goes in a Windows resource of type `Integrity` named `ElectronAsar`, containing JSON such as `[{ "file": "resources\\app.asar", "alg": "sha256", "value": "…" }]`. On macOS it goes in an `ElectronAsarIntegrity` dictionary in `Info.plist`.
- Electron Forge (`@electron/forge` 7.4.0 or later) and Electron Packager (`@electron/packager` 18.3.1 or later) set this up automatically when asar is enabled. Other build systems must do it manually. electron-builder is not covered.
- On a hash mismatch or missing hash, the app terminates.

### Native modules

- Electron's ABI differs from Node's. Rebuild with `@electron/rebuild` (`electron-rebuild`), and rebuild after upgrading Electron. Windows node-gyp modules need `'win_delay_load_hook': 'true'` (required since Electron 4.x).
- Prebuilt modules: omit `--build-from-source`. Modules built with node-pre-gyp need a source build, so use `@electron/rebuild` for them.
- Manual env vars: `npm_config_target`, `npm_config_runtime=electron`, `npm_config_disturl=https://electronjs.org/headers`, `npm_config_build_from_source=true`.

### Testing

- Playwright has experimental Electron support: `_electron.launch({ args: ['.'] })`, `electronApp.firstWindow()`, `electronApp.evaluate(async ({ app }) => …)`, `electronApp.close()`.
- WebdriverIO: `npm init wdio@latest ./`, choose "Desktop Testing - of Electron Applications", and use `services: ['electron']` with `browserName: 'electron'`. Set `wdio:electronServiceOptions.appBinaryPath` when the build tool doesn't locate the binary.
- Selenium needs `electron-chromedriver`.

## 11. Breaking changes, 39.0 through 45.0 (filtered to Windows desktop)

**45.0**
- HIGH if preloads use these: sandboxed-preload `require` no longer loads `events`, `timers`, or `url`. `Buffer`, `setImmediate`, and `clearImmediate` are removed. See section 3 for replacements.
- MEDIUM: sandboxed `ipcRenderer`, `webFrame`, and preload `process` use a native EventEmitter. The static helpers are not provided.
- MEDIUM: screen capture is reported as `display-capture`, and `media` now means camera or microphone only. A handler that grants only `media` breaks screen sharing.
- LOW: `getUserMedia` with `chromeMediaSource: 'desktop'` rejects WebContents source IDs. Use `'tab'` with `webContents.getMediaSourceId(...)`.
- MEDIUM: `fs.open` on an asar file returns a descriptor usable only through `fs`. Raw-fd consumers (native addons, `child_process` stdio, `net.Socket({ fd })`) get `EBADF`. Write flags fail with `EACCES`.
- LOW: `window.open` children of unsandboxed windows get their own sandboxed process. The opener gets `null`, and `window.opener` is null. Opt back in with `overrideBrowserWindowOptions.webPreferences.sandbox: false`.
- MEDIUM if `safeStorage` is used: `isEncryptionAvailable`, `encryptString`, and `decryptString` are deprecated and will be removed in 46. Use `isAsyncEncryptionAvailable()`, `encryptStringAsync()`, and `decryptStringAsync()`.
- LOW: subframe workers need `nodeIntegrationInSubFrames` for Node. `document.requestStorageAccessFor` is disabled by default. `contentTracing.enableHeapProfiling()` is removed.

**44.0**
- HIGH if `clipboard` is used: it is no longer exposed to renderers. Use `navigator.clipboard`, or expose helpers through a preload with contextBridge. The main-process API is now Promise-based: `readText()` returns `Promise<string>`, `writeText()` returns `Promise<void>`, `has()` returns `Promise<boolean>`, `read()` returns `Promise<ClipboardItem[]>`, and `write([ClipboardItem])` returns `Promise<void>`. The narrow helpers (`readImage`, `writeHTML`, `readRTF`, and others) are removed.
- HIGH for packaging: Windows ia32 (`win32-ia32`) binaries are no longer published. 44.0.0 and later are 64-bit only.
- MEDIUM if login items are used: `openAsHidden` was removed from `setLoginItemSettings`, and `openAsHidden`, `wasOpenedAsHidden`, and `restoreState` were removed from `getLoginItemSettings`. The breaking-changes page says 44. The app API history says `>=45.0.0`. Verify before relying on either.
- LOW: ANGLE is statically linked, so libEGL and libGLESv2 DLLs are no longer shipped and cannot be swapped.
- LOW: `select-client-certificate` can receive a null `webContents`.
- Unity: `app.isUnityRunning()` is removed on Linux. `setProgressBar` remains on Windows and macOS.

**43.0**
- HIGH: `defaultPath` now defaults to Downloads (or home) for `showOpenDialog`, `showSaveDialog`, and their Sync forms. To keep the last folder, store it yourself and pass it as `defaultPath`.
- LOW: `NativeImage.toBitmap()` (and `getBitmap()`) normalize to sRGB by default. Pass `colorSpace` to keep the original.
- Linux-only, skipped: frameless corner rounding, WCO layout, and removal of `showHiddenFiles` on Linux.

**42.0**
- HIGH for dev and CI: the npm `electron` package no longer downloads in postinstall. The binary is fetched on the first run of the `electron` bin (for example `npx electron .`). `--ignore-scripts` works. The `install-electron` script covers on-demand downloads. `ELECTRON_INSTALL_PLATFORM` and `ELECTRON_INSTALL_ARCH` handle cross-platform installs. `ELECTRON_SKIP_BINARY_DOWNLOAD` is no longer supported.
- LOW: `quotas` was removed from `Session.clearStorageData`. The array-only `hslShift` form of `nativeImage.createFromNamedImage` is deprecated.
- macOS-only, skipped: notifications moved to UNNotification.

**41.0**
- LOW: the cookie `changed` event's `cause` now reports `inserted`, `inserted-no-change-overwrite`, or `inserted-no-value-change-overwrite`. Deletions remain `explicit`.

**40.0**
- Deprecated: `clipboard` in renderers (removed in 44.0).

**39.0**
- LOW: `--host-rules` is deprecated. Use `--host-resolver-rules`.
- LOW: `window.open` popups are always resizable. To restore the old behavior, set `overrideBrowserWindowOptions.resizable` from `details.features.includes('resizable=yes')`.
- macOS-only, skipped: `NSAudioCaptureUsageDescription` and the shared-texture OSR paint event structure.

**38.0 baseline:** the `plugin-crashed` event was removed from webContents, and `webFrame.routingId` and `findFrameByRoutingId` were deprecated in favor of `frameToken` and `findFrameByToken`.

**45.1.0 point release:** `protocol.registerSource` fetch-rule parity was fixed. A `utilityProcess` `exit` event now fires if the app quits during launch. Asar fixes cover malformed size fields and path handling between main and child processes. New feature: `session.registerPreloadScript` accepts `matches`, `excludeMatches`, `includeGlobs`, `excludeGlobs`, and `matchOriginAsFallback`.

## 12. Node.js and node:sqlite

- Electron 45.1.0 embeds Node.js 24.22.1, per the releases page and its "Updated Node.js to v24.22.1" entry.
- `node:sqlite` is not mentioned in the Electron docs read or in the 45.1.0 release notes. Its availability, flags, and stability in this Node version are not settled here. Check the Node.js v24 documentation, which I did not read.
- The project's `better-sqlite3` is a native module, so it needs a rebuild for each Electron upgrade (section 10).

## 13. Settled by running Electron 45.1.0 (Phase 1)

- **Custom scheme origin:** `WebFrameMain.origin` is `app://bundle` for a page on the `standard` scheme `app://bundle/`. But Node's `new URL('app://bundle/x').origin` is the string `"null"`, so build it from `protocol` and `host`.
- **ESM main and `ready`:** top-level code in the ESM entry runs before `ready`, so `registerSchemesAsPrivileged`, `setAppUserModelId`, and `Menu.setApplicationMenu(null)` work there with no `await`.
- **`--user-data-dir`** redirects `app.getPath('userData')`, and so the Chromium profile and anything else kept under it. Run it with `args: ['.', '--user-data-dir=…']`.
- **CSP:** a `<meta>` CSP works on `app://`, and `'self'` matches `app://bundle`.
- **Custom protocols and fetch:** a same-origin page `fetch()` works. A cross-origin one, such as `app://elsewhere/`, rejects with a TypeError because `corsEnabled` is off for `app`. Main's `net.fetch` reaches custom protocols directly.
- **`corsEnabled`:** on `art`, a page on `app://` can `fetch()` it, and an `<img crossOrigin="anonymous">` from it can go through `canvas.toDataURL`, with no `Access-Control-Allow-Origin` header needed. Without it both are refused, and the canvas is tainted. Media Session refuses `art://` URLs outright ("MediaImage src can only be of http/https/data/blob scheme"), so overlay art has to be read back into a data URL.
- **`will-navigate` doesn't fire for a renderer-initiated `about:blank`.** `did-navigate` does, and that frame keeps the app's origin in `WebFrameMain.origin`, so the sender check still passes there. An error page fires `did-fail-load` and not `did-navigate`. DevTools is `getType() === 'remote'`, and a window is `'window'`.
- **Denials:** `setWindowOpenHandler` returning `deny` makes `window.open` return `null`. `setPermissionCheckHandler(() => false)` makes `navigator.permissions.query` report `denied`.
- **Why the interface-size setting doesn't use zoom:** at zoom factor 2 the viewport is half as wide in CSS pixels, so `1vw` paints the same size, and media queries see the smaller window. Measured at 1280×800: zoom 2 moved the layout to its narrow form and collapsed the art. So `--ui-scale` in `globals.css` multiplies the tokens instead, and media queries keep seeing real window pixels.
- **Window Controls Overlay:** `titleBarOverlay: { color: '#00000000', symbolColor, height: 44 }` is accepted. `navigator.windowControlsOverlay.getTitlebarAreaRect()` reports `height: 44`, and a `width` 138 less than the window's, which is the room the three controls take. TypeScript's DOM types don't include this API yet. Page screenshots don't include the native controls, so their look hasn't been checked by test.
- **Electron binary:** since 42 it downloads on first use. `node node_modules/electron/install.js` does it up front, and `electron_config_cache` moves its download cache. Importing `electron` under plain Node returns the binary's path and triggers the download if it's missing.
- **`before-input-event`:** fires for `webContents.sendInputEvent`, but not for Playwright's `page.keyboard`.
- **Crash recovery:** `forcefullyCrashRenderer()` fires `render-process-gone`, and `contents.reload()` then brings the page back.
- **Crash dumps and `CHROME_CRASHPAD_PIPE_NAME`:** a process that inherits this variable attaches to the crash handler it names, so its dumps land in that app's folder. A shell started by Claude Desktop inherits it. With it unset, dumps stay under `--user-data-dir`. Unset it before launching Electron: `scripts/dev-env.sh` does, and so does the e2e spec.
- **`backgroundThrottling: false`:** the page's `document.visibilityState` stays `visible` even when minimized, so main has to tell it. `animation-play-state` then stops CSS loops.
- **Spelling files:** every launch rewrites `%APPDATA%\Microsoft\Spelling\en-US\default.exc` and `default.acl`, 2 bytes each, whatever `--user-data-dir` says. `webPreferences.spellcheck: false`, `setSpellCheckerEnabled(false)` and `--disable-features=WinUseBrowserSpellChecker` don't stop it, alone or together.
- **Playwright:** 1.64.1 drives an ESM main with a sandboxed CommonJS preload.
- **Quitting after async work:** `event.preventDefault()` in `will-quit`, do the work, then `app.quit()` again. But Electron ignores a `quit()` made while it's still emitting `will-quit`, and resets its quitting flag after the listeners return. If the work finishes in microtasks, the second call does nothing, and the app stays running with no windows. Call it from `setImmediate`.
- **`art://` over `protocol.handle`:** response headers set on the `Response` reach a page's `fetch`, and `<img src="art://…">` decodes under a CSP with `img-src art:`. `net.fetch` isn't needed to serve a cached file: `new Response(await readFile(path), { headers })` is enough.
- **`worker_threads` in main:** `?modulePath` workers run `better-sqlite3`, `music-metadata` and `child_process.spawn` with `windowsHide`. `worker.on('error', …)` gives an `any`, so type it `unknown`. A worker with `parentPort.on('message')` stays alive until `parentPort.close()`.

- **Window Controls Overlay and tests:** `page.setViewportSize` emulates the viewport and leaves `env(titlebar-area-*)` and `getTitlebarAreaRect()` following the real window, even after the real window is resized, so anything comparing them with `100vw` comes out wrong. Resize with `win.setContentSize` and no emulation: the values then follow. The controls are about 138 px wide at a 44 px overlay, whatever the display scale.
- **Real window sizes:** `setContentSize` can go past the screen (3840x2160 on a 1440x900 display). At 200% display scaling the content comes out a pixel narrower than asked, so asking for one more lands exactly. At the 480 minimum height it comes out 481.
- **A capture with the native controls:** `desktopCapturer.getSources({ types: ['window'], thumbnailSize })` in main, matching `source.id` to `win.getMediaSourceId()`, gives the whole window with its controls. Page screenshots leave them out.

## 14. Not settled by docs

- Range request handling (`Range` headers and 206 responses) in `protocol.handle`, `registerSource`, and `net.fetch`, which matters for audio seeking. `stream: true` is the only documented media-related setting.
- The behavior of the `secure` privilege. Only its name and default (false) are given.
- Whether a `Content-Security-Policy` header on a `protocol.handle` Response is enforced. The docs show CSP through `webRequest` and `<meta>`.
- Chromium's HardwareMediaKeyHandling feature in Electron on Windows. `api/command-line-switches` was not fetched.
- The Media Session API (`navigator.mediaSession`) on Windows, and whether `globalShortcut`, `app-command`, and mediaSession all receive one media key press.
- The full list of Windows app-command names for media keys. The docs give only the naming rule.
- Windows-specific conflict behavior for media accelerators beyond the general silent-failure rule.
- `node:sqlite` availability in the Electron 45 main process.
- Timing of `setAppUserModelId` relative to window creation or notifications.
- `RenderProcessGoneDetails` fields (structure page not fetched).
- The `ThumbarButton` structure page (not fetched). The field names above come from the BrowserWindow text.
- `setTitleBarOverlay` runtime behavior. It appears only in a model summary.
- Return or failure behavior of `shell.showItemInFolder`.
- The sandbox defaults for utility processes. The docs mention only `--no-sandbox`.
- The `setPermissionCheckHandler` default when no handler is set.
- Whether `backgroundThrottling` affects `HTMLAudioElement` playback. The docs mention only timers and animations.
- ASAR integrity with electron-builder. The docs automate it only for Forge and Packager.
- N-API versus per-version native builds. The native modules page does not cover N-API.
- Which version removed the login-item fields (44 or 45). The two docs pages disagree.
- The `setWindowOpenHandler` `'allow'` response shape beyond the examples. `window-open-handler-response` was not fetched.
