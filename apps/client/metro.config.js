// Metro config for the Modern Mahjong Expo client. NativeWind setup is
// deferred — Phase 1 used `withNativeWind` + `babel-preset-expo` with
// `jsxImportSource: 'nativewind'`, but NativeWind 5.0.0-preview.2 doesn't
// ship a `nativewind/jsx-runtime` (or `jsx-dev-runtime`) entry point, so
// the bundler errors on every import that flows through that JSX
// transform. Until the v5 NativeWind story stabilises (or we drop to v4
// stable), we ship plain Metro + inline-style components and revisit
// Tailwind in a later commit.
//
// The Expo workspace lives at the monorepo root, so we widen the watch
// folders to include the workspace packages and the pnpm symlinked
// node_modules — required for cross-package imports to resolve.
//
// `resolveRequest` strips `.js` suffixes from relative imports under
// the workspace's TS-source-only packages (`@mahjong/game-logic`,
// `@mahjong/protocol`, `@mahjong/bots`, `@mahjong/server`). Those
// packages use `./foo.js` in their internal imports because Node's
// strict ESM resolver requires the suffix at runtime, but Metro
// resolves source-relative — without this stripping, every internal
// engine import fails with `Unable to resolve "./tiles.js"`.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = false;
// xstate v5 ships its public API via `package.json#exports` with two
// shims: a `.cjs.mjs` ESM bridge that re-exports from a `.cjs.js` CJS
// bundle. With Metro's default condition order ("import" → the bridge),
// the resulting CJS↔ESM interop creates an infinite getter chain at
// runtime (`RangeError: Maximum call stack size exceeded` at
// `Object.get [as createMachine]`).
//
// Enabling Package Exports + restricting conditions to `module` (xstate
// maps that key to the pure ESM bundle `dist/xstate.esm.js`) bypasses
// the bridge so Metro reads the ESM directly.
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['module', 'browser', 'require'];

const defaultResolver = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Strip `.js` from any relative import. The workspace TS packages
  // (`@mahjong/game-logic` etc.) author imports with the `.js`
  // suffix Node's ESM resolver requires at runtime, but Metro is
  // resolving against the .ts sources directly. No-op for non-relative
  // imports so node_modules resolution stays unchanged.
  if ((moduleName.startsWith('./') || moduleName.startsWith('../')) && moduleName.endsWith('.js')) {
    const stripped = moduleName.slice(0, -'.js'.length);
    return context.resolveRequest(context, stripped, platform);
  }
  if (defaultResolver) {
    return defaultResolver(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
