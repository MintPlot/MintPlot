package com.mintplot.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Shell bridge infra (ADR-005 / M4-g1): the secret vault persists
        // kernel channel payloads encrypted at rest; the file bridge gives the
        // kernel dataio layer chunked SAF export/import. Both are registered
        // before super.onCreate() so the bridges are available to the first
        // web load.
        registerPlugin(SecretVaultPlugin.class);
        registerPlugin(MpFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
