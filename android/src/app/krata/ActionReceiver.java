package app.krata;

import android.app.RemoteInput;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import org.json.JSONObject;

/** Botões das notificações: responder e marcar como lida (funcionam com o app fechado). */
public class ActionReceiver extends BroadcastReceiver {
    static final String REPLY = "app.krata.REPLY";
    static final String READ = "app.krata.READ";

    @Override
    public void onReceive(final Context context, final Intent intent) {
        final String channel = intent.getStringExtra("channel");
        if (channel == null) return;
        final Context c = context.getApplicationContext();
        final PendingResult pending = goAsync();
        if (REPLY.equals(intent.getAction())) {
            Bundle results = RemoteInput.getResultsFromIntent(intent);
            final CharSequence text = results != null ? results.getCharSequence(Notifier.KEY_REPLY) : null;
            if (text == null || text.toString().trim().isEmpty()) { pending.finish(); return; }
            new Thread(new Runnable() {
                @Override public void run() {
                    try {
                        Inbox.reply(c, channel, text.toString().trim());
                        // mostra a resposta na própria notificação (sem tocar de novo)
                        JSONObject me = new JSONObject();
                        me.put("id", "reply-" + System.currentTimeMillis());
                        me.put("channel_id", channel);
                        me.put("server_id", intent.getStringExtra("server"));
                        me.put("content", text.toString().trim());
                        me.put("mine", true);
                        me.put("created_at", Inbox.iso(new java.util.Date()));
                        Notifier.showReply(c, me);
                    } catch (Throwable t) {
                        Notifier.replyFailed(c, channel);
                    } finally {
                        pending.finish();
                    }
                }
            }).start();
        } else if (READ.equals(intent.getAction())) {
            Notifier.clearChannel(c, channel);
            new Thread(new Runnable() {
                @Override public void run() {
                    try { Inbox.markRead(c, channel); } catch (Throwable ignored) {} finally { pending.finish(); }
                }
            }).start();
        } else pending.finish();
    }
}
