package tw.abang.app;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.PickVisualMediaRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.tasks.Tasks;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.genai.common.FeatureStatus;
import com.google.mlkit.genai.common.GenAiException;
import com.google.mlkit.genai.prompt.GenerateContentRequest;
import com.google.mlkit.genai.prompt.GenerateContentResponse;
import com.google.mlkit.genai.prompt.Generation;
import com.google.mlkit.genai.prompt.ImagePart;
import com.google.mlkit.genai.prompt.TextPart;
import com.google.mlkit.genai.prompt.java.GenerativeModelFutures;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;
import java.io.File;
import java.io.InputStream;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * 阿幫會看（M14-02，ADR-0015）：拍照或選一張圖，在手機上讀字（OCR）與條碼，只把讀出來的文字回給 JS。
 * JS 端：public/js/vision.js（外掛名 AbangVision）。
 * - 拍照：系統相機（MediaStore.ACTION_IMAGE_CAPTURE）寫到 App 私有的暫存檔（cache/vision/），讀完立刻刪除；不存相簿、不上傳。
 *   App 有宣告 CAMERA 權限（舊的網頁掃描用），所以第一次拍照時才向使用者要相機權限。
 * - 選圖：系統相片選擇器（Photo Picker，PickVisualMedia；舊手機自動改用文件選擇器），只拿到使用者選的那一張，不需要相簿權限。
 * - 讀字：ML Kit Text Recognition v2 中文模型（打包在 App 內，離線可用）；條碼：ML Kit Barcode Scanning（打包版），只找 QR 與 Code 39（發票）。
 * - 影像理解（選用）：Gemini Nano（ML Kit GenAI Prompt API）在這支手機支援影像輸入時，回一個分類提示（sms／sign／invoice／other）；只有 NOT_SUPPORTED 才記住不再試。
 *   系統沒有「是否支援影像」的查詢，第一次試過才知道；結果記在 SharedPreferences（只有 ok／no），不記圖片或內容。
 * 只記耗時與錯誤類型，不記讀出來的字。
 */
@CapacitorPlugin(name = "AbangVision", permissions = { @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }) })
public class AbangVisionPlugin extends Plugin {
    private static final String TAG = "AbangVision";
    /** 長邊最多這麼多像素（OCR 夠用，記憶體與速度都穩） */
    private static final int MAX_EDGE = 2560;
    private static final long DESCRIBE_TIMEOUT_MS = 3000;
    private static final String PREFS = "abang.vision";
    private final ExecutorService exec = Executors.newSingleThreadExecutor();
    private TextRecognizer text;
    private BarcodeScanner barcode;
    private GenerativeModelFutures nano;
    private File shot;

    /** 拍照暫存資料夾（App 私有 cache；FileProvider 只開放這裡，res/xml/file_paths.xml） */
    private File visionDir() { return new File(getContext().getCacheDir(), "vision"); }

    /** 清掉暫存資料夾裡的所有檔案（上次拍照時 App 被系統回收或殺掉，照片不能留在手機上） */
    private void clearVisionDir() {
        File[] files = visionDir().listFiles();
        if (files != null) for (File f : files) { if (!f.delete()) Logger.warn(TAG, "暫存檔刪不掉"); }
    }

    @Override
    public void load() {
        super.load();
        clearVisionDir(); // 外掛啟動時先清（不保存照片）
    }

    private TextRecognizer text() {
        if (text == null) text = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
        return text;
    }

    private BarcodeScanner barcode() {
        if (barcode == null) barcode = BarcodeScanning.getClient(new BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE, Barcode.FORMAT_CODE_39).build());
        return barcode;
    }

    private SharedPreferences prefs() { return getContext().getSharedPreferences(PREFS, Activity.MODE_PRIVATE); }

    /** 影像理解：'ok'（試過可以）、'no'（試過不行）、null（還沒試過） */
    private String describeState() { return prefs().getString("describe", null); }

    private boolean nanoOsOk() { return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O; }

    @PluginMethod
    public void available(PluginCall call) {
        JSObject o = new JSObject();
        o.put("platform", "android");
        boolean hasCamera = getContext().getPackageManager().hasSystemFeature("android.hardware.camera.any");
        o.put("camera", hasCamera);
        o.put("photos", true);
        o.put("cameraPermission", permText(getPermissionState("camera")));
        JSObject t = new JSObject();
        t.put("available", true);
        t.put("engine", "mlkit-text-chinese");
        o.put("text", t);
        JSObject b = new JSObject();
        b.put("available", true);
        b.put("engine", "mlkit-barcode");
        o.put("barcode", b);
        JSObject d = new JSObject();
        d.put("engine", "gemini-nano");
        String st = describeState();
        d.put("state", !nanoOsOk() ? "unsupported" : st == null ? "untested" : "ok".equals(st) ? "supported" : "unsupported");
        o.put("describe", d);
        call.resolve(o);
    }

    private static String permText(PermissionState s) {
        if (s == PermissionState.GRANTED) return "granted";
        if (s == PermissionState.DENIED) return "denied";
        return "prompt";
    }

    @PluginMethod
    public void capture(PluginCall call) {
        String source = call.getString("source", "camera");
        if ("photos".equals(source)) { pickPhoto(call); return; }
        if (!getContext().getPackageManager().hasSystemFeature("android.hardware.camera.any")) { call.reject("這支手機沒有相機", "unavailable"); return; }
        if (getPermissionState("camera") != PermissionState.GRANTED) { requestPermissionForAlias("camera", call, "cameraPermsCallback"); return; }
        takePhoto(call);
    }

    @PermissionCallback
    private void cameraPermsCallback(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) takePhoto(call);
        else call.reject("沒有相機權限", "denied");
    }

    private void pickPhoto(PluginCall call) {
        try {
            Intent i = new ActivityResultContracts.PickVisualMedia().createIntent(getContext(),
                new PickVisualMediaRequest.Builder().setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly.INSTANCE).build());
            startActivityForResult(call, i, "picked");
        } catch (Exception e) {
            Logger.warn(TAG, "picker: " + e.getClass().getSimpleName());
            call.reject("打不開相片選擇器", "unavailable");
        }
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri uri = result.getResultCode() == Activity.RESULT_OK && result.getData() != null ? result.getData().getData() : null;
        if (uri == null) { call.reject("沒有選照片", "cancelled"); return; }
        read(call, uri, false);
    }

    private void takePhoto(PluginCall call) {
        try {
            File dir = visionDir();
            if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("cache");
            shot = new File(dir, "shot.jpg"); // 只有一個檔，下一次覆蓋；讀完就刪
            Uri out = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", shot);
            Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            i.putExtra(MediaStore.EXTRA_OUTPUT, out);
            i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivityForResult(call, i, "shotTaken");
        } catch (Exception e) {
            Logger.warn(TAG, "camera: " + e.getClass().getSimpleName());
            call.reject("打不開相機", "unavailable");
        }
    }

    @ActivityCallback
    private void shotTaken(PluginCall call, ActivityResult result) {
        File f = shot != null ? shot : new File(visionDir(), "shot.jpg");
        if (call == null) { clearVisionDir(); return; } // App 在拍照時被回收：沒有人等結果，照片也不能留著
        if (result.getResultCode() != Activity.RESULT_OK || !f.exists() || f.length() == 0) { f.delete(); call.reject("沒有拍照", "cancelled"); return; }
        read(call, Uri.fromFile(f), true);
    }

    /** 解碼（縮到長邊 MAX_EDGE、照 EXIF 轉正）→ 讀字與條碼 →（選用）影像理解；暫存檔一定刪掉 */
    private void read(PluginCall call, Uri uri, boolean deleteAfter) {
        JSObject stage = new JSObject();
        stage.put("stage", "reading");
        notifyListeners("stage", stage); // JS 開始「阿幫在看」動畫（相機或選擇器已經關了）
        JSArray wantArr = call.getArray("want", new JSArray());
        List<String> want;
        try { want = wantArr.toList(); } catch (Exception e) { want = java.util.Arrays.asList("text", "barcode"); }
        final List<String> w = want;
        exec.execute(() -> {
            long t0 = System.currentTimeMillis();
            Bitmap bmp = null;
            try {
                bmp = decode(uri);
                if (bmp == null) { call.reject("讀不到這張圖", "failed"); return; }
                InputImage img = InputImage.fromBitmap(bmp, 0);
                JSObject ret = new JSObject();
                ret.put("engine", "mlkit");
                ret.put("width", bmp.getWidth());
                ret.put("height", bmp.getHeight());
                if (w.contains("text")) ret.put("text", ocr(img, bmp.getWidth(), bmp.getHeight()));
                if (w.contains("barcode")) ret.put("barcodes", codes(img));
                if (w.contains("describe")) { JSObject d = describe(bmp); if (d != null) ret.put("describe", d); }
                ret.put("ms", System.currentTimeMillis() - t0);
                Logger.info(TAG, "read in " + (System.currentTimeMillis() - t0) + " ms"); // 只記耗時，不記內容
                call.resolve(ret);
            } catch (Throwable e) { // 含 OutOfMemoryError：一定要回 JS，不能讓畫面一直「阿幫在看」
                Logger.warn(TAG, "read failed: " + e.getClass().getSimpleName());
                call.reject("這次沒讀到", "failed");
            } finally {
                if (bmp != null) bmp.recycle();
                if (deleteAfter) { try { new File(uri.getPath()).delete(); } catch (Exception ignored) { /* 已刪 */ } }
            }
        });
    }

    private Bitmap decode(Uri uri) throws Exception {
        ContentResolver cr = getContext().getContentResolver();
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream in = cr.openInputStream(uri)) { BitmapFactory.decodeStream(in, null, bounds); }
        int edge = Math.max(bounds.outWidth, bounds.outHeight);
        if (edge <= 0) return null;
        BitmapFactory.Options opt = new BitmapFactory.Options();
        opt.inSampleSize = 1;
        while (edge / opt.inSampleSize > MAX_EDGE) opt.inSampleSize *= 2; // 解碼時就縮到長邊不超過 MAX_EDGE（不先解出原圖）
        Bitmap b;
        try (InputStream in = cr.openInputStream(uri)) { b = BitmapFactory.decodeStream(in, null, opt); }
        if (b == null) return null;
        int deg = 0;
        try (InputStream in = cr.openInputStream(uri)) {
            int o = new ExifInterface(in).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            deg = o == ExifInterface.ORIENTATION_ROTATE_90 ? 90 : o == ExifInterface.ORIENTATION_ROTATE_180 ? 180 : o == ExifInterface.ORIENTATION_ROTATE_270 ? 270 : 0;
        } catch (Exception e) { /* PNG 截圖沒有 EXIF */ }
        if (deg == 0) return b; // 不必再縮（解碼時已縮），只有要轉正時才複製一次
        Matrix m = new Matrix();
        m.postRotate(deg);
        Bitmap r = Bitmap.createBitmap(b, 0, 0, b.getWidth(), b.getHeight(), m, true);
        if (r != b) b.recycle();
        return r;
    }

    private static JSObject box(Rect r, int w, int h) {
        JSObject o = new JSObject();
        if (r == null || w <= 0 || h <= 0) return o;
        o.put("x", round((float) r.left / w));
        o.put("y", round((float) r.top / h));
        o.put("w", round((float) r.width() / w));
        o.put("h", round((float) r.height() / h));
        return o;
    }

    private static double round(float v) { return Math.round(v * 1000) / 1000.0; }

    private JSObject ocr(InputImage img, int w, int h) throws Exception {
        Text t = Tasks.await(text().process(img), 10, TimeUnit.SECONDS);
        JSArray lines = new JSArray();
        JSArray blocks = new JSArray();
        for (Text.TextBlock b : t.getTextBlocks()) {
            JSObject bo = new JSObject();
            bo.put("text", b.getText());
            bo.put("box", box(b.getBoundingBox(), w, h));
            blocks.put(bo);
            for (Text.Line l : b.getLines()) {
                JSObject lo = new JSObject();
                lo.put("text", l.getText());
                lo.put("box", box(l.getBoundingBox(), w, h));
                lines.put(lo);
            }
        }
        JSObject o = new JSObject();
        o.put("full", t.getText());
        o.put("lines", lines);
        o.put("blocks", blocks);
        return o;
    }

    private JSArray codes(InputImage img) throws Exception {
        List<Barcode> list = Tasks.await(barcode().process(img), 10, TimeUnit.SECONDS);
        JSArray out = new JSArray();
        for (Barcode b : list) {
            String raw = b.getRawValue();
            if (raw == null || raw.isEmpty()) continue;
            JSObject o = new JSObject();
            o.put("format", b.getFormat() == Barcode.FORMAT_QR_CODE ? "qr_code" : b.getFormat() == Barcode.FORMAT_CODE_39 ? "code_39" : "other");
            o.put("raw", raw);
            out.put(o);
        }
        return out;
    }

    /**
     * 影像理解（選用）：只在 Gemini Nano 可用、而且這支手機沒有試過失敗時才試。回 { engine, kind } 或 null。
     * 模型不收原圖以外的東西；回答只取一個英文字（sms／sign／invoice／other）。
     */
    private JSObject describe(Bitmap bmp) {
        if (!nanoOsOk() || "no".equals(describeState())) return null;
        Bitmap small = null;
        try {
            if (nano == null) nano = GenerativeModelFutures.from(Generation.INSTANCE.getClient());
            if (nano.checkStatus().get(1000, TimeUnit.MILLISECONDS) != FeatureStatus.AVAILABLE) return null;
            small = Bitmap.createScaledBitmap(bmp, Math.max(1, bmp.getWidth() / 3), Math.max(1, bmp.getHeight() / 3), true);
            GenerateContentRequest.Builder b = new GenerateContentRequest.Builder(new ImagePart(small),
                new TextPart("這張圖是哪一種？sms＝手機簡訊、聊天或 Email 訊息的截圖；sign＝公車站牌、路牌或車站指標；invoice＝發票或收據；other＝其他。只回一個英文字。"));
            b.setTemperature(0f);
            b.setTopK(1);
            b.setMaxOutputTokens(4);
            ListenableFuture<GenerateContentResponse> f = nano.generateContent(b.build());
            GenerateContentResponse r = f.get(DESCRIBE_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            String out = r.getCandidates().isEmpty() ? "" : String.valueOf(r.getCandidates().get(0).getText()).trim().toLowerCase(Locale.ROOT);
            String kind = out.startsWith("sms") ? "sms" : out.startsWith("sign") ? "sign" : out.startsWith("invoice") ? "invoice" : "other";
            prefs().edit().putString("describe", "ok").apply();
            JSObject o = new JSObject();
            o.put("engine", "gemini-nano");
            o.put("kind", kind);
            return o;
        } catch (Throwable e) {
            // 只有確定「不支援圖片輸入」才記住不再試；逾時、忙碌、配額、背景被擋等暫時性錯誤這次跳過就好
            Throwable c = e.getCause() != null ? e.getCause() : e;
            if (c instanceof GenAiException) {
                int code = ((GenAiException) c).getErrorCode();
                if (code == GenAiException.ErrorCode.NOT_SUPPORTED) prefs().edit().putString("describe", "no").apply();
                Logger.warn(TAG, "describe: GenAiException:" + code);
            } else Logger.warn(TAG, "describe: " + c.getClass().getSimpleName());
            return null;
        } finally {
            if (small != null && small != bmp) small.recycle();
        }
    }

    @Override
    protected void handleOnDestroy() {
        exec.shutdownNow();
        if (text != null) text.close();
        if (barcode != null) barcode.close();
        super.handleOnDestroy();
    }
}
