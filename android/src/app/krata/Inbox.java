package app.krata;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Caixa de entrada do aparelho: guarda a chave do aparelho, pergunta ao Supabase se chegou
 * mensagem nova e entrega para o {@link Notifier}. Funciona com o app fechado.
 */
final class Inbox {
    private Inbox() {}

    private static final String PREFS = "krata_inbox";
    private static final Object SYNC_LOCK = new Object();

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static boolean configured(Context c) { return prefs(c).getString("secret", null) != null; }

    static boolean liveSync(Context c) { return prefs(c).getBoolean("live", true); }

    static void setLiveSync(Context c, boolean on) { prefs(c).edit().putBoolean("live", on).apply(); }

    static void configure(Context c, JSONObject cfg) {
        SharedPreferences p = prefs(c);
        String secret = cfg.optString("secret", "");
        if (secret.isEmpty()) return;
        SharedPreferences.Editor e = p.edit();
        if (!secret.equals(p.getString("secret", null))) {
            // conta nova neste aparelho: começa a contar a partir de agora
            e.putString("cursor", iso(new Date(System.currentTimeMillis() - 60_000L)));
            e.remove("seen");
        }
        e.putString("url", cfg.optString("url", ""))
         .putString("key", cfg.optString("key", ""))
         .putString("secret", secret)
         .putString("user", cfg.optString("userId", ""))
         .putString("username", cfg.optString("username", ""))
         .putString("name", cfg.optString("name", ""))
         .apply();
    }

    static void clear(Context c) {
        prefs(c).edit().remove("secret").remove("cursor").remove("seen").remove("user").remove("username").apply();
        Notifier.cancelAll(c);
    }

    // ------------------------------------------------------------------ mensagens já avisadas
    static boolean markSeen(Context c, String id) {
        synchronized (SYNC_LOCK) {
            SharedPreferences p = prefs(c);
            String seen = p.getString("seen", "");
            if (seen.contains(id)) return false;
            String next = id + "," + seen;
            if (next.length() > 37 * 300) next = next.substring(0, 37 * 300);
            p.edit().putString("seen", next).apply();
            return true;
        }
    }

    // ------------------------------------------------------------------ busca
    /** Busca mensagens novas e mostra as notificações. Devolve false se a chave foi revogada. */
    static boolean sync(Context c) {
        synchronized (SYNC_LOCK) {
            SharedPreferences p = prefs(c);
            String secret = p.getString("secret", null);
            if (secret == null) return true;
            try {
                JSONObject body = new JSONObject();
                body.put("p_secret", secret);
                body.put("p_after", p.getString("cursor", iso(new Date(System.currentTimeMillis() - 600_000L))));
                String res = rpc(c, "device_inbox", body);
                JSONObject out = new JSONObject(res);
                JSONArray list = out.optJSONArray("messages");
                if (list != null) {
                    for (int i = 0; i < list.length(); i++) {
                        JSONObject m = list.getJSONObject(i);
                        if (markSeen(c, m.optString("id"))) Notifier.show(c, m, false);
                    }
                }
                // volta 30 s para não perder mensagem gravada "no meio" de uma busca (as repetidas são ignoradas)
                String now = out.optString("now", null);
                if (now != null) {
                    Date d = parse(now);
                    if (d != null) p.edit().putString("cursor", iso(new Date(d.getTime() - 30_000L))).apply();
                }
                return true;
            } catch (RevokedException e) {
                clear(c);
                return false;
            } catch (Throwable t) {
                return true; // sem rede: tenta na próxima
            }
        }
    }

    static void reply(Context c, String channelId, String text) throws Exception {
        JSONObject body = new JSONObject();
        body.put("p_secret", prefs(c).getString("secret", ""));
        body.put("p_channel", channelId);
        body.put("p_content", text);
        rpc(c, "device_reply", body);
    }

    static void markRead(Context c, String channelId) throws Exception {
        JSONObject body = new JSONObject();
        body.put("p_secret", prefs(c).getString("secret", ""));
        body.put("p_channel", channelId);
        rpc(c, "device_mark_read", body);
    }

    static final class RevokedException extends Exception {}

    private static String rpc(Context c, String fn, JSONObject body) throws Exception {
        SharedPreferences p = prefs(c);
        String base = p.getString("url", "");
        String key = p.getString("key", "");
        if (base.isEmpty()) throw new IllegalStateException("sem endereço");
        HttpURLConnection con = (HttpURLConnection) new URL(base + "/rest/v1/rpc/" + fn).openConnection();
        con.setConnectTimeout(10_000);
        con.setReadTimeout(15_000);
        con.setRequestMethod("POST");
        con.setDoOutput(true);
        con.setRequestProperty("content-type", "application/json");
        con.setRequestProperty("apikey", key);
        if (key.startsWith("eyJ")) con.setRequestProperty("authorization", "Bearer " + key);
        OutputStream os = con.getOutputStream();
        os.write(body.toString().getBytes("UTF-8"));
        os.close();
        int code = con.getResponseCode();
        InputStream in = code >= 400 ? con.getErrorStream() : con.getInputStream();
        String text = in == null ? "" : read(in);
        con.disconnect();
        if (code >= 400) {
            if (text.contains("device_revoked")) throw new RevokedException();
            throw new IllegalStateException("http " + code);
        }
        return text;
    }

    static String read(InputStream in) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        in.close();
        return b.toString("UTF-8");
    }

    static String iso(Date d) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(d);
    }

    /** Lê datas do Postgres/JS ("2026-10-12T16:20:01.123456+00:00" ou "...Z"). */
    static Date parse(String s) {
        try {
            String t = s.trim().replace(' ', 'T');
            String zone = "+0000";
            if (t.endsWith("Z")) t = t.substring(0, t.length() - 1);
            else {
                int plus = Math.max(t.lastIndexOf('+'), t.lastIndexOf('-'));
                if (plus > 10) { zone = t.substring(plus).replace(":", ""); t = t.substring(0, plus); }
            }
            int dot = t.indexOf('.');
            String frac = "000";
            if (dot > 0) { frac = (t.substring(dot + 1) + "000").substring(0, 3); t = t.substring(0, dot); }
            if (zone.length() == 3) zone = zone + "00";
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.US);
            return f.parse(t + "." + frac + zone);
        } catch (Exception e) {
            return null;
        }
    }
}
