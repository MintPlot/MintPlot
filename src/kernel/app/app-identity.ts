/**
 * App identity (pinned at M0-b) — applicationId is immutable; this module is
 * the web-side mirror. versionName must stay in sync with
 * android/app/build.gradle. versionCode derives from versionName as
 * major*1000000 + minor*1000 + patch (1.0.0 -> 1000000), monotonic axis.
 */

export const MP_APPLICATION_ID = 'com.mintplot.app'
export const MP_VERSION_NAME = '1.0.0'

/** Build flavor surfaces in diagnostics; the version axis moves only on releases. */
export function mpBuildType(): 'dev' | 'release' {
  return import.meta.env.DEV ? 'dev' : 'release'
}
