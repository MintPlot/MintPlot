/**
 * App identity (M0-b, immutable) — the three parameters are pinned; this
 * module is the web-side mirror. versionName must stay in sync with
 * android/app/build.gradle (single M0-b decision, monotonic versionCode).
 */

export const MP_APPLICATION_ID = 'com.mintplot.app'
export const MP_VERSION_NAME = '1.0.0-alpha'

/** Dev builds occupy a versionCode too (M0-b); the type surfaces in diagnostics. */
export function mpBuildType(): 'dev' | 'release' {
  return import.meta.env.DEV ? 'dev' : 'release'
}
