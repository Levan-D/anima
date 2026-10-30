---
name: typescript
description: Use when writing or reviewing ANY TypeScript in this repo. Type declarations, naming, narrowing, null handling, Result usage and strictness rules.
---

# TypeScript conventions

`strict: true` and `noUncheckedIndexedAccess: true`. TypeScript is pinned `~6.0` because `typescript-eslint` caps at `<6.1`. Don't bump it blindly.

## type vs interface

Always `type`. No `interface` unless something genuinely needs declaration merging (for example a `Window` global).

## Naming

- No `Type` suffix. Types read as nouns: `Track`, `PlayerStatus`.
- Props: `Props` when unexported, `<Component>Props` when exported.
- `import type` for type-only imports.

## Enums

Never `enum`. String literal unions. If values must be iterated at runtime, derive from an `as const` array so data and type stay in one place:

```ts
export const OUTPUT_MODES = ['shared', 'exclusive'] as const;
export type OutputMode = (typeof OUTPUT_MODES)[number];
```

## Exhaustiveness

Lookups from a union are `Record<Union, Value>`, so adding a member is a compile error until every map is updated. Prefer that to a `switch`. When a `switch` is clearer, end with `assertNever`.

## null, undefined, arrays

- **Domain types use `null` for "no value", never `undefined`.** Optional fields don't exist in shapes that cross IPC.
- `array[0]` is `T | undefined`. Handle it. Don't silence it with `!`. Non-null assertions are banned outside tests.
- Empty arrays are normal. Write code where the empty case just works.
- Convert at the edge: outside data (`undefined`, missing keys, weird tags) becomes clean domain types once, then the rest of the code trusts them.

## Results

Expected failures return values. Exceptions mean a bug.

```ts
import { ok, err, type Result } from '@shared/result';

function parseCue(text: string): Result<CueSheet> {
  if (!text.includes('TRACK')) return err('cue_invalid', 'This CUE file has no tracks');
  return ok(sheet);
}
```

- Every IPC command returns `Result`. The message is written for me to read, not a stack trace.
- Check `.ok` before reading `.value`. TypeScript enforces it.
- Catch at the top of a process and at edges that call throwing libraries. Don't wrap every function.
- `catch (error)` is `unknown`. Narrow it.

## Outside data

zod at the edge only: IPC inputs in main, settings files, LRCLIB responses, mpv messages. Import as `import * as z from 'zod'`. Derive types with `z.infer` rather than writing a second shape. Use `safeParse` and turn failures into a `Result`. Zod is not for data that's already been validated.

## Strictness

- No `any`. At untyped boundaries use `unknown` plus a guard, or a narrow cast with a comment. In tests, Vitest matchers like `expect.any` and `expect.stringContaining` are typed `any`, so they take `as T`. Playwright's don't.
- Derive instead of duplicating: `ReturnType`, `Parameters`, `(typeof X)[number]`, `Pick`/`Omit`.
- No `@ts-ignore`. If truly unavoidable, `@ts-expect-error` with a reason.
- Let return types infer for simple helpers. Annotate exported functions where the type isn't obvious.
- `no-floating-promises` is on. Every promise is awaited, returned, or explicitly `void`ed with a reason to not care.

## Async

Prefer synchronous, deterministic code. `better-sqlite3` is synchronous, so database code isn't async. Pure logic isn't async. Async stays at the edges: IPC, the mpv connection, files, network, workers. Don't make a function `async` because its caller is.
