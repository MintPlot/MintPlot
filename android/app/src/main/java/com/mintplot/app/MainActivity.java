package com.mintplot.app;

import android.os.Bundle;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
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
    }
}
