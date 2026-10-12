package app.krata;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationChannelGroup;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Person;
import android.app.RemoteInput;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.Icon;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.StyleSpan;
import android.util.LruCache;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Notificações de mensagem bonitas: foto da pessoa, nome, conversa, resposta rápida e "marcar como lida". */
final class Notifier {
    private Notifier() {}

    static final String CH_DM = "krata_dm";
    static final String CH_MENTION = "krata_mention";
    static final String GROUP = "krata_messages";
    static final int SUMMARY_ID = 9000;
    static final String KEY_REPLY = "krata_reply";
    private static final int JADE = 0xFF00A86B;
    private static final int MAX_HISTORY = 7;
    private static final LruCache<String, Bitmap> cache = new LruCache<String, Bitmap>(40);

    static void channels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CH_DM) != null) return;
        nm.createNotificationChannelGroup(new NotificationChannelGroup("krata_msgs", "Mensagens"));
        AudioAttributes aa = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_INSTANT).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        NotificationChannel dm = new NotificationChannel(CH_DM, "Conversas privadas e grupos", NotificationManager.IMPORTANCE_HIGH);
        dm.setDescription("Mensagens que chegam para você em conversas privadas e grupos.");
        dm.setGroup("krata_msgs");
        dm.enableLights(true); dm.setLightColor(JADE);
        dm.enableVibration(true); dm.setVibrationPattern(new long[] { 0, 90, 60, 140 });
        dm.setSound(sound, aa);
        dm.setShowBadge(true);
        NotificationChannel mention = new NotificationChannel(CH_MENTION, "Menções em servidores", NotificationManager.IMPORTANCE_HIGH);
        mention.setDescription("Quando alguém te marca com @ (ou @todos) num servidor.");
        mention.setGroup("krata_msgs");
        mention.enableLights(true); mention.setLightColor(JADE);
        mention.enableVibration(true); mention.setVibrationPattern(new long[] { 0, 60, 50, 60, 50, 120 });
        mention.setSound(sound, aa);
        nm.createNotificationChannel(dm);
        nm.createNotificationChannel(mention);
    }

    static int idFor(String channelId) { return 1000 + (channelId.hashCode() & 0x7ffffff); }

    // ------------------------------------------------------------------ histórico por conversa
    private static SharedPreferences hist(Context c) { return c.getSharedPreferences("krata_notif_hist", Context.MODE_PRIVATE); }

    private static JSONArray history(Context c, String channelId) {
        try { return new JSONArray(hist(c).getString(channelId, "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    private static void saveHistory(Context c, String channelId, JSONArray arr) {
        JSONArray trimmed = new JSONArray();
        int start = Math.max(0, arr.length() - MAX_HISTORY);
        for (int i = start; i < arr.length(); i++) trimmed.put(arr.opt(i));
        hist(c).edit().putString(channelId, trimmed.toString()).apply();
    }

    /** Mostra a resposta enviada pela própria notificação. */
    static void showReply(Context c, JSONObject reply) {
        try {
            String channelId = reply.optString("channel_id");
            JSONObject meta = new JSONObject(hist(c).getString("m:" + channelId, "{}"));
            meta.put("id", reply.optString("id"));
            meta.put("channel_id", channelId);
            meta.put("content", reply.optString("content"));
            meta.put("created_at", reply.optString("created_at"));
            meta.put("mine", true);
            show(c, meta, true);
        } catch (Throwable ignored) {}
    }

    static void replyFailed(Context c, String channelId) {
        try {
            JSONObject meta = new JSONObject(hist(c).getString("m:" + channelId, "{}"));
            meta.put("id", "err-" + System.currentTimeMillis());
            meta.put("channel_id", channelId);
            meta.put("entry_author", "Krata");
            meta.put("entry_username", "krata");
            meta.put("content", "Não deu para enviar sua resposta. Abra o app e tente de novo.");
            meta.put("created_at", Inbox.iso(new java.util.Date()));
            show(c, meta, true);
        } catch (Throwable ignored) {}
    }

    static void clearChannel(Context c, String channelId) {
        c.getSystemService(NotificationManager.class).cancel(idFor(channelId));
        hist(c).edit().remove(channelId).apply();
        updateSummary(c);
    }

    static void cancelAll(Context c) {
        c.getSystemService(NotificationManager.class).cancelAll();
        hist(c).edit().clear().apply();
    }

    /** Mostra (ou atualiza) a notificação da conversa com a mensagem nova. */
    static synchronized void show(Context c, JSONObject m, boolean silent) {
        try {
            channels(c);
            String channelId = m.optString("channel_id");
            JSONArray h = history(c, channelId);
            if (!silent || m.optBoolean("mine") || m.optString("id").startsWith("err-")) {
                JSONObject entry = new JSONObject();
                entry.put("id", m.optString("id"));
                entry.put("author", m.optString("entry_author", m.optString("author", "Alguém")));
                entry.put("username", m.optString("entry_username", m.optString("author_username", "")));
                entry.put("avatar", m.has("entry_author") ? "" : m.optString("author_avatar", ""));
                entry.put("color", m.optString("author_color", ""));
                entry.put("text", text(m));
                entry.put("at", time(m));
                entry.put("mine", m.optBoolean("mine", false));
                h.put(entry);
                saveHistory(c, channelId, h);
                h = history(c, channelId);
            }
            if (!m.optBoolean("mine") && !m.optString("id").startsWith("err-")) {
                JSONObject meta = new JSONObject(m.toString());
                meta.remove("content");
                hist(c).edit().putString("m:" + channelId, meta.toString()).apply();
            }
            build(c, m, h, silent);
            updateSummary(c);
        } catch (Throwable ignored) {}
    }

    private static long time(JSONObject m) {
        java.util.Date d = Inbox.parse(m.optString("created_at", ""));
        return d != null ? d.getTime() : System.currentTimeMillis();
    }

    private static final Pattern EMOJI = Pattern.compile("<:([a-z0-9_]+):[0-9a-f-]+>");

    private static CharSequence text(JSONObject m) {
        String t = m.optString("content", "").trim();
        t = EMOJI.matcher(t).replaceAll(":$1:").replaceAll("\\*\\*|__|~~|`{1,3}", "").replaceAll("\\|\\|(.+?)\\|\\|", "▒▒▒");
        int files = m.optInt("files", 0);
        if (t.isEmpty()) return files > 1 ? "📎 Enviou " + files + " arquivos" : "📎 Enviou um arquivo";
        if (files > 0) t = t + "  📎";
        return t;
    }

    private static void build(Context c, JSONObject m, JSONArray h, boolean silent) throws Exception {
        String channelId = m.optString("channel_id");
        String serverId = m.optString("server_id", "");
        if ("null".equals(serverId)) serverId = "";
        String kind = m.optString("kind", "dm");
        boolean server = !serverId.isEmpty();
        boolean group = server || "group".equals(kind) || m.optInt("members", 0) > 2;
        String me = Inbox.prefs(c).getString("username", "");
        String myName = Inbox.prefs(c).getString("name", "Você");
        String title = server
                ? "#" + m.optString("channel_name", "canal") + " · " + m.optString("server_name", "Servidor")
                : group ? m.optString("channel_name", "Grupo") : m.optString("author", "Conversa");

        Notification.Builder b = new Notification.Builder(c, server ? CH_MENTION : CH_DM)
                .setSmallIcon(R.drawable.ic_stat)
                .setColor(JADE)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setShowWhen(true)
                .setWhen(time(m))
                .setGroup(GROUP)
                .setOnlyAlertOnce(silent)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setContentIntent(openIntent(c, serverId, channelId));
        if (silent) b.setGroupAlertBehavior(Notification.GROUP_ALERT_SUMMARY);

        Bitmap avatar = avatar(c, m.optString("author_avatar", ""), m.optString("author", "?"), m.optString("author_color", ""));
        Bitmap largeIcon = server ? squareIcon(c, m.optString("server_icon", ""), m.optString("server_name", "S")) : group ? null : avatar;

        if (Build.VERSION.SDK_INT >= 28) {
            Person self = new Person.Builder().setName(myName.isEmpty() ? "Você" : myName).setKey("me").build();
            Notification.MessagingStyle style = new Notification.MessagingStyle(self);
            if (group) style.setConversationTitle(title);
            style.setGroupConversation(group);
            for (int i = 0; i < h.length(); i++) {
                JSONObject e = h.getJSONObject(i);
                Person who = null;
                if (!e.optBoolean("mine")) {
                    Bitmap av = avatar(c, e.optString("avatar", ""), e.optString("author", "?"), e.optString("color", ""));
                    who = new Person.Builder().setName(e.optString("author", "Alguém")).setKey(e.optString("username", e.optString("author")))
                            .setIcon(Icon.createWithBitmap(av)).build();
                }
                style.addMessage(new Notification.MessagingStyle.Message(highlight(e.optString("text"), me), e.optLong("at"), who));
            }
            b.setStyle(style);
            String shortcut = pushShortcut(c, channelId, serverId, title, server ? largeIcon : avatar, group);
            if (shortcut != null) b.setShortcutId(shortcut);
        } else {
            Notification.MessagingStyle style = new Notification.MessagingStyle(myName.isEmpty() ? "Você" : myName);
            if (group) style.setConversationTitle(title);
            for (int i = 0; i < h.length(); i++) {
                JSONObject e = h.getJSONObject(i);
                style.addMessage(highlight(e.optString("text"), me), e.optLong("at"), e.optBoolean("mine") ? null : e.optString("author"));
            }
            b.setStyle(style);
        }
        if (largeIcon != null) b.setLargeIcon(largeIcon);
        b.setContentTitle(title).setContentText(text(m));
        if (h.length() > 1) b.setNumber(h.length());

        // responder direto da notificação
        RemoteInput input = new RemoteInput.Builder(KEY_REPLY).setLabel(group ? "Responder em " + title : "Responder para " + m.optString("author", "")).build();
        Intent reply = new Intent(c, ActionReceiver.class).setAction(ActionReceiver.REPLY).putExtra("channel", channelId).putExtra("server", serverId);
        int mutable = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        PendingIntent replyPi = PendingIntent.getBroadcast(c, idFor(channelId), reply, PendingIntent.FLAG_UPDATE_CURRENT | mutable);
        Notification.Action.Builder replyAction = new Notification.Action.Builder(Icon.createWithResource(c, R.drawable.ic_reply), "Responder", replyPi).addRemoteInput(input);
        if (Build.VERSION.SDK_INT >= 28) replyAction.setSemanticAction(Notification.Action.SEMANTIC_ACTION_REPLY);
        replyAction.setAllowGeneratedReplies(true);
        b.addAction(replyAction.build());

        Intent read = new Intent(c, ActionReceiver.class).setAction(ActionReceiver.READ).putExtra("channel", channelId);
        PendingIntent readPi = PendingIntent.getBroadcast(c, idFor(channelId) + 1, read, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Action.Builder readAction = new Notification.Action.Builder(Icon.createWithResource(c, R.drawable.ic_check), "Marcar como lida", readPi);
        if (Build.VERSION.SDK_INT >= 28) readAction.setSemanticAction(Notification.Action.SEMANTIC_ACTION_MARK_AS_READ);
        b.addAction(readAction.build());

        c.getSystemService(NotificationManager.class).notify(idFor(channelId), b.build());
    }

    /** Resumo que agrupa várias conversas ("3 conversas novas"). */
    private static void updateSummary(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        int count = 0;
        Notification.InboxStyle inbox = new Notification.InboxStyle();
        for (android.service.notification.StatusBarNotification s : nm.getActiveNotifications()) {
            if (s.getId() == SUMMARY_ID || !GROUP.equals(s.getNotification().getGroup())) continue;
            count++;
            CharSequence t = s.getNotification().extras.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence x = s.getNotification().extras.getCharSequence(Notification.EXTRA_TEXT);
            if (t != null) inbox.addLine(bold(t + "  ", x == null ? "" : x));
        }
        if (count < 2) { nm.cancel(SUMMARY_ID); return; }
        inbox.setSummaryText(count + " conversas");
        Notification summary = new Notification.Builder(c, CH_DM)
                .setSmallIcon(R.drawable.ic_stat)
                .setColor(JADE)
                .setContentTitle("Krata")
                .setContentText(count + " conversas com mensagens novas")
                .setStyle(inbox)
                .setGroup(GROUP)
                .setGroupSummary(true)
                .setGroupAlertBehavior(Notification.GROUP_ALERT_CHILDREN)
                .setAutoCancel(true)
                .setContentIntent(openIntent(c, "", ""))
                .build();
        nm.notify(SUMMARY_ID, summary);
    }

    private static CharSequence bold(String a, CharSequence b) {
        SpannableString s = new SpannableString(a + b);
        s.setSpan(new StyleSpan(Typeface.BOLD), 0, a.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return s;
    }

    /** Deixa "@você" e "@todos" em destaque. */
    private static CharSequence highlight(String text, String me) {
        SpannableString s = new SpannableString(text);
        if (me == null || me.isEmpty()) return s;
        Matcher mt = Pattern.compile("@(" + Pattern.quote(me) + "|todos)(?![a-z0-9_.])", Pattern.CASE_INSENSITIVE).matcher(text);
        while (mt.find()) {
            s.setSpan(new StyleSpan(Typeface.BOLD), mt.start(), mt.end(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            s.setSpan(new ForegroundColorSpan(0xFF3DDBA4), mt.start(), mt.end(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        return s;
    }

    static PendingIntent openIntent(Context c, String serverId, String channelId) {
        Intent i = new Intent(c, MainActivity.class)
                .setAction("app.krata.OPEN_" + channelId)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra("channel", channelId).putExtra("server", serverId);
        return PendingIntent.getActivity(c, channelId.isEmpty() ? 0 : idFor(channelId), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Atalho de conversa: no Android 11+ a notificação vai para a seção "Conversas", com a foto grande. */
    private static String pushShortcut(Context c, String channelId, String serverId, String title, Bitmap icon, boolean group) {
        if (Build.VERSION.SDK_INT < 30) return null;
        try {
            ShortcutManager sm = c.getSystemService(ShortcutManager.class);
            Intent open = new Intent(c, MainActivity.class).setAction(Intent.ACTION_VIEW).putExtra("channel", channelId).putExtra("server", serverId);
            ShortcutInfo.Builder sb = new ShortcutInfo.Builder(c, "ch_" + channelId)
                    .setShortLabel(title.length() > 24 ? title.substring(0, 24) : title)
                    .setLongLabel(title)
                    .setLongLived(true)
                    .setIntent(open)
                    .setCategories(Collections.singleton("app.krata.category.CONVERSATION"));
            if (icon != null) sb.setIcon(Icon.createWithAdaptiveBitmap(adaptive(icon)));
            if (!group) sb.setPerson(new Person.Builder().setName(title).setKey(channelId).build());
            sm.pushDynamicShortcut(sb.build());
            return "ch_" + channelId;
        } catch (Throwable t) {
            return null;
        }
    }

    // ------------------------------------------------------------------ imagens
    static Bitmap avatar(Context c, String url, String name, String color) {
        Bitmap src = url == null || url.isEmpty() || "null".equals(url) ? null : download(c, url);
        int size = 192;
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(out);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        if (src != null) {
            Bitmap sq = centerCrop(src, size);
            p.setShader(new BitmapShader(sq, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
            cv.drawCircle(size / 2f, size / 2f, size / 2f, p);
            return out;
        }
        // sem foto: inicial sobre um degradê na cor do perfil
        int base = JADE;
        try { if (color != null && color.startsWith("#") && color.length() == 7) base = Color.parseColor(color); } catch (Exception ignored) {}
        p.setShader(new LinearGradient(0, 0, size, size, lighten(base, 0.25f), darken(base, 0.35f), Shader.TileMode.CLAMP));
        cv.drawCircle(size / 2f, size / 2f, size / 2f, p);
        Paint t = new Paint(Paint.ANTI_ALIAS_FLAG);
        t.setColor(Color.WHITE);
        t.setTextSize(size * 0.42f);
        t.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        t.setTextAlign(Paint.Align.CENTER);
        String initial = name == null || name.isEmpty() ? "?" : name.substring(0, name.offsetByCodePoints(0, 1)).toUpperCase(Locale.ROOT);
        Paint.FontMetrics fm = t.getFontMetrics();
        cv.drawText(initial, size / 2f, size / 2f - (fm.ascent + fm.descent) / 2f, t);
        return out;
    }

    private static Bitmap squareIcon(Context c, String url, String name) {
        Bitmap src = url == null || url.isEmpty() || "null".equals(url) ? null : download(c, url);
        int size = 192;
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(out);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        RectF r = new RectF(0, 0, size, size);
        if (src != null) p.setShader(new BitmapShader(centerCrop(src, size), Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
        else p.setShader(new LinearGradient(0, 0, size, size, 0xFF1D4A3A, 0xFF050706, Shader.TileMode.CLAMP));
        cv.drawRoundRect(r, size * 0.28f, size * 0.28f, p);
        if (src == null) {
            Paint t = new Paint(Paint.ANTI_ALIAS_FLAG);
            t.setColor(0xFF3DDBA4);
            t.setTextSize(size * 0.38f);
            t.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
            t.setTextAlign(Paint.Align.CENTER);
            String[] words = name.trim().split("\\s+");
            String ini = words.length > 1 ? words[0].substring(0, 1) + words[1].substring(0, 1) : name.substring(0, Math.min(2, name.length()));
            Paint.FontMetrics fm = t.getFontMetrics();
            cv.drawText(ini.toUpperCase(Locale.ROOT), size / 2f, size / 2f - (fm.ascent + fm.descent) / 2f, t);
        }
        return out;
    }

    private static Bitmap adaptive(Bitmap icon) {
        // ícones adaptativos usam só o miolo (66%): centraliza com margem
        int size = 216;
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(out);
        cv.drawColor(0xFF050706);
        int inner = (int) (size * 0.62f), off = (size - inner) / 2;
        cv.drawBitmap(Bitmap.createScaledBitmap(icon, inner, inner, true), off, off, new Paint(Paint.FILTER_BITMAP_FLAG));
        return out;
    }

    private static Bitmap centerCrop(Bitmap src, int size) {
        int w = src.getWidth(), h = src.getHeight(), s = Math.min(w, h);
        Bitmap sq = Bitmap.createBitmap(src, (w - s) / 2, (h - s) / 2, s, s);
        return Bitmap.createScaledBitmap(sq, size, size, true);
    }

    private static int lighten(int c, float f) {
        return Color.rgb((int) (Color.red(c) + (255 - Color.red(c)) * f), (int) (Color.green(c) + (255 - Color.green(c)) * f), (int) (Color.blue(c) + (255 - Color.blue(c)) * f));
    }

    private static int darken(int c, float f) {
        return Color.rgb((int) (Color.red(c) * (1 - f)), (int) (Color.green(c) * (1 - f)), (int) (Color.blue(c) * (1 - f)));
    }

    /** Baixa a foto (com cache em memória e em disco). */
    private static Bitmap download(Context c, String url) {
        Bitmap hit = cache.get(url);
        if (hit != null) return hit;
        File f = new File(c.getCacheDir(), "av_" + Integer.toHexString(url.hashCode()) + ".png");
        try {
            if (f.exists() && f.length() > 0 && System.currentTimeMillis() - f.lastModified() < 3L * 24 * 3600 * 1000) {
                Bitmap b = BitmapFactory.decodeFile(f.getAbsolutePath());
                if (b != null) { cache.put(url, b); return b; }
            }
            if (!url.startsWith("https://") && !url.startsWith("http://")) return null;
            HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
            con.setConnectTimeout(6000);
            con.setReadTimeout(8000);
            if (con.getResponseCode() != 200 || con.getContentLength() > 12 * 1024 * 1024) { con.disconnect(); return null; }
            InputStream in = con.getInputStream();
            byte[] data = readAll(in);
            con.disconnect();
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(data, 0, data.length, o);
            int sample = 1;
            while (Math.min(o.outWidth, o.outHeight) / (sample * 2) >= 192) sample *= 2;
            o = new BitmapFactory.Options();
            o.inSampleSize = sample;
            Bitmap b = BitmapFactory.decodeByteArray(data, 0, data.length, o); // GIF: primeiro quadro
            if (b == null) return null;
            Bitmap small = centerCrop(b, 192);
            FileOutputStream os = new FileOutputStream(f);
            small.compress(Bitmap.CompressFormat.PNG, 100, os);
            os.close();
            cache.put(url, small);
            return small;
        } catch (Throwable t) {
            return null;
        }
    }

    private static byte[] readAll(InputStream in) throws Exception {
        java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n, total = 0;
        while ((n = in.read(buf)) > 0) { b.write(buf, 0, n); total += n; if (total > 12 * 1024 * 1024) break; }
        in.close();
        return b.toByteArray();
    }
}
