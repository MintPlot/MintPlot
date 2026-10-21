package com.mintplot.app;

import android.os.Bundle;
import android.view.Window;

import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The manifest launches this activity on AppTheme.NoActionBarLaunch
        // (Theme.SplashScreen). Without installSplashScreen() the window runs
        // on that splash base forever — and its AppCompat base arms a platform
        // title that HarmonyOS's compat decor path renders as a "MintPlot"
        // action bar. The call swaps in postSplashScreenTheme (NoActionBar).
        SplashScreen.installSplashScreen(this);
        // HarmonyOS/OriginOS-class skins paint their own window decor (app
        // title + progress strip) when they classify the app as
        // non-fullscreen — and that decor reads the APPLICATION-level theme.
        // Belt and braces: forbid the title feature before the decor exists
        // and hide any ActionBar the compat layer still materializes.
        supportRequestWindowFeature(Window.FEATURE_NO_TITLE);
        // Theme v3: content-under-glass includes the status bar — the decor
        // must not consume top insets, or OriginOS-class skins clip the
        // WebView below a white system strip. The web layer handles the
        // safe-area padding itself (env(safe-area-inset-top)).
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        // Shell bridge infra (ADR-005 / M4-g1 / M4-g2): the secret vault
        // persists kernel channel payloads encrypted at rest; the file bridge
        // gives the kernel dataio layer chunked SAF export/import; the backup
        // bridge gives the import pipeline read-only zip/SQLite inspection.
        // All registered before super.onCreate() so the bridges are available
        // to the first web load.
        registerPlugin(SecretVaultPlugin.class);
        registerPlugin(MpFilesPlugin.class);
        registerPlugin(MpBackupPlugin.class);
        super.onCreate(savedInstanceState);
        if (getSupportActionBar() != null) {
            getSupportActionBar().hide();
        }
    }
}
