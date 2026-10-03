package com.mintplot.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Shell bridge infra (ADR-005): the secret vault persists kernel
        // channel payloads encrypted at rest. Registered before super.onCreate()
        // so the bridge is available to the first web load.
        registerPlugin(SecretVaultPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
