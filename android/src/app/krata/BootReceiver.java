package app.krata;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Celular ligou (ou o app foi atualizado): volta a receber mensagens. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Inbox.configured(context)) return;
        SyncJob.schedule(context);
        SyncAlarm.schedule(context, 10_000L);
        SyncService.start(context);
    }
}
