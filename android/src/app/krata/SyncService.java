package app.krata;

import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.IBinder;

/**
 * Antes era uma conexão em primeiro plano, com o aviso fixo "Krata conectado" na barra.
 * Agora quem confere as mensagens é o despertador ({@link SyncAlarm}), sem aviso nenhum:
 * esta classe só existe para desligar o serviço antigo e apagar aquele aviso.
 */
public class SyncService extends Service {
    static final String CH_SYNC = "krata_sync";
    static volatile boolean alive = false;

    /** Garante a conferência em segundo plano (pelo despertador) e some com o aviso antigo. */
    static void start(Context c) {
        cleanup(c);
        if (Inbox.configured(c)) SyncAlarm.schedule(c, SyncAlarm.interval(c));
    }

    static void stop(Context c) {
        try { c.stopService(new Intent(c, SyncService.class)); } catch (Throwable ignored) {}
    }

    /** Para o serviço antigo (se ainda estiver rodando) e apaga o canal "Conexão em segundo plano". */
    static void cleanup(Context c) {
        stop(c);
        try {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            nm.cancel(8);
            if (nm.getNotificationChannel(CH_SYNC) != null) nm.deleteNotificationChannel(CH_SYNC);
        } catch (Throwable ignored) {}
    }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        stopSelf();
        return START_NOT_STICKY;
    }
}
