package app.krata;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Atualização dentro do app: confere no site se tem versão nova (krata-version.json),
 * baixa o .apk e abre a instalação do Android — sem passar pelo navegador.
 */
final class Updater {
    private Updater() {}

    /** idle | available | downloading | permission | installing | error | latest */
    static volatile String state = "idle";
    static volatile int progress = 0;
    static volatile String error = "";
    static volatile JSONObject latest = null;
    private static volatile File pending = null;
    private static final String CH_UPDATE = "krata_update";

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("krata_update", Context.MODE_PRIVATE); }

    static int installedCode(Context c) {
        try {
            PackageInfo pi = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? (int) pi.getLongVersionCode() : pi.versionCode;
        } catch (Exception e) { return 0; }
    }

    static String info(Context c) {
        try {
            JSONObject o = new JSONObject();
            o.put("state", state);
            o.put("progress", progress);
            o.put("error", error);
            o.put("installed", MainActivity.VERSION);
            o.put("installedCode", installedCode(c));
            if (latest != null) {
                o.put("versionName", latest.optString("versionName"));
                o.put("versionCode", latest.optInt("versionCode"));
                o.put("notes", latest.optString("notes"));
                o.put("size", latest.optLong("size"));
            }
            return o.toString();
        } catch (Exception e) { return "{}"; }
    }

    /** Confere no site (em segundo plano). */
    static void check(final Context c, final boolean notifyIfNew) {
        new Thread(new Runnable() {
            @Override public void run() { checkNow(c, notifyIfNew); }
        }).start();
    }

    static synchronized void checkNow(Context c, boolean notifyIfNew) {
        if ("downloading".equals(state) || "installing".equals(state)) return;
        try {
            HttpURLConnection con = (HttpURLConnection) new URL(MainActivity.APP_URL + "krata-version.json?t=" + System.currentTimeMillis()).openConnection();
            con.setConnectTimeout(8000);
            con.setReadTimeout(8000);
            con.setUseCaches(false);
            if (con.getResponseCode() != 200) { con.disconnect(); return; }
            JSONObject v = new JSONObject(Inbox.read(con.getInputStream()));
            con.disconnect();
            prefs(c).edit().putLong("checked", System.currentTimeMillis()).apply();
            if (v.optInt("versionCode", 0) > installedCode(c)) {
                latest = v;
                if (!"permission".equals(state) && !"error".equals(state)) state = "available";
                if (notifyIfNew && prefs(c).getInt("notified", 0) < v.optInt("versionCode")) {
                    prefs(c).edit().putInt("notified", v.optInt("versionCode")).apply();
                    notifyAvailable(c, v);
                }
            } else {
                latest = null;
                state = "latest";
            }
        } catch (Throwable ignored) {}
    }

    /** Com o app fechado: no máximo uma conferida a cada 6 horas. */
    static void checkQuietly(Context c) {
        if (System.currentTimeMillis() - prefs(c).getLong("checked", 0) < 6L * 3600 * 1000) return;
        checkNow(c, true);
    }

    private static void notifyAvailable(Context c, JSONObject v) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CH_UPDATE) == null) {
            NotificationChannel ch = new NotificationChannel(CH_UPDATE, "Atualizações do app", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Avisa quando sai uma versão nova do Krata.");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(c, MainActivity.class).setAction("app.krata.UPDATE").addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("update", true);
        PendingIntent pi = PendingIntent.getActivity(c, 77, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String notes = v.optString("notes", "");
        Notification n = new Notification.Builder(c, CH_UPDATE)
                .setSmallIcon(R.drawable.ic_stat)
                .setColor(0xFF00A86B)
                .setContentTitle("Krata " + v.optString("versionName") + " chegou")
                .setContentText(notes.isEmpty() ? "Toque para atualizar." : notes)
                .setStyle(new Notification.BigTextStyle().bigText((notes.isEmpty() ? "" : notes + "\n") + "Toque para atualizar."))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        nm.notify(7700, n);
    }

    /** Baixa e instala. */
    static void start(final Activity a) {
        if (latest == null || "downloading".equals(state) || "installing".equals(state)) return;
        if (pending != null && pending.exists()) { install(a, pending); return; }
        state = "downloading";
        progress = 0;
        error = "";
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    String url = latest.optString("url", "krata.apk");
                    if (!url.startsWith("https://")) url = MainActivity.APP_URL + url.replaceFirst("^/", "");
                    HttpURLConnection con = (HttpURLConnection) new URL(url + (url.contains("?") ? "&" : "?") + "v=" + latest.optInt("versionCode")).openConnection();
                    con.setConnectTimeout(10000);
                    con.setReadTimeout(20000);
                    if (con.getResponseCode() != 200) throw new IllegalStateException("O site respondeu " + con.getResponseCode());
                    long total = con.getContentLength() > 0 ? con.getContentLength() : latest.optLong("size", 0);
                    File f = new File(a.getCacheDir(), "krata-update.apk");
                    InputStream in = con.getInputStream();
                    OutputStream out = new FileOutputStream(f);
                    MessageDigest sha = MessageDigest.getInstance("SHA-256");
                    byte[] buf = new byte[65536];
                    long got = 0;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        sha.update(buf, 0, n);
                        got += n;
                        if (total > 0) progress = (int) Math.min(100, got * 100 / total);
                    }
                    out.close();
                    in.close();
                    con.disconnect();
                    String expect = latest.optString("sha256", "");
                    if (!expect.isEmpty() && !expect.equalsIgnoreCase(hex(sha.digest()))) throw new IllegalStateException("O arquivo veio corrompido. Tente de novo.");
                    progress = 100;
                    pending = f;
                    a.runOnUiThread(new Runnable() { @Override public void run() { install(a, pending); } });
                } catch (Throwable t) {
                    state = "error";
                    error = t.getMessage() == null ? "Não deu para baixar a atualização." : t.getMessage();
                }
            }
        }).start();
    }

    /** Chamado de novo quando a pessoa volta das configurações (permissão de instalar). */
    static void resume(Activity a) {
        if ("permission".equals(state) && pending != null && a.getPackageManager().canRequestPackageInstalls()) install(a, pending);
    }

    private static void install(final Activity a, final File f) {
        if (!a.getPackageManager().canRequestPackageInstalls()) {
            // uma vez só: o Android pede para liberar "instalar apps desta fonte" para o Krata
            state = "permission";
            try { a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName()))); } catch (Throwable ignored) {}
            return;
        }
        state = "installing";
        new Thread(new Runnable() {
            @Override public void run() {
                PackageInstaller.Session session = null;
                try {
                    PackageInstaller pi = a.getPackageManager().getPackageInstaller();
                    PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                    p.setAppPackageName(a.getPackageName());
                    p.setSize(f.length());
                    int id = pi.createSession(p);
                    session = pi.openSession(id);
                    OutputStream out = session.openWrite("krata", 0, f.length());
                    InputStream in = new FileInputStream(f);
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    session.fsync(out);
                    in.close();
                    out.close();
                    Intent done = new Intent(a, InstallReceiver.class).setAction("app.krata.INSTALLED");
                    int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                    session.commit(PendingIntent.getBroadcast(a, 78, done, flags).getIntentSender());
                    session.close();
                } catch (Throwable t) {
                    if (session != null) try { session.abandon(); } catch (Throwable ignored) {}
                    state = "error";
                    error = "Não deu para abrir a instalação. " + (t.getMessage() == null ? "" : t.getMessage());
                }
            }
        }).start();
    }

    private static String hex(byte[] b) {
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x & 0xff));
        return s.toString();
    }
}
