package app.krata;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Conexão leve em segundo plano: pergunta por mensagens novas a cada poucos segundos
 * enquanto o app não está na tela (com ele aberto, o próprio site avisa na hora).
 */
public class SyncService extends Service {
    static final String CH_SYNC = "krata_sync";
    private static final int ID = 8;
    private HandlerThread thread;
    private Handler handler;
    private ConnectivityManager.NetworkCallback netCallback;
    private volatile boolean running;
    static volatile boolean alive = false;

    static void start(Context c) {
        if (!Inbox.configured(c) || !Inbox.liveSync(c)) return;
        try {
            Intent i = new Intent(c, SyncService.class);
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (Throwable ignored) { /* Android não deixou agora (app em segundo plano): o agendamento tenta depois */ }
    }

    static void stop(Context c) { c.stopService(new Intent(c, SyncService.class)); }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!Inbox.configured(this) || !Inbox.liveSync(this)) { stopSelf(); return START_NOT_STICKY; }
        if (!foreground()) { stopSelf(); return START_NOT_STICKY; }
        SyncAlarm.schedule(this, SyncAlarm.interval(this));
        alive = true;
        if (!running) {
            running = true;
            thread = new HandlerThread("krata-sync");
            thread.start();
            handler = new Handler(thread.getLooper());
            handler.post(loop);
            try {
                netCallback = new ConnectivityManager.NetworkCallback() {
                    @Override public void onAvailable(Network n) { if (handler != null) { handler.removeCallbacks(loop); handler.postDelayed(loop, 1500); } }
                };
                getSystemService(ConnectivityManager.class).registerDefaultNetworkCallback(netCallback);
            } catch (Throwable ignored) {}
        }
        return START_STICKY;
    }

    private final Runnable loop = new Runnable() {
        @Override public void run() {
            if (!running) return;
            boolean ok = true;
            PowerManager pm = getSystemService(PowerManager.class);
            PowerManager.WakeLock wl = pm == null ? null : pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "krata:loop");
            try {
                if (wl != null) wl.acquire(20_000L);
                if (!MainActivity.visible) ok = Inbox.sync(SyncService.this);
            } finally {
                if (wl != null && wl.isHeld()) wl.release();
            }
            if (!ok || !Inbox.configured(SyncService.this)) { SyncAlarm.cancel(SyncService.this); stopSelf(); return; }
            boolean on = pm != null && pm.isInteractive();
            // tela acesa: a cada 8 s; apagada, o despertador (SyncAlarm) acorda o celular e confere
            if (handler != null) handler.postDelayed(this, on ? 8_000L : 30_000L);
        }
    };

    private boolean foreground() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CH_SYNC) == null) {
            NotificationChannel ch = new NotificationChannel(CH_SYNC, "Conexão em segundo plano", NotificationManager.IMPORTANCE_MIN);
            ch.setDescription("Mantém o Krata conectado para as mensagens chegarem na hora. Pode esconder este aviso: a conexão continua.");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Notification n = new Notification.Builder(this, CH_SYNC)
                .setSmallIcon(R.drawable.ic_stat)
                .setColor(0xFF00A86B)
                .setContentTitle("Krata conectado")
                .setContentText("Você recebe as mensagens na hora.")
                .setContentIntent(Notifier.openIntent(this, "", ""))
                .setOngoing(true)
                .setShowWhen(false)
                .build();
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
            else if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(ID, n);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    /** Tiraram o Krata da lista de apps recentes: o despertador continua conferindo. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        SyncAlarm.schedule(this, 5_000L);
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        running = false;
        alive = false;
        try { if (netCallback != null) getSystemService(ConnectivityManager.class).unregisterNetworkCallback(netCallback); } catch (Throwable ignored) {}
        if (thread != null) thread.quitSafely();
        handler = null;
        super.onDestroy();
    }
}
