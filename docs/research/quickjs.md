# QuickJS in WebAssembly, for scripts people paste in

What runs a pasted service adapter (Settings v2), read from the installed packages on 2026-11-07.

**Packages.** `quickjs-emscripten-core` 0.32.0 and one variant, `@jitl/quickjs-wasmfile-release-sync` 0.32.0, both MIT. The
umbrella `quickjs-emscripten` package pulls in four variants (debug and asyncify ones too); only release-sync is needed. The
variant vendors bellard/quickjs 2025-09-13. Together about 1.4 MB unpacked.

**Loading.** `newQuickJSWASMModuleFromVariant(variant)` is async, and the variant's default export is the variant. Under Node
CommonJS the variant reads `emscripten-module.wasm` with `fs.readFileSync(__dirname + '/emscripten-module.wasm')`, so it works
from inside `app.asar` (Electron's fs reads asar paths) without unpacking. One module per process, memoized.

**What a script can reach.** The WebAssembly build is the language and its standard objects only: no `std`/`os` modules unless
the host adds them, no network, no files, no timers. Everything in or out goes through what the host passes and reads back.

**Limits** (from the type definitions' docs, `QuickJSRuntime`):
- `setMemoryLimit(bytes)`: allocation past it throws inside the script.
- `setMaxStackSize(bytes)`: deep recursion throws instead of crashing.
- `setInterruptHandler(shouldInterruptAfterDeadline(deadline))`: called regularly while it runs, and stops it at the deadline,
  which shows up as an `InternalError: interrupted` thrown in the script.
- A runtime per untrusted source; "stronger isolation" would be a separate module, not needed for one person's own script.

**Use here.** A fresh runtime and context for each call, so nothing carries from one track to the next. Values go in as JSON
inside the evaluated code and come out as a JSON string, read with `getString` and parsed, then checked with zod like any other
outside data. Handles are disposed, the context before the runtime.
