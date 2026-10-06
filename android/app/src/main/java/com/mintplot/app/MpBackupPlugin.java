package com.mintplot.app;

import android.database.Cursor;
import android.app.Activity;
import android.content.Intent;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.util.Base64;


import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import androidx.activity.result.ActivityResult;

import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * Backup inspect bridge (M4-g2) — shell bridge infrastructure, NOT a product
 * plugin. Read-only access INTO third-party backup archives for the import
 * pipeline: random-access zip listing/reading (RP-Hub and SillyTavern backups
 * are both zips) plus SQLite table reads for the RP database entry. No
 * writes, no deletions — the WebView side maps and lands data through the
 * normal storage seam; this class only inspects.
 *
 * Zip access rides ZipFile over a SAF ParcelFileDescriptor (random access,
 * nothing extracted to disk except the RP SQLite entry, which
 * SQLiteDatabase requires as a real file in cache).
 */
@CapacitorPlugin(name = "MpBackup")
public class MpBackupPlugin extends Plugin {

    private static final long MAX_ENTRY_BYTES = 24L * 1024 * 1024;
    /** RP backup SQLite entries live under database/ (manifest names them). */
    private static final String RP_DB_ENTRY_PREFIX = "database/";

    private final Map<String, OpenZip> openZips = new HashMap<>();
    private final Map<String, OpenDatabase> openDatabases = new HashMap<>();

    private static class OpenZip {
        final ZipFile zipFile;
        /** SAF streams are not seekable, so the archive copies into cache and
         *  ZipFile gets a real file; deleted on close. */
        final File cacheCopy;
        OpenZip(ZipFile zipFile, File cacheCopy) {
            this.zipFile = zipFile;
            this.cacheCopy = cacheCopy;
        }
    }

    private static class OpenDatabase {
        final SQLiteDatabase database;
        final File cacheCopy;
        OpenDatabase(SQLiteDatabase database, File cacheCopy) {
            this.database = database;
            this.cacheCopy = cacheCopy;
        }
    }

    /** Streaming SAF open for LARGE archives (a real RP backup is ~100 MB):
     *  the stream copies into cache through a 64 KB buffer — the WebView
     *  never holds the bytes (a JS-side base64 round-trip crashed the
     *  renderer on the first real-backup test). */
    @PluginMethod
    public void zipOpen(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        startActivityForResult(call, intent, "zipOpenResult");
    }

    @ActivityCallback
    private void zipOpenResult(PluginCall call, ActivityResult activityResult) {
        if (call == null) return;
        if (activityResult.getResultCode() != Activity.RESULT_OK
                || activityResult.getData() == null
                || activityResult.getData().getData() == null) {
            call.reject("cancelled");
            return;
        }
        Uri uri = activityResult.getData().getData();
        File cacheCopy = null;
        ZipFile zipFile = null;
        try {
            File cacheDir = new File(getContext().getCacheDir(), "import-" + UUID.randomUUID());
            if (!cacheDir.mkdirs()) throw new IllegalStateException("Unable to create import directory");
            cacheCopy = new File(cacheDir, "archive.zip");
            byte[] buffer = new byte[64 * 1024];
            try (InputStream input = getContext().getContentResolver().openInputStream(uri);
                 OutputStream output = new java.io.BufferedOutputStream(new FileOutputStream(cacheCopy))) {
                if (input == null) throw new IllegalStateException("Unable to open archive");
                int read;
                while ((read = input.read(buffer)) > 0) output.write(buffer, 0, read);
            }
            zipFile = new ZipFile(cacheCopy);
            JSArray entries = new JSArray();
            java.util.Enumeration<? extends ZipEntry> items = zipFile.entries();
            while (items.hasMoreElements()) {
                ZipEntry entry = items.nextElement();
                if (entry.isDirectory()) continue;
                JSObject item = new JSObject();
                item.put("name", entry.getName().replace('\\', '/'));
                item.put("size", entry.getSize());
                entries.put(item);
            }
            String sessionId = UUID.randomUUID().toString();
            openZips.put(sessionId, new OpenZip(zipFile, cacheCopy));
            JSObject result = new JSObject();
            result.put("sessionId", sessionId);
            result.put("entries", entries);
            call.resolve(result);
        } catch (Exception error) {
            if (zipFile != null) closeQuietly(zipFile, null);
            deleteRecursively(cacheCopy == null ? null : cacheCopy.getParentFile());
            call.reject("Unable to read archive", error);
        }
    }

    /** Opens an archive from bytes the WebView already holds (loose small
     *  files only — never a full backup). */
    @PluginMethod
    public void zipFromBytes(PluginCall call) {
        String base64 = call.getString("base64");
        if (base64 == null || base64.isEmpty()) {
            call.reject("base64 is required");
            return;
        }
        File cacheCopy = null;
        ZipFile zipFile = null;
        try {
            File cacheDir = new File(getContext().getCacheDir(), "import-" + UUID.randomUUID());
            if (!cacheDir.mkdirs()) throw new IllegalStateException("Unable to create import directory");
            cacheCopy = new File(cacheDir, "archive.zip");
            try (OutputStream output = new java.io.BufferedOutputStream(new FileOutputStream(cacheCopy))) {
                output.write(Base64.decode(base64, Base64.NO_WRAP));
            }
            zipFile = new ZipFile(cacheCopy);
            JSArray entries = new JSArray();
            java.util.Enumeration<? extends ZipEntry> items = zipFile.entries();
            while (items.hasMoreElements()) {
                ZipEntry entry = items.nextElement();
                if (entry.isDirectory()) continue;
                JSObject item = new JSObject();
                // Some Windows packers emit backslash separators (non-standard
                // but common) — normalize so prefix matching works everywhere.
                item.put("name", entry.getName().replace('\\', '/'));
                item.put("size", entry.getSize());
                entries.put(item);
            }
            String sessionId = UUID.randomUUID().toString();
            openZips.put(sessionId, new OpenZip(zipFile, cacheCopy));
            JSObject result = new JSObject();
            result.put("sessionId", sessionId);
            result.put("entries", entries);
            call.resolve(result);
        } catch (Exception error) {
            if (zipFile != null) closeQuietly(zipFile, null);
            deleteRecursively(cacheCopy == null ? null : cacheCopy.getParentFile());
            call.reject("Unable to read archive", error);
        }
    }

    @PluginMethod
    public void zipRead(PluginCall call) {
        String sessionId = call.getString("sessionId");
        OpenZip open = sessionId == null ? null : openZips.get(sessionId);
        String entryName = call.getString("entryName");
        if (open == null || entryName == null) {
            call.reject("No active archive session or entryName missing");
            return;
        }
        try {
            ZipEntry entry = open.zipFile.getEntry(entryName);
            if (entry == null && entryName.contains("/")) {
                entry = open.zipFile.getEntry(entryName.replace('/', '\\'));
            }
            if (entry == null) throw new IllegalStateException("Entry not found: " + entryName);
            long size = entry.getSize();
            if (size > MAX_ENTRY_BYTES) throw new IllegalStateException("Entry too large: " + size);
            byte[] bytes = new byte[(int) Math.max(size, 1)];
            int total = 0;
            try (InputStream input = open.zipFile.getInputStream(entry)) {
                int read;
                while ((read = input.read(bytes, total, bytes.length - total)) > 0) total += read;
            }
            JSObject result = new JSObject();
            result.put("bytes", total);
            result.put("base64", Base64.encodeToString(bytes, 0, total, Base64.NO_WRAP));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to read archive entry", error);
        }
    }

    /** Extracts the RP SQLite entry from an OPEN zip into cache and opens it
     *  read-only. The zip session stays open (media files read from it). */
    @PluginMethod
    public void sqliteOpen(PluginCall call) {
        String sessionId = call.getString("sessionId");
        OpenZip open = sessionId == null ? null : openZips.get(sessionId);
        String entryName = call.getString("entryName");
        if (open == null || entryName == null || !entryName.startsWith(RP_DB_ENTRY_PREFIX)) {
            call.reject("No active archive session or database entry missing");
            return;
        }
        File cacheCopy = null;
        try {
            ZipEntry entry = open.zipFile.getEntry(entryName);
            if (entry == null && entryName.contains("/")) {
                entry = open.zipFile.getEntry(entryName.replace('/', '\\'));
            }
            if (entry == null) throw new IllegalStateException("Database entry not found: " + entryName);
            File cacheDir = new File(getContext().getCacheDir(), "import-" + UUID.randomUUID());
            if (!cacheDir.mkdirs()) throw new IllegalStateException("Unable to create import directory");
            cacheCopy = new File(cacheDir, "backup.db");
            byte[] buffer = new byte[64 * 1024];
            try (InputStream input = open.zipFile.getInputStream(entry);
                 OutputStream output = new BufferedOutputStream(new FileOutputStream(cacheCopy))) {
                int read;
                while ((read = input.read(buffer)) > 0) output.write(buffer, 0, read);
            }
            SQLiteDatabase database = SQLiteDatabase.openDatabase(cacheCopy.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY);
            // Integrity gate before anything maps out of it (RP restore does
            // the same PRAGMA quick_check).
            try (Cursor cursor = database.rawQuery("PRAGMA quick_check", null)) {
                if (!cursor.moveToFirst() || !"ok".equalsIgnoreCase(cursor.getString(0))) {
                    throw new IllegalStateException("Backup database failed integrity check");
                }
            }
            String dbSessionId = UUID.randomUUID().toString();
            openDatabases.put(dbSessionId, new OpenDatabase(database, cacheCopy));
            JSObject result = new JSObject();
            result.put("sqliteSessionId", dbSessionId);
            call.resolve(result);
        } catch (Exception error) {
            if (cacheCopy != null) deleteRecursively(cacheCopy.getParentFile());
            call.reject("Unable to open backup database", error);
        }
    }

    /** kv_store as [{key, json}] — the RP key-value mirror. */
    @PluginMethod
    public void kvAll(PluginCall call) {
        OpenDatabase open = requireDatabase(call);
        if (open == null) return;
        try {
            JSArray rows = new JSArray();
            try (Cursor cursor = open.database.query("kv_store", new String[]{"key", "json"}, null, null, null, null, "key")) {
                while (cursor.moveToNext()) {
                    JSObject row = new JSObject();
                    row.put("key", cursor.getString(0));
                    row.put("json", cursor.getString(1));
                    rows.put(row);
                }
            }
            JSObject result = new JSObject();
            result.put("rows", rows);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to read kv_store", error);
        }
    }

    /** chat_messages as [{characterId, messageId, position, status, messageJson}]. */
    @PluginMethod
    public void chatMessages(PluginCall call) {
        OpenDatabase open = requireDatabase(call);
        if (open == null) return;
        try {
            JSArray rows = new JSArray();
            try (Cursor cursor = open.database.query("chat_messages",
                    new String[]{"character_id", "message_id", "position", "status", "message_json"},
                    null, null, null, null, "character_id, position")) {
                while (cursor.moveToNext()) {
                    JSObject row = new JSObject();
                    row.put("characterId", cursor.getString(0));
                    row.put("messageId", cursor.getString(1));
                    row.put("position", cursor.getInt(2));
                    row.put("status", cursor.getString(3));
                    row.put("messageJson", cursor.getString(4));
                    rows.put(row);
                }
            }
            JSObject result = new JSObject();
            result.put("rows", rows);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to read chat_messages", error);
        }
    }

    /** memory_fragments as [{characterId, kind, fragmentId, fragmentJson}]. */
    @PluginMethod
    public void memoryFragments(PluginCall call) {
        OpenDatabase open = requireDatabase(call);
        if (open == null) return;
        try {
            JSArray rows = new JSArray();
            try (Cursor cursor = open.database.query("memory_fragments",
                    new String[]{"character_id", "kind", "fragment_id", "fragment_json"},
                    null, null, null, null, "character_id, kind, fragment_id")) {
                while (cursor.moveToNext()) {
                    JSObject row = new JSObject();
                    row.put("characterId", cursor.getString(0));
                    row.put("kind", cursor.getString(1));
                    row.put("fragmentId", cursor.getString(2));
                    row.put("fragmentJson", cursor.getString(3));
                    rows.put(row);
                }
            }
            JSObject result = new JSObject();
            result.put("rows", rows);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to read memory_fragments", error);
        }
    }

    @PluginMethod
    public void close(PluginCall call) {
        String sessionId = call.getString("sessionId");
        String sqliteSessionId = call.getString("sqliteSessionId");
        if (sqliteSessionId != null) {
            OpenDatabase open = openDatabases.remove(sqliteSessionId);
            if (open != null) {
                try {
                    open.database.close();
                } catch (Exception ignored) {
                }
                deleteRecursively(open.cacheCopy.getParentFile());
            }
        }
        if (sessionId != null) {
            OpenZip open = openZips.remove(sessionId);
            if (open != null) {
                closeQuietly(open.zipFile, null);
                deleteRecursively(open.cacheCopy.getParentFile());
            }
        }
        call.resolve();
    }

    private OpenDatabase requireDatabase(PluginCall call) {
        String sessionId = call.getString("sqliteSessionId");
        OpenDatabase open = sessionId == null ? null : openDatabases.get(sessionId);
        if (open == null) call.reject("No active database session");
        return open;
    }

    private void closeQuietly(ZipFile zipFile, AutoCloseable ignored2) {
        try {
            if (zipFile != null) zipFile.close();
        } catch (Exception ignored) {
        }
    }

    private void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteRecursively(child);
        }
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }
}
