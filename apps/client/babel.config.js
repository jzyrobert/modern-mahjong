module.exports = (api) => {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // `react-native-worklets/plugin` (peer of reanimated) lived here
    // when reanimated was bundled. Both reanimated + gesture-handler
    // were stripped from the runtime in 532f87f and dropped from
    // `package.json` deps too — animations / gestures are now
    // RN-core `Animated` + `PanResponder`. The babel plugin would
    // fail to resolve at build time without the worklets package, so
    // it's gone too. If reanimated comes back (via a future dev
    // client build), re-install it and re-add this plugin.
  };
};
