// Metro config for the Modern Mahjong Expo client. NativeWind v5 hook
// applied so Tailwind classes work across iOS / Android / Web. Inline
// CSS-variable expansion is disabled because it conflicts with
// PlatformColor in CSS variables; class-name polyfill is disabled because
// we attach `className` props directly on RN primitives via NativeWind's
// JSX transform.
//
// The Expo workspace lives at the monorepo root, so we widen the watch
// folders to include the workspace packages and the pnpm symlinked
// node_modules, matching the recommended monorepo Metro setup.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = false;

module.exports = withNativeWind(config, {
  input: './global.css',
  inlineVariables: false,
  globalClassNamePolyfill: false,
});
