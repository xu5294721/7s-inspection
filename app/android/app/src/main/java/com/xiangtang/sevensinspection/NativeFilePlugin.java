package com.xiangtang.sevensinspection;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@CapacitorPlugin(name = "NativeFile")
public class NativeFilePlugin extends Plugin {
    // 类字段
    private final Map<String, PendingWrite> pendingWrites = new HashMap<>();

    private static class PendingWrite {
        final Uri uri;
        final OutputStream output;
        PendingWrite(Uri uri, OutputStream output) {
            this.uri = uri;
            this.output = output;
        }
    }

    @PluginMethod
    public void saveImage(PluginCall call) {
        String data = call.getString("data");
        String filename = call.getString("filename");
        String mimeType = call.getString("mimeType", "image/jpeg");
        if (data == null || data.isEmpty() || filename == null || filename.isEmpty()) {
            call.reject("图片内容或文件名为空");
            return;
        }

        Uri uri = null;
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            ContentResolver resolver = getContext().getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, filename);
            values.put(MediaStore.Images.Media.MIME_TYPE, mimeType);
            values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/7S巡检");
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
            uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                call.reject("无法创建相册图片");
                return;
            }

            try (OutputStream output = resolver.openOutputStream(uri)) {
                if (output == null) throw new IllegalStateException("无法打开相册图片");
                output.write(bytes);
                output.flush();
            }

            ContentValues completed = new ContentValues();
            completed.put(MediaStore.Images.Media.IS_PENDING, 0);
            resolver.update(uri, completed, null, null);

            JSObject result = new JSObject();
            result.put("uri", uri.toString());
            call.resolve(result);
        } catch (Exception error) {
            if (uri != null) getContext().getContentResolver().delete(uri, null, null);
            call.reject("相册图片保存失败", error);
        }
    }

    @PluginMethod
    public void saveFileBegin(PluginCall call) {
        String filename = call.getString("filename");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        if (filename == null || filename.isEmpty()) {
            call.reject("文件名为空");
            return;
        }
        Uri uri = null;
        try {
            ContentResolver resolver = getContext().getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                call.reject("无法创建手机存储文件");
                return;
            }
            OutputStream output = resolver.openOutputStream(uri);
            if (output == null) throw new IllegalStateException("无法打开手机存储文件");
            String sessionId = UUID.randomUUID().toString();
            pendingWrites.put(sessionId, new PendingWrite(uri, output));
            JSObject result = new JSObject();
            result.put("sessionId", sessionId);
            call.resolve(result);
        } catch (Exception error) {
            if (uri != null) getContext().getContentResolver().delete(uri, null, null);
            call.reject("文件创建失败", error);
        }
    }

    @PluginMethod
    public void saveFileAppend(PluginCall call) {
        String sessionId = call.getString("sessionId");
        String data = call.getString("data");
        if (sessionId == null || data == null || data.isEmpty()) {
            call.reject("分块内容或会话为空");
            return;
        }
        PendingWrite pending = pendingWrites.get(sessionId);
        if (pending == null) {
            call.reject("备份会话不存在或已结束");
            return;
        }
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            pending.output.write(bytes);
            call.resolve();
        } catch (Exception error) {
            call.reject("分块写入失败", error);
        }
    }

    @PluginMethod
    public void saveFileEnd(PluginCall call) {
        String sessionId = call.getString("sessionId");
        if (sessionId == null) {
            call.reject("会话为空");
            return;
        }
        PendingWrite pending = pendingWrites.remove(sessionId);
        if (pending == null) {
            call.reject("备份会话不存在或已结束");
            return;
        }
        try {
            pending.output.flush();
            pending.output.close();
            ContentValues completed = new ContentValues();
            completed.put(MediaStore.Downloads.IS_PENDING, 0);
            getContext().getContentResolver().update(pending.uri, completed, null, null);
            JSObject result = new JSObject();
            result.put("uri", pending.uri.toString());
            call.resolve(result);
        } catch (Exception error) {
            getContext().getContentResolver().delete(pending.uri, null, null);
            call.reject("文件完成失败", error);
        }
    }

    @PluginMethod
    public void saveFileAbort(PluginCall call) {
        String sessionId = call.getString("sessionId");
        if (sessionId == null) {
            call.reject("会话为空");
            return;
        }
        PendingWrite pending = pendingWrites.remove(sessionId);
        if (pending == null) {
            call.resolve();
            return;
        }
        try {
            pending.output.close();
        } catch (Exception ignored) {
        }
        getContext().getContentResolver().delete(pending.uri, null, null);
        call.resolve();
    }

    @PluginMethod
    public void saveFile(PluginCall call) {
        String data = call.getString("data");
        String filename = call.getString("filename");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        if (data == null || data.isEmpty() || filename == null || filename.isEmpty()) {
            call.reject("文件内容或文件名为空");
            return;
        }

        Uri uri = null;
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            ContentResolver resolver = getContext().getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                call.reject("无法创建手机存储文件");
                return;
            }

            try (OutputStream output = resolver.openOutputStream(uri)) {
                if (output == null) throw new IllegalStateException("无法打开手机存储文件");
                output.write(bytes);
                output.flush();
            }

            ContentValues completed = new ContentValues();
            completed.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(uri, completed, null, null);

            JSObject result = new JSObject();
            result.put("uri", uri.toString());
            call.resolve(result);
        } catch (Exception error) {
            if (uri != null) getContext().getContentResolver().delete(uri, null, null);
            call.reject("文件保存失败", error);
        }
    }
}
