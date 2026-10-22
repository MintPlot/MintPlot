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
  // 软键盘避让(2026-10-17 真机反馈:输入法盖住输入坞):原生 ime-inset
  // 驱动 WebView resize,不受 edge-to-edge 下 adjustResize 失效影响。
  // resize 是 iOS 专属键;Android 端插件只读 resizeOnFullScreen(默认
  // false,不配则键盘避让完全不生效)——两个键各管一端,都要配。
  plugins: {
    Keyboard: {
      resize: 'native',
      resizeOnFullScreen: true,
    },
  },
}

export default config
