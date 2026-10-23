import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Native shell identity and signing are configured in android/app/build.gradle.
 */
const config: CapacitorConfig = {
  appId: 'com.mintplot.app',
  appName: 'MintPlot',
  webDir: 'dist',
  // Let Capacitor apply system-bar margins on Android 15+ edge-to-edge windows.
  android: {
    adjustMarginsForEdgeToEdge: 'auto',
  },
  // Android edge-to-edge windows need the plugin's fullscreen workaround.
  // The `resize` option only controls iOS and leaves the Android dock covered.
  plugins: {
    Keyboard: {
      resizeOnFullScreen: true,
    },
  },
}

export default config
