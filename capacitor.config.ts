import type { CapacitorConfig } from '@capacitor/cli'

/**
 * M0-b · 白纸原则(M0 清单 §02):从零写起,不携带任何 RP 专属项。
 * applicationId / versionCode / 签名三参数见 android/app/build.gradle。
 */
const config: CapacitorConfig = {
  appId: 'com.mintplot.app',
  appName: 'MintPlot',
  webDir: 'dist',
  // Android 15+ 强制 edge-to-edge:由 Capacitor 对 WebView 避让系统栏(仅目标 SDK 35+ 生效)
  android: {
    adjustMarginsForEdgeToEdge: 'auto',
  },
}

export default config
