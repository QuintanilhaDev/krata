package app.krata;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.PowerManager;
import android.provider.Settings;
import android.app.NotificationManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import org.json.JSONObject;
import java.util.Map;

/** O app do Krata: o site dentro de um WebView, com captura de tela nativa e chamada em segundo plano. */
public class MainActivity extends Activity {
    static final String APP_URL = "https://krata-henna.vercel.app/";
    static final String APP_HOST = Uri.parse(APP_URL).getHost();
    static final String VERSION = "1.3.0";
    static volatile boolean visible = false;

    private static final int REQ_SCREEN = 41;
    private static final int REQ_FILES = 42;
    private static final int REQ_PERMS = 43;
    private static final int REQ_NOTIFY = 44;
    private static final int REQ_NOTIFY_ONLY = 45;

    private KrataWebView web;
    private FrameLayout root;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingPermission;
    private volatile String currentHost = APP_HOST;
    private String screenQuality = "1080";
    private int screenFps = 30;
    private boolean screenAudio = true;
    private TextToSpeech tts;
    private volatile boolean pageReady = false;
    private String pendingChannel, pendingServer;
    private boolean pendingUpdate = false;
    private volatile boolean ttsReady = false;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#050706"));
        w.setNavigationBarColor(Color.parseColor("#050706"));
        w.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#050706"));
        web = new KrataWebView(this);
        web.setBackgroundColor(Color.parseColor("#050706"));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setUserAgentString(s.getUserAgentString() + " KrataApp/" + VERSION);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "KrataNative");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String disposition, String mime, long length) { download(url, disposition, mime); }
        });

        // voz da Prisma: síntese do próprio Android (o WebView não tem)
        tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() {
            @Override public void onInit(int status) {
                if (status != TextToSpeech.SUCCESS) return;
                Locale br = new Locale("pt", "BR");
                tts.setLanguage(br);
                try {
                    Voice best = null;
                    int bestScore = -99;
                    for (Voice v : tts.getVoices()) {
                        if (v.getLocale() == null || !"pt".equals(v.getLocale().getLanguage())) continue;
                        String n = v.getName().toLowerCase(Locale.ROOT);
                        int score = ("BR".equals(v.getLocale().getCountry()) ? 4 : 0) + (v.isNetworkConnectionRequired() ? 0 : 2)
                                + (n.contains("female") || n.contains("afs") || n.contains("ptd") ? 6 : 0) - (n.contains("male") && !n.contains("female") ? 8 : 0)
                                + (v.getQuality() >= Voice.QUALITY_HIGH ? 2 : 0);
                        if (score > bestScore) { bestScore = score; best = v; }
                    }
                    if (best != null) tts.setVoice(best);
                } catch (Throwable ignored) {}
                ttsReady = true;
            }
        });

        takeOpen(getIntent());
        if (saved != null) web.restoreState(saved);
        else web.loadUrl(startUrl(getIntent()));

        Updater.check(this, false);
        // notificações: volta a agendar a busca em segundo plano
        SyncJob.schedule(this);
        if (Inbox.configured(this)) SyncService.start(this);
    }

    private String startUrl(Intent intent) {
        Uri data = intent != null ? intent.getData() : null;
        if (data != null && APP_HOST.equals(data.getHost())) return data.toString();
        return APP_URL;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (takeOpen(intent)) { flushOpen(); return; }
        Uri data = intent.getData();
        if (data != null && APP_HOST.equals(data.getHost())) web.loadUrl(data.toString());
    }

    /** Toque numa notificação: guarda qual conversa abrir. */
    private boolean takeOpen(Intent intent) {
        if (intent != null && intent.getBooleanExtra("update", false)) {
            Updater.check(this, false);
            if (pageReady) web.evaluateJavascript("window.dispatchEvent(new Event('krata-update'))", null);
            else pendingUpdate = true;
        }
        String ch = intent != null ? intent.getStringExtra("channel") : null;
        if (ch == null || ch.isEmpty()) return false;
        pendingChannel = ch;
        pendingServer = intent.getStringExtra("server");
        return true;
    }

    private void flushOpen() {
        if (pendingUpdate && pageReady) { pendingUpdate = false; web.evaluateJavascript("window.dispatchEvent(new Event('krata-update'))", null); }
        if (pendingChannel == null || !pageReady) return;
        String js = "window.__krataOpen && window.__krataOpen(" + JSONObject.quote(pendingServer == null ? "" : pendingServer) + "," + JSONObject.quote(pendingChannel) + ")";
        pendingChannel = null;
        web.evaluateJavascript(js, null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        visible = true;
        Updater.resume(this);
        if (System.currentTimeMillis() - Updater.prefs(this).getLong("checked", 0) > 30L * 60 * 1000) Updater.check(this, false);
        // avisa o site que o app voltou para a tela (marca a conversa aberta como lida e limpa as notificações dela)
        if (web != null) web.evaluateJavascript("document.dispatchEvent(new Event('visibilitychange'))", null);
    }

    @Override
    protected void onPause() {
        visible = false;
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (customView != null) { hideCustomView(); return; }
        // o site fecha janelas, painéis e menus primeiro
        web.evaluateJavascript("(window.__krataBack && window.__krataBack()) ? 'yes' : 'no'", new ValueCallback<String>() {
            @Override public void onReceiveValue(String v) {
                if (v != null && v.contains("yes")) return;
                if (web.canGoBack()) web.goBack();
                else moveTaskToBack(true); // não fecha: a chamada continua
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        if (isFinishing() && !ScreenHub.keepAlive()) stopService(new Intent(this, KrataService.class));
        super.onDestroy();
    }

    // ------------------------------------------------------------------ ponte com o site
    private boolean trusted() { return APP_HOST.equals(currentHost); }

    final class Bridge {
        @JavascriptInterface public String version() { return VERSION; }

        @JavascriptInterface public String screenState() { return trusted() ? ScreenHub.state : "error"; }

        @JavascriptInterface public void startScreen(final String quality, final int fps, final boolean audio) {
            if (!trusted()) return;
            ScreenHub.setState("asking");
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    screenQuality = quality; screenFps = fps; screenAudio = audio;
                    List<String> need = new ArrayList<String>();
                    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.POST_NOTIFICATIONS);
                    if (audio && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.RECORD_AUDIO);
                    // primeiro as permissões, depois o aviso de captura (um de cada vez)
                    if (!need.isEmpty()) requestPermissions(need.toArray(new String[0]), REQ_NOTIFY);
                    else askCapture();
                }
            });
        }

        @JavascriptInterface public void speak(String text, float rate, float pitch, float volume) {
            if (!trusted() || !ttsReady || text == null) return;
            tts.setSpeechRate(rate);
            tts.setPitch(pitch);
            Bundle p = new Bundle();
            p.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volume);
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, p, "prisma");
        }

        @JavascriptInterface public void stopSpeaking() { if (ttsReady) tts.stop(); }

        @JavascriptInterface public boolean isSpeaking() { return ttsReady && tts.isSpeaking(); }

        // ---------------------------------------------------------- notificações
        @JavascriptInterface public void setInbox(String json) {
            if (!trusted()) return;
            try {
                Inbox.configure(MainActivity.this, new JSONObject(json));
                Notifier.channels(MainActivity.this);
                SyncJob.schedule(MainActivity.this);
                SyncService.start(MainActivity.this);
            } catch (Throwable ignored) {}
        }

        @JavascriptInterface public void clearInbox() {
            if (!trusted()) return;
            Inbox.clear(MainActivity.this);
            SyncService.stop(MainActivity.this);
            SyncJob.cancel(MainActivity.this);
        }

        @JavascriptInterface public void notify(final String json) {
            if (!trusted()) return;
            new Thread(new Runnable() {
                @Override public void run() {
                    try {
                        JSONObject m = new JSONObject(json);
                        if (Inbox.markSeen(MainActivity.this, m.optString("id"))) Notifier.show(MainActivity.this, m, false);
                    } catch (Throwable ignored) {}
                }
            }).start();
        }

        @JavascriptInterface public void clearChannel(String channelId) {
            if (!trusted() || channelId == null) return;
            Notifier.clearChannel(MainActivity.this, channelId);
        }

        @JavascriptInterface public boolean appVisible() { return visible; }

        @JavascriptInterface public boolean notificationsAllowed() {
            return getSystemService(NotificationManager.class).areNotificationsEnabled();
        }

        @JavascriptInterface public void requestNotifications() {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                            && !getSharedPreferences("krata_ui", MODE_PRIVATE).getBoolean("asked_notify", false)) {
                        getSharedPreferences("krata_ui", MODE_PRIVATE).edit().putBoolean("asked_notify", true).apply();
                        requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQ_NOTIFY_ONLY);
                        return;
                    }
                    try {
                        startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
                    } catch (Throwable ignored) {}
                }
            });
        }

        @JavascriptInterface public boolean backgroundAllowed() {
            PowerManager pm = getSystemService(PowerManager.class);
            return pm == null || pm.isIgnoringBatteryOptimizations(getPackageName());
        }

        @JavascriptInterface public void openBackgroundSettings() {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    try {
                        startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
                    } catch (Throwable t) {
                        try { startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); } catch (Throwable ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface public void setLiveSync(boolean on) {
            if (!trusted()) return;
            Inbox.setLiveSync(MainActivity.this, on);
            if (on) SyncService.start(MainActivity.this); else SyncService.stop(MainActivity.this);
        }

        /** "video" = H.264 por hardware (rápido); "jpeg" = modo compatível. */
        @JavascriptInterface public void setScreenMode(String mode) { ScreenHub.mode = "video".equals(mode) ? "video" : "jpeg"; }

        @JavascriptInterface public String screenCodec() { return ScreenHub.codec; }

        @JavascriptInterface public String screenMode() { return ScreenHub.mode; }

        // ---------------------------------------------------------- atualização dentro do app
        @JavascriptInterface public String updateInfo() { return Updater.info(MainActivity.this); }

        @JavascriptInterface public void checkUpdate() { Updater.check(MainActivity.this, false); }

        @JavascriptInterface public void installUpdate() {
            if (!trusted()) return;
            runOnUiThread(new Runnable() { @Override public void run() { Updater.start(MainActivity.this); } });
        }

        @JavascriptInterface public void stopScreen() {
            if (!trusted()) return;
            startService(new Intent(MainActivity.this, KrataService.class).setAction(KrataService.ACTION_SCREEN_STOP));
        }

        @JavascriptInterface public void setInCall(final boolean on) {
            if (!trusted()) return;
            ScreenHub.inCall = on;
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    try {
                        startService(new Intent(MainActivity.this, KrataService.class).setAction(on ? KrataService.ACTION_CALL_ON : KrataService.ACTION_CALL_OFF));
                    } catch (Throwable ignored) { /* app em segundo plano: tenta na próxima */ }
                    if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }
    }

    private void askCapture() {
        try {
            MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            startActivityForResult(mpm.createScreenCaptureIntent(), REQ_SCREEN);
        } catch (Throwable t) {
            ScreenHub.setState("error");
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request == REQ_SCREEN) {
            if (result != RESULT_OK || data == null) { ScreenHub.setState("denied"); return; }
            Intent i = new Intent(this, KrataService.class).setAction(KrataService.ACTION_SCREEN_START)
                    .putExtra("code", result).putExtra("data", data)
                    .putExtra("quality", screenQuality).putExtra("fps", screenFps).putExtra("audio", screenAudio);
            try {
                if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
            } catch (Throwable t) { ScreenHub.setState("error"); }
            return;
        }
        if (request == REQ_FILES) {
            if (fileCallback == null) return;
            Uri[] out = null;
            if (result == RESULT_OK && data != null) {
                ClipData clip = data.getClipData();
                if (clip != null) {
                    out = new Uri[clip.getItemCount()];
                    for (int k = 0; k < clip.getItemCount(); k++) out[k] = clip.getItemAt(k).getUri();
                } else if (data.getData() != null) out = new Uri[] { data.getData() };
            }
            fileCallback.onReceiveValue(out);
            fileCallback = null;
        }
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] perms, int[] results) {
        if (request == REQ_NOTIFY) { askCapture(); return; }
        if (request != REQ_PERMS || pendingPermission == null) return;
        List<String> grant = new ArrayList<String>();
        for (String r : pendingPermission.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) grant.add(r);
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) grant.add(r);
        }
        if (grant.isEmpty()) pendingPermission.deny();
        else pendingPermission.grant(grant.toArray(new String[0]));
        pendingPermission = null;
    }

    // ------------------------------------------------------------------ navegação
    final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            String scheme = u.getScheme();
            if (("https".equals(scheme) || "http".equals(scheme)) && APP_HOST.equals(u.getHost())) return false;
            if (u.toString().endsWith(".apk") && APP_HOST.equals(u.getHost())) return false;
            try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException ignored) {}
            return true; // links de fora abrem no navegador
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            currentHost = Uri.parse(url).getHost();
            pageReady = false;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            // o site ainda carrega a sessão depois do "load": espera um pouco antes de abrir a conversa
            view.postDelayed(new Runnable() { @Override public void run() { pageReady = true; flushOpen(); } }, 1800);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!APP_HOST.equals(u.getHost()) || u.getPath() == null || !u.getPath().startsWith("/__krata/")) return null;
            return local(u);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError error) {
            if (req.isForMainFrame()) view.loadDataWithBaseURL(APP_URL, OFFLINE, "text/html", "utf-8", null);
        }
    }

    /** Quadros e som da captura de tela, entregues no mesmo endereço do site. */
    private WebResourceResponse local(Uri u) {
        Map<String, String> h = new HashMap<String, String>();
        h.put("Cache-Control", "no-store");
        try {
            String path = u.getPath();
            if ("/__krata/frame".equals(path)) {
                if (!"live".equals(ScreenHub.state)) return new WebResourceResponse("text/plain", "utf-8", 410, "Gone", h, new ByteArrayInputStream(new byte[0]));
                long after = 0;
                try { after = Long.parseLong(u.getQueryParameter("after")); } catch (Exception ignored) {}
                Object[] f = ScreenHub.awaitFrame(after, 800);
                if (f == null) return new WebResourceResponse("text/plain", "utf-8", 204, "No Content", h, new ByteArrayInputStream(new byte[0]));
                h.put("X-Frame-Id", String.valueOf(f[1]));
                return new WebResourceResponse("image/jpeg", null, 200, "OK", h, new ByteArrayInputStream((byte[]) f[0]));
            }
            if ("/__krata/video".equals(path)) {
                if (!"live".equals(ScreenHub.state)) return new WebResourceResponse("text/plain", "utf-8", 410, "Gone", h, new ByteArrayInputStream(new byte[0]));
                long after = 0;
                try { after = Long.parseLong(u.getQueryParameter("after")); } catch (Exception ignored) {}
                java.util.List<Object[]> chunks = ScreenHub.awaitVideo(after, 700);
                // [tamanho int32][chave int8][pts int64][seq int64] + dados, em sequência
                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                java.io.DataOutputStream out = new java.io.DataOutputStream(bo);
                try {
                    for (Object[] c : chunks) {
                        byte[] d = (byte[]) c[3];
                        out.writeInt(d.length); out.writeByte((Boolean) c[1] ? 1 : 0); out.writeLong((Long) c[2]); out.writeLong((Long) c[0]); out.write(d);
                    }
                } catch (java.io.IOException ignored) {}
                h.put("X-Codec", ScreenHub.codec);
                return new WebResourceResponse("application/octet-stream", null, 200, "OK", h, new ByteArrayInputStream(bo.toByteArray()));
            }
            if ("/__krata/audio".equals(path)) {
                byte[] a = ScreenHub.takeAudio(120);
                return new WebResourceResponse("application/octet-stream", null, 200, "OK", h, new ByteArrayInputStream(a));
            }
        } catch (InterruptedException ignored) {}
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", h, new ByteArrayInputStream(new byte[0]));
    }

    // ------------------------------------------------------------------ permissões, arquivos, tela cheia
    final class Chrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    if (!APP_HOST.equals(request.getOrigin().getHost())) { request.deny(); return; }
                    List<String> need = new ArrayList<String>();
                    for (String r : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.RECORD_AUDIO);
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.CAMERA);
                    }
                    if (need.isEmpty()) {
                        List<String> ok = new ArrayList<String>();
                        for (String r : request.getResources())
                            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) || PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) ok.add(r);
                        if (ok.isEmpty()) request.deny(); else request.grant(ok.toArray(new String[0]));
                        return;
                    }
                    if (pendingPermission != null) pendingPermission.deny();
                    pendingPermission = request;
                    requestPermissions(need.toArray(new String[0]), REQ_PERMS);
                }
            });
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            String[] types = params.getAcceptTypes();
            String type = types != null && types.length > 0 && types[0] != null && !types[0].isEmpty() ? types[0] : "*/*";
            i.setType(type.contains("/") ? type : "*/*");
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            try {
                startActivityForResult(Intent.createChooser(i, "Escolher arquivo"), REQ_FILES);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
            return true;
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) { callback.onCustomViewHidden(); return; }
            customView = view;
            customCallback = callback;
            root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            web.setVisibility(View.GONE);
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }

        @Override
        public void onHideCustomView() { hideCustomView(); }
    }

    private void hideCustomView() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        web.setVisibility(View.VISIBLE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        if (customCallback != null) customCallback.onCustomViewHidden();
        customCallback = null;
    }

    private void download(String url, String disposition, String mime) {
        try {
            if (!URLUtil.isNetworkUrl(url)) { Toast.makeText(this, "Esse arquivo não pode ser baixado pelo app.", Toast.LENGTH_SHORT).show(); return; }
            String name = URLUtil.guessFileName(url, disposition, mime);
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            r.setMimeType(mime);
            r.setTitle(name);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(r);
            Toast.makeText(this, "Baixando " + name, Toast.LENGTH_SHORT).show();
        } catch (Throwable t) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Throwable ignored) {}
        }
    }

    private static final String OFFLINE = "<!doctype html><html lang='pt-BR'><meta name='viewport' content='width=device-width,initial-scale=1'>"
            + "<body style='margin:0;height:100vh;display:grid;place-items:center;background:#050706;color:#e4eae7;font-family:system-ui,sans-serif;text-align:center'>"
            + "<div style='padding:24px'><div style='font-size:46px;color:#3ddba4'>&#9670;</div><h2 style='margin:12px 0 6px'>Sem conexão</h2>"
            + "<p style='color:#a4b0ab;margin:0 0 20px'>O Krata precisa de internet. Confira o Wi-Fi ou os dados móveis.</p>"
            + "<button onclick=\"location.href='" + APP_URL + "'\" style='font:inherit;font-weight:700;padding:12px 22px;border:0;border-radius:12px;background:#00a86b;color:#03140d'>Tentar de novo</button></div></body></html>";
}
