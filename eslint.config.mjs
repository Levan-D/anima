import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const ANY_MODULE = { module: { origin: ['external', 'core'] } };
const CHANNELS = { file: { categories: 'channels' } };
const CONTRACT = { file: { categories: 'contract' } };
const ENTRY = { file: { categories: 'entry' } };

const element = (...types) => ({ element: { types: { anyOf: types } } });
const external = (...source) => ({ module: { origin: 'external', source } });

// The aliases are listed too: an alias that only the other side's tsconfig defines counts as an external module here.
const NODE_ONLY = [
  { module: { origin: 'core' } },
  external(
    '@main/**',
    'electron',
    'electron/*',
    'electron-log',
    'electron-log/*',
    'better-sqlite3',
    'music-metadata',
    'ffmpeg-static',
  ),
];
const REACT_ONLY = external(
  '@/**',
  'react',
  'react/*',
  'react-dom',
  'react-dom/*',
  'radix-ui',
  'radix-ui/*',
  'motion',
  'motion/*',
  'lucide-react',
  '@tanstack/react-*',
);

const RENDERER = [ENTRY, element('app', 'feature', 'music', 'ui', 'hooks', 'lib')];

// The last matching policy wins, so the general allowances come first.
const DEPENDENCY_POLICIES = [
  { allow: { to: ANY_MODULE } },

  { from: element('main'), allow: { to: element('main', 'shared') } },
  { from: element('shared'), allow: { to: element('shared') } },

  { from: ENTRY, allow: { to: element('app', 'lib', 'styles', 'shared') } },
  { from: element('app'), allow: { to: element('app', 'feature', 'music', 'ui', 'hooks', 'lib', 'styles', 'shared') } },
  { from: element('feature'), allow: { to: element('music', 'ui', 'hooks', 'lib', 'shared') } },
  { from: element('music'), allow: { to: element('music', 'ui', 'hooks', 'lib', 'shared') } },
  { from: element('ui'), allow: { to: element('ui', 'hooks', 'lib', 'shared') } },
  { from: element('hooks'), allow: { to: element('hooks', 'lib', 'shared') } },
  { from: element('lib'), allow: { to: element('lib', 'shared') } },

  { from: element('main'), disallow: { to: REACT_ONLY } },
  { from: RENDERER, disallow: { to: NODE_ONLY } },
  {
    from: RENDERER,
    disallow: { to: CONTRACT, dependency: { kind: 'value' } },
    message: 'Type imports only, so zod stays out of the renderer bundle.',
  },
  {
    from: RENDERER,
    disallow: { to: external('zod', 'zod/*') },
    message: 'Validation happens in main, at the edge.',
  },

  // Shared is denied by default: both sides import it, so a new package has to be let in on purpose.
  { from: element('shared'), disallow: { to: ANY_MODULE } },
  { from: element('shared'), allow: { to: external('zod', 'vitest') } },
  { from: CHANNELS, disallow: { to: ANY_MODULE } },

  // The preload runs in the sandbox: channel names at runtime, types from the rest of shared, and electron.
  { from: element('preload'), allow: { to: CHANNELS } },
  { from: element('preload'), allow: { to: element('shared'), dependency: { kind: 'type' } } },
  { from: element('preload'), disallow: { to: ANY_MODULE } },
  { from: element('preload'), allow: { to: external('electron') } },
];

// Flat config replaces a rule's options rather than merging them, so each level repeats the one above.
const TS_SYNTAX = [
  { selector: 'TSEnumDeclaration', message: 'No enums: use a string union, or an as const array.' },
  { selector: 'TSTypeAliasDeclaration[id.name=/Type$/]', message: 'No Type suffix: types read as nouns.' },
];

const SOURCE_SYNTAX = [
  ...TS_SYNTAX,
  { selector: 'ExportDefaultDeclaration', message: 'Named exports only.' },
  { selector: "ExportSpecifier[exported.name='default']", message: 'Named exports only.' },
];

const stringMatching = (pattern) => `:matches(Literal[value=${pattern}], TemplateElement[value.raw=${pattern}])`;

// Only where class names live. Anywhere else a string is copy or an ARIA value, and it may well say "grid".
const CLASS_CONTEXT =
  ":matches(JSXAttribute[name.name='className'], CallExpression[callee.name='cn'], VariableDeclarator[id.name=/Classes$/])";
const classString = (pattern) => `${CLASS_CONTEXT} ${stringMatching(pattern)}`;

const CLASS_SYNTAX = [
  {
    selector: classString(String.raw`/(^|[\s:])(inline-)?grid($|[\s-])/`),
    message: 'No grid: flex only. See the styles skill.',
  },
  {
    selector: classString(String.raw`/(^|[\s:])[a-z-]*((neutral|red)-\d|-black($|[^\w-]))/`),
    message: 'Primitives are not for components: use a semantic token such as bg-surface.',
  },
  {
    selector: classString(String.raw`/-\[[^\]]*(#[0-9a-fA-F]{3,8}|\d(px|rem))/`),
    message: 'Tokens only: no raw hex or px. See the styles skill.',
  },
  {
    selector: classString(String.raw`/(^|[\s:])duration-(\d|\[)/`),
    message: 'Durations are tokens: duration-(--dur-fast) and its siblings.',
  },
];

const EFFECT_HOOKS = ['useEffect', 'useLayoutEffect', 'useInsertionEffect'];

const COMPONENT_SYNTAX = [
  ...EFFECT_HOOKS.flatMap((hook) => [
    {
      selector: `CallExpression[callee.name='${hook}']`,
      message: `${hook} belongs in a named custom hook in a .ts file.`,
    },
    {
      selector: `CallExpression[callee.property.name='${hook}']`,
      message: `${hook} belongs in a named custom hook in a .ts file.`,
    },
  ]),
  {
    selector: `JSXOpeningElement[name.name='Text'] > JSXAttribute[name.name='className'] ${stringMatching(String.raw`/(^|\s)(text|font)-/`)}`,
    message: 'className on Text is layout only. Writing text- or font- means a variant is missing.',
  },
  {
    selector: `JSXAttribute[name.name='className'] ${stringMatching(String.raw`/(^|[\s:])text-(meta|body|lead|title|heading|display|cover)\b/`)}`,
    message: 'Text styling goes through <Text>, or a variant of the component.',
  },
  {
    selector: "JSXAttribute[name.name='style'] :matches(Literal, TemplateElement):not(Property > Literal.key)",
    message: 'Tokens only: no values in an inline style. A custom property fed from a variable is fine.',
  },
  {
    selector: "JSXOpeningElement JSXAttribute[name.name='size'] > JSXExpressionContainer > Literal",
    message: 'Tokens only: size an icon with a class such as size-5.',
  },
];

const BARE_BUTTON = {
  selector: "JSXOpeningElement[name.name='button']",
  message: 'Every button goes through <Button>.',
};

// On plain elements only: an icon has no <Text> to go through, and takes its color from a class.
const BARE_TEXT_STYLE = {
  selector: `JSXOpeningElement[name.name=/^[a-z]/] > JSXAttribute[name.name='className'] ${stringMatching(String.raw`/(^|[\s:])(text-(text|danger|accent|on-accent)|font-(normal|medium|semibold|bold))\b/`)}`,
  message: 'Text styling goes through <Text>, or a variant of the component.',
};

const EFFECT_IMPORTS = {
  name: 'react',
  importNames: EFFECT_HOOKS,
  message: 'Effects belong in a named custom hook in a .ts file.',
};

// boundaries exempts imports inside one element, so it can't keep lib/format.ts away from lib/testing.ts.
const TEST_ONLY_IMPORTS = {
  paths: [{ name: 'vitest', message: 'Test code stays in tests.' }],
  patterns: [
    {
      group: ['vitest/*', '@testing-library/*', '**/testFixtures', '**/testAudio', '**/lib/testing'],
      message: 'Test code stays in tests.',
    },
  ],
};

const TEST_FILES = [
  '**/*.test.{ts,tsx}',
  'src/renderer/testSetup.ts',
  'src/renderer/lib/testing.ts',
  'src/main/library/testFixtures.ts',
  'src/main/playback/testFixtures.ts',
  'src/main/playback/testAudio.ts',
];

export default defineConfig([
  globalIgnores(['.claude/', '.dev/', 'dist/', 'out/', 'release/', 'resources/', 'spike/']),

  {
    files: ['**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { Buffer: 'readonly', console: 'readonly', fetch: 'readonly', process: 'readonly' },
    },
  },

  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      // `import { type X }` still loads the module under verbatimModuleSyntax, zod included.
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-nested-ternary': 'error',
      'no-restricted-syntax': ['error', ...TS_SYNTAX],
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    linterOptions: { noInlineConfig: true },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          // Name both projects. Given the solution tsconfig, the resolver misses aliases only
          // one project defines, and boundaries then waves those imports through as external.
          project: ['./tsconfig.web.json', './tsconfig.node.json'],
          noWarnOnMultipleProjects: true,
        },
      },
      'boundaries/root-path': import.meta.dirname,
      'boundaries/legacy-templates': false,
      'boundaries/files': [
        { category: 'channels', pattern: 'src/shared/ipc/channels.ts' },
        { category: 'contract', pattern: 'src/shared/ipc/contract.ts' },
        { category: 'entry', pattern: 'src/renderer/{main.tsx,testSetup.ts,env.d.ts}' },
      ],
      'boundaries/elements': [
        { type: 'shared', pattern: 'src/shared', partialMatch: false },
        { type: 'main', pattern: 'src/main', partialMatch: false },
        { type: 'preload', pattern: 'src/preload', partialMatch: false },
        { type: 'app', pattern: 'src/renderer/app', partialMatch: false },
        { type: 'feature', pattern: 'src/renderer/features/*', capture: ['name'], partialMatch: false },
        { type: 'music', pattern: 'src/renderer/components/music', partialMatch: false },
        { type: 'ui', pattern: 'src/renderer/components/ui', partialMatch: false },
        { type: 'hooks', pattern: 'src/renderer/hooks', partialMatch: false },
        { type: 'lib', pattern: 'src/renderer/lib', partialMatch: false },
        { type: 'styles', pattern: 'src/renderer/styles', partialMatch: false },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        { default: 'disallow', checkAllOrigins: true, policies: DEPENDENCY_POLICIES },
      ],
      'boundaries/no-unknown-dependencies': 'error',
      'boundaries/no-unknown-files': 'error',
      'no-restricted-syntax': ['error', ...SOURCE_SYNTAX],
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: TEST_FILES,
    rules: {
      'no-restricted-imports': ['error', TEST_ONLY_IMPORTS],
    },
  },

  // tsc still compiles these, and without a block of their own they'd skip every rule above.
  {
    files: ['src/**/*.{js,jsx,mjs,cjs,mts,cts}'],
    linterOptions: { noInlineConfig: true },
    rules: {
      'no-restricted-syntax': ['error', { selector: 'Program', message: 'Source files are .ts or .tsx.' }],
    },
  },

  // boundaries exempts imports inside one element, so it can't keep shared's other files out of this one.
  {
    files: ['src/shared/ipc/channels.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...SOURCE_SYNTAX,
        {
          selector:
            "ImportDeclaration[importKind!='type'], ImportExpression, ExportNamedDeclaration[source], ExportAllDeclaration",
          message: 'channels.ts has no runtime imports: the sandboxed preload bundles it.',
        },
      ],
    },
  },

  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    rules: {
      'no-restricted-syntax': ['error', ...SOURCE_SYNTAX, ...CLASS_SYNTAX],
    },
  },

  {
    files: ['src/renderer/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [EFFECT_IMPORTS, ...TEST_ONLY_IMPORTS.paths], patterns: TEST_ONLY_IMPORTS.patterns },
      ],
      'no-restricted-syntax': [
        'error',
        ...SOURCE_SYNTAX,
        ...CLASS_SYNTAX,
        ...COMPONENT_SYNTAX,
        BARE_BUTTON,
        BARE_TEXT_STYLE,
      ],
    },
  },

  {
    files: ['src/renderer/**/*.test.tsx'],
    rules: {
      'no-restricted-imports': ['error', { paths: [EFFECT_IMPORTS] }],
    },
  },

  // Where text styling lives, for what can't be a <Text>: inputs, tooltips and the like.
  {
    files: ['src/renderer/components/ui/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...SOURCE_SYNTAX, ...CLASS_SYNTAX, ...COMPONENT_SYNTAX, BARE_BUTTON],
    },
  },

  // A warning for React Compiler, which isn't in this build: nothing here memoizes what useVirtualizer returns.
  {
    files: ['src/renderer/components/ui/VirtualList.tsx'],
    rules: {
      'react-hooks/incompatible-library': 'off',
    },
  },

  // The one place that renders a button.
  {
    files: ['src/renderer/components/ui/Button.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...SOURCE_SYNTAX, ...CLASS_SYNTAX, ...COMPONENT_SYNTAX],
    },
  },

  {
    files: ['**/*.test.{ts,tsx}', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // Window can only be extended through declaration merging.
  {
    files: ['src/renderer/env.d.ts'],
    rules: {
      '@typescript-eslint/consistent-type-definitions': 'off',
    },
  },
]);
