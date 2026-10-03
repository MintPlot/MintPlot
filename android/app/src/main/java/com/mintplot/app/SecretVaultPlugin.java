package com.mintplot.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Secret vault bridge (M4-b2, ADR-005) — shell bridge infrastructure, NOT a
 * product plugin: no manifest, no plugin-registry lifecycle, invisible to the
 * tools page. The kernel secret channel (src/kernel/secrets/) owns all
 * policy; this class only persists channel payloads encrypted at rest —
 * AndroidKeyStore AES-GCM (non-exportable key) under MODE_PRIVATE
 * preferences. Crypto half ported from the RP shell baseline.
 */
@CapacitorPlugin(name = "MpVault")
public class SecretVaultPlugin extends Plugin {

    private static final String SECRET_PREFERENCES = "mp_secret_vault";
    private static final String KEY_ALIAS = "mp-vault-key";

    @PluginMethod
    public void secretSet(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("secret key is required");
            return;
        }
        try {
            getSecretPreferences().edit().putString(key, encrypt(call.getString("value", ""))).apply();
            call.resolve();
        } catch (Exception error) {
            call.reject("secret persist failed", error);
        }
    }

    @PluginMethod
    public void secretGet(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("secret key is required");
            return;
        }
        try {
            String encrypted = getSecretPreferences().getString(key, null);
            JSObject result = new JSObject();
            result.put("value", encrypted == null ? null : decrypt(encrypted));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("secret read failed", error);
        }
    }

    @PluginMethod
    public void secretRemove(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("secret key is required");
            return;
        }
        getSecretPreferences().edit().remove(key).apply();
        call.resolve();
    }

    private SharedPreferences getSecretPreferences() {
        return getContext().getSharedPreferences(SECRET_PREFERENCES, Context.MODE_PRIVATE);
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        KeyStore.Entry existing = keyStore.getEntry(KEY_ALIAS, null);
        if (existing instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry) existing).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }

    private String encrypt(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(encrypted, Base64.NO_WRAP);
    }

    private String decrypt(String value) throws Exception {
        String[] parts = value.split(":", 2);
        if (parts.length != 2) throw new IllegalArgumentException("Invalid encrypted secret");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
}
