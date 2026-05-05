// react-native-reanimated is pulled in as an optional peer of expo-router
// (and historically by moti). The runtime no longer uses it — animations
// were rewritten in #83 with RN-core `Animated` + `PanResponder`. The
// reanimated 4.x Android Gradle script shells out to `node` to resolve
// its own metadata and fails inside the pnpm monorepo, breaking
// `eas build --platform android --local`. Excluding it from RN
// autolinking keeps the local Android build green without forcing us
// to set `auto-install-peers=false` (which would change every install
// across the workspace).
module.exports = {
  dependencies: {
    'react-native-reanimated': {
      platforms: { android: null, ios: null },
    },
    'react-native-gesture-handler': {
      platforms: { android: null, ios: null },
    },
  },
};
