package com.mintplot.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * SAF file bridge (M4-g1) — shell bridge infrastructure, NOT a product plugin:
 * no manifest, no plugin-registry lifecycle, invisible to the tools page.
 * Chunked export/import over SAF (CREATE_DOCUMENT / OPEN_DOCUMENT) so the
 * WebView side never touches file paths; byte chunks ride base64 across the
 * bridge (RP shell exportFile discipline internalized). The kernel dataio
 * layer (src/kernel/dataio/) owns all envelope/policy decisions.
 */
@CapacitorPlugin(name = "MpFiles")
public class MpFilesPlugin extends Plugin {

    private static final int READ_CHUNK_BYTES = 256 * 1024;

    private final Map<String, PendingExport> pendingExports = new HashMap<>();
    private final Map<String, PendingImport> pendingImports = new HashMap<>();

    private static class PendingExport {
        final OutputStream output;
        final Uri uri;
        PendingExport(OutputStream output, Uri uri) {
            this.output = output;
            this.uri = uri;
        }
    }

    private static class PendingImport {
        final InputStream input;
        final long size;
        PendingImport(InputStream input, long size) {
            this.input = input;
            this.size = size;
        }
    }

    @PluginMethod
    public void exportStart(PluginCall call) {
        String fileName = call.getString("fileName", "");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        if (fileName == null || fileName.isEmpty()) {
            call.reject("fileName is required");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        startActivityForResult(call, intent, "exportStartResult");
    }

    @ActivityCallback
    private void exportStartResult(PluginCall call, ActivityResult activityResult) {
        if (call == null) return;
        JSObject result = new JSObject();
        if (activityResult.getResultCode() != Activity.RESULT_OK
                || activityResult.getData() == null
                || activityResult.getData().getData() == null) {
            result.put("ready", false);
            call.resolve(result);
            return;
        }
        Uri uri = activityResult.getData().getData();
        try {
            OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt");
            if (output == null) throw new IllegalStateException("Unable to open export destination");
            String sessionId = UUID.randomUUID().toString();
            pendingExports.put(sessionId, new PendingExport(new BufferedOutputStream(output), uri));
            result.put("ready", true);
            result.put("sessionId", sessionId);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to open export destination", error);
        }
    }

    @PluginMethod
    public void exportWrite(PluginCall call) {
        String sessionId = call.getString("sessionId");
        PendingExport pending = sessionId == null ? null : pendingExports.get(sessionId);
        if (pending == null) {
            call.reject("No active export session");
            return;
        }
        String chunk = call.getString("chunk");
        if (chunk == null) {
            call.reject("chunk is required");
            return;
        }
        try {
            pending.output.write(Base64.decode(chunk, Base64.NO_WRAP));
            call.resolve();
        } catch (Exception error) {
            abortExport(sessionId);
            call.reject("Unable to write export chunk", error);
        }
    }

    @PluginMethod
    public void exportEnd(PluginCall call) {
        String sessionId = call.getString("sessionId");
        PendingExport pending = sessionId == null ? null : pendingExports.remove(sessionId);
        if (pending == null) {
            call.reject("No active export session");
            return;
        }
        try {
            pending.output.flush();
            pending.output.close();
            JSObject result = new JSObject();
            result.put("saved", true);
            result.put("uri", pending.uri.toString());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to finish export", error);
        }
    }

    private void abortExport(String sessionId) {
        PendingExport pending = sessionId == null ? null : pendingExports.remove(sessionId);
        if (pending == null) return;
        try {
            pending.output.flush();
            pending.output.close();
        } catch (Exception ignored) {
        }
    }

    @PluginMethod
    public void importOpen(PluginCall call) {
        String mimeType = call.getString("mimeType", "*/*");
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType == null || mimeType.isEmpty() ? "*/*" : mimeType);
        startActivityForResult(call, intent, "importOpenResult");
    }

    @ActivityCallback
    private void importOpenResult(PluginCall call, ActivityResult activityResult) {
        if (call == null) return;
        JSObject result = new JSObject();
        if (activityResult.getResultCode() != Activity.RESULT_OK
                || activityResult.getData() == null
                || activityResult.getData().getData() == null) {
            result.put("ready", false);
            call.resolve(result);
            return;
        }
        Uri uri = activityResult.getData().getData();
        try {
            InputStream raw = getContext().getContentResolver().openInputStream(uri);
            if (raw == null) throw new IllegalStateException("Unable to open import source");
            long size = raw.available();
            String sessionId = UUID.randomUUID().toString();
            pendingImports.put(sessionId, new PendingImport(new BufferedInputStream(raw), size));
            result.put("ready", true);
            result.put("sessionId", sessionId);
            result.put("size", size);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to open import source", error);
        }
    }

    @PluginMethod
    public void importRead(PluginCall call) {
        String sessionId = call.getString("sessionId");
        PendingImport pending = sessionId == null ? null : pendingImports.get(sessionId);
        if (pending == null) {
            call.reject("No active import session");
            return;
        }
        try {
            byte[] buffer = new byte[READ_CHUNK_BYTES];
            int read = pending.input.read(buffer);
            JSObject result = new JSObject();
            if (read <= 0) {
                pending.input.close();
                pendingImports.remove(sessionId);
                result.put("eof", true);
                result.put("chunk", "");
                call.resolve(result);
                return;
            }
            result.put("eof", false);
            result.put("chunk", Base64.encodeToString(buffer, 0, read, Base64.NO_WRAP));
            call.resolve(result);
        } catch (Exception error) {
            abortImport(sessionId);
            call.reject("Unable to read import chunk", error);
        }
    }

    private void abortImport(String sessionId) {
        PendingImport pending = sessionId == null ? null : pendingImports.remove(sessionId);
        if (pending == null) return;
        try {
            pending.input.close();
        } catch (Exception ignored) {
        }
    }
}
