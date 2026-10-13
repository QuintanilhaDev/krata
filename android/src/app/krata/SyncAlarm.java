package app.krata;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.PowerManager;
import android.os.SystemClock;

/**
 * Despertador das notificações: acorda o celular de tempos em tempos (mesmo com a tela
 * apagada e o Android em modo soneca) para conferir se chegou mensagem. É o que garante
 * que nenhuma mensagem privada ou menção fique sem aviso quando o sistema congela o app.
 */
public class SyncAlarm extends BroadcastReceiver {
    private static final int REQ = 4310;

    private static PendingIntent pi(Context c, int flags) {
        Intent i = new Intent(c, SyncAlarm.class).setAction("app.krata.SYNC");
        return PendingIntent.getBroadcast(c, REQ, i, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Agenda a próxima conferência (substitui a anterior). */
    static void schedule(Context c, long delayMs) {
        if (!Inbox.configured(c)) return;
        AlarmManager am = c.getSystemService(AlarmManager.class);
        if (am == null) return;
        PendingIntent p = pi(c, PendingIntent.FLAG_UPDATE_CURRENT);
        long at = SystemClock.elapsedRealtime() + delayMs;
        try {
            boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, p);
            else am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, p);
        } catch (Throwable t) {
            try { am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, p); } catch (Throwable ignored) {}
        }
    }

    static void cancel(Context c) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        if (am != null) am.cancel(pi(c, PendingIntent.FLAG_UPDATE_CURRENT));
    }

    /** Intervalo do despertador (com a tela acesa a conexão contínua já confere a cada 8 s). */
    static long interval(Context c) {
        // com a conexão contínua desligada, confere a cada 5 minutos
        return Inbox.liveSync(c) ? 30_000L : 5 * 60_000L;
    }

    @Override
    public void onReceive(final Context context, Intent intent) {
        final Context c = context.getApplicationContext();
        final PendingResult result = goAsync();
        PowerManager pm = c.getSystemService(PowerManager.class);
        final PowerManager.WakeLock wl = pm == null ? null : pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "krata:sync");
        if (wl != null) wl.acquire(25_000L);
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    boolean ok = true;
                    if (!MainActivity.visible) ok = Inbox.sync(c);
                    if (ok && Inbox.configured(c)) {
                        schedule(c, interval(c));
                        SyncService.start(c); // a conexão contínua volta se o sistema tinha fechado
                    }
                } catch (Throwable ignored) {
                    schedule(c, 60_000L);
                } finally {
                    if (wl != null && wl.isHeld()) wl.release();
                    result.finish();
                }
            }
        }).start();
    }
}
