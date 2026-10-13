package app.krata;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

/** Plano B: a cada ~15 minutos o Android acorda o Krata para buscar mensagens (mesmo se a conexão caiu). */
public class SyncJob extends JobService {
    private static final int JOB_ID = 4201;

    static void schedule(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js == null || js.getPendingJob(JOB_ID) != null) return;
        // (também confere atualização do app de tempos em tempos)
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(c, SyncJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(15 * 60 * 1000L)
                .setPersisted(true)
                .build();
        try { js.schedule(job); } catch (Throwable ignored) {}
    }

    static void cancel(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js != null) js.cancel(JOB_ID);
    }

    @Override
    public boolean onStartJob(final JobParameters params) {
        new Thread(new Runnable() {
            @Override public void run() {
                if (!MainActivity.visible) Inbox.sync(SyncJob.this);
                Updater.checkQuietly(SyncJob.this);
                SyncService.start(SyncJob.this);
                SyncAlarm.schedule(SyncJob.this, SyncAlarm.interval(SyncJob.this)); // reacende o despertador se ele parou
                jobFinished(params, false);
            }
        }).start();
        return true;
    }

    @Override public boolean onStopJob(JobParameters params) { return true; }
}
