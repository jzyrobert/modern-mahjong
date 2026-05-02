import type { CapacitorConfig } from '@capacitor/cli';
import { SURFACE_BG } from './src/native/theme.js';

/**
 * Capacitor configuration for the Modern Mahjong shells. The native iOS
 * and Android projects are not committed yet; running `npx cap add ios`
 * and `npx cap add android` (which requires Xcode / Android Studio) will
 * generate them under `ios/` and `android/`. Web bundle output goes to
 * `dist/` (Vite's default) and Capacitor syncs it into the native shells
 * on build.
 */
const config: CapacitorConfig = {
  appId: 'com.modernmahjong.app',
  appName: 'Modern Mahjong',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // Required for LAN host URLs (http://192.168.x.x); production online play uses https.
    cleartext: true,
  },
  plugins: {
    SplashScreen: {
      backgroundColor: SURFACE_BG,
      showSpinner: false,
      launchAutoHide: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: SURFACE_BG,
      overlaysWebView: false,
    },
  },
  ios: {
    contentInset: 'always',
  },
  android: {
    backgroundColor: SURFACE_BG,
  },
};

export default config;
