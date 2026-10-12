package app.krata;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Process;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.WindowManager;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * Serviço em primeiro plano do Krata:
 * - mantém a chamada de voz viva com a tela apagada ou em outro app (tipo "microfone");
 * - captura a tela inteira (e o som do celular) para a transmissão (tipo "projeção de mídia").
 */
public class KrataService extends Service {
    static final String ACTION_CALL_ON = "app.krata.CALL_ON";
    static final String ACTION_CALL_OFF = "app.krata.CALL_OFF";
    static final String ACTION_SCREEN_START = "app.krata.SCREEN_START";
    static final String ACTION_SCREEN_STOP = "app.krata.SCREEN_STOP";
    private static final String CHANNEL = "krata_live";
    private static final int NOTIFICATION_ID = 7;

    private boolean inCall = false;
    private boolean sharing = false;

    private MediaProjection projection;
    private VirtualDisplay display;
    private ImageReader reader;
    private HandlerThread thread;
    private Handler handler;
    private AudioRecord audioRecord;
    private Thread audioThread;
    private volatile boolean audioRunning = false;
    private DisplayManager.DisplayListener displayListener;

    private int targetShort = 1080;
    private int fps = 30;
    private int width, height, dpi;
    private long lastFrameAt = 0;
    private Bitmap scratch;
    private final ByteArrayOutputStream jpeg = new ByteArrayOutputStream(512 * 1024);

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_CALL_ON.equals(action)) { inCall = true; updateForeground(); }
        else if (ACTION_CALL_OFF.equals(action)) { inCall = false; updateForeground(); }
        else if (ACTION_SCREEN_STOP.equals(action)) { stopCapture(); updateForeground(); }
        else if (ACTION_SCREEN_START.equals(action)) {
            int code = intent.getIntExtra("code", 0);
            Intent data = intent.getParcelableExtra("data");
            String quality = intent.getStringExtra("quality");
            fps = Math.max(5, Math.min(30, intent.getIntExtra("fps", 30)));
            boolean withAudio = intent.getBooleanExtra("audio", true);
            targetShort = qualityToShortEdge(quality);
            sharing = true;
            // no Android 14 o serviço precisa estar em primeiro plano ANTES de pegar a projeção
            if (!updateForeground()) { sharing = false; ScreenHub.setState("error"); return START_NOT_STICKY; }
            try {
                startCapture(code, data, withAudio);
                ScreenHub.setState("live");
            } catch (Throwable t) {
                stopCapture();
                ScreenHub.setState("error");
                updateForeground();
            }
        }
        if (!inCall && !sharing) stopSelf();
        return START_NOT_STICKY;
    }

    private static int qualityToShortEdge(String q) {
        if ("720".equals(q)) return 720;
        if ("1440".equals(q)) return 1440;
        if ("2160".equals(q)) return 2160;
        if ("source".equals(q)) return 100000;
        return 1080;
    }

    // ------------------------------------------------------------- notificação
    private boolean updateForeground() {
        if (!inCall && !sharing) {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
            return true;
        }
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Chamadas e transmissão", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Aparece enquanto você está numa chamada ou transmitindo a tela.");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(sharing ? "Transmitindo sua tela" : "Na chamada do Krata")
                .setContentText(sharing ? "Toque para voltar ao Krata." : "Sua voz continua conectada.")
                .setContentIntent(openPi)
                .setOngoing(true)
                .setColor(0xFF00A86B);
        if (sharing) {
            Intent stop = new Intent(this, KrataService.class).setAction(ACTION_SCREEN_STOP);
            PendingIntent stopPi = PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            b.addAction(new Notification.Action.Builder(null, "Parar transmissão", stopPi).build());
        }
        Notification n = b.build();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                int types = 0;
                if (sharing) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
                if (inCall && Build.VERSION.SDK_INT >= 30 && checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
                    types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
                if (types == 0) return false; // chamada sem microfone liberado: não precisa de serviço
                startForeground(NOTIFICATION_ID, n, types);
            } else {
                startForeground(NOTIFICATION_ID, n);
            }
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    // ------------------------------------------------------------- captura
    private void startCapture(int code, Intent data, boolean withAudio) {
        MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        projection = mpm.getMediaProjection(code, data);
        if (projection == null) throw new IllegalStateException("sem projeção");
        thread = new HandlerThread("krata-screen", Process.THREAD_PRIORITY_DISPLAY);
        thread.start();
        handler = new Handler(thread.getLooper());
        projection.registerCallback(new MediaProjection.Callback() {
            @Override public void onStop() {
                // o sistema (ou o usuário pela barra) encerrou a projeção
                stopCapture();
                updateForeground();
                if (!inCall) stopSelf();
            }
        }, handler);

        measure();
        reader = newReader();
        display = projection.createVirtualDisplay("krata", width, height, dpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.getSurface(), null, handler);

        // girou o celular: ajusta o tamanho da captura
        final DisplayManager dm = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
        displayListener = new DisplayManager.DisplayListener() {
            @Override public void onDisplayAdded(int id) {}
            @Override public void onDisplayRemoved(int id) {}
            @Override public void onDisplayChanged(int id) {
                if (id != Display.DEFAULT_DISPLAY || display == null) return;
                int ow = width, oh = height;
                measure();
                if (ow == width && oh == height) return;
                ImageReader old = reader;
                reader = newReader();
                display.resize(width, height, dpi);
                display.setSurface(reader.getSurface());
                if (old != null) old.close();
            }
        };
        dm.registerDisplayListener(displayListener, handler);

        if (withAudio && Build.VERSION.SDK_INT >= 30
                && checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            startAudio();
        }
    }

    private void measure() {
        WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        DisplayMetrics m = new DisplayMetrics();
        wm.getDefaultDisplay().getRealMetrics(m);
        int w = m.widthPixels, h = m.heightPixels;
        float scale = Math.min(1f, targetShort / (float) Math.min(w, h));
        width = Math.max(2, Math.round(w * scale) & ~1);
        height = Math.max(2, Math.round(h * scale) & ~1);
        dpi = Math.max(120, Math.round(m.densityDpi * scale));
    }

    private ImageReader newReader() {
        ImageReader r = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
        r.setOnImageAvailableListener(new ImageReader.OnImageAvailableListener() {
            @Override public void onImageAvailable(ImageReader ir) { onFrame(ir); }
        }, handler);
        return r;
    }

    private void onFrame(ImageReader ir) {
        Image image = null;
        try {
            image = ir.acquireLatestImage();
            if (image == null) return;
            long now = System.currentTimeMillis();
            if (now - lastFrameAt < 1000 / fps) return;
            lastFrameAt = now;
            Image.Plane plane = image.getPlanes()[0];
            ByteBuffer buf = plane.getBuffer();
            int pixelStride = plane.getPixelStride();
            int rowStride = plane.getRowStride();
            int w = image.getWidth(), h = image.getHeight();
            int padded = rowStride / pixelStride;
            if (scratch == null || scratch.getWidth() != padded || scratch.getHeight() != h) {
                if (scratch != null) scratch.recycle();
                scratch = Bitmap.createBitmap(padded, h, Bitmap.Config.ARGB_8888);
            }
            buf.rewind();
            scratch.copyPixelsFromBuffer(buf);
            Bitmap out = padded == w ? scratch : Bitmap.createBitmap(scratch, 0, 0, w, h);
            jpeg.reset();
            out.compress(Bitmap.CompressFormat.JPEG, Math.min(w, h) > 1100 ? 72 : 80, jpeg);
            if (out != scratch) out.recycle();
            ScreenHub.publishFrame(jpeg.toByteArray());
        } catch (Throwable ignored) {
        } finally {
            if (image != null) image.close();
        }
    }

    private void startAudio() {
        try {
            AudioPlaybackCaptureConfiguration cfg = new AudioPlaybackCaptureConfiguration.Builder(projection)
                    .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                    .addMatchingUsage(AudioAttributes.USAGE_GAME)
                    .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                    .excludeUid(Process.myUid()) // não manda de volta a voz de quem está na chamada
                    .build();
            AudioFormat fmt = new AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(48000)
                    .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
                    .build();
            int min = AudioRecord.getMinBufferSize(48000, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_16BIT);
            audioRecord = new AudioRecord.Builder()
                    .setAudioFormat(fmt)
                    .setBufferSizeInBytes(Math.max(min * 2, 48000))
                    .setAudioPlaybackCaptureConfig(cfg)
                    .build();
            audioRecord.startRecording();
            audioRunning = true;
            audioThread = new Thread(new Runnable() {
                @Override public void run() {
                    byte[] b = new byte[3840]; // 20 ms
                    while (audioRunning) {
                        int n = audioRecord.read(b, 0, b.length);
                        if (n > 0) ScreenHub.pushAudio(b, n);
                        else if (n < 0) break;
                    }
                }
            }, "krata-audio");
            audioThread.start();
        } catch (Throwable t) {
            audioRunning = false;
            audioRecord = null; // segue só com vídeo
        }
    }

    private void stopCapture() {
        sharing = false;
        audioRunning = false;
        try { if (audioRecord != null) { audioRecord.stop(); audioRecord.release(); } } catch (Throwable ignored) {}
        audioRecord = null;
        try {
            if (displayListener != null) ((DisplayManager) getSystemService(Context.DISPLAY_SERVICE)).unregisterDisplayListener(displayListener);
        } catch (Throwable ignored) {}
        displayListener = null;
        try { if (display != null) display.release(); } catch (Throwable ignored) {}
        display = null;
        try { if (reader != null) reader.close(); } catch (Throwable ignored) {}
        reader = null;
        try { if (projection != null) projection.stop(); } catch (Throwable ignored) {}
        projection = null;
        if (thread != null) thread.quitSafely();
        thread = null;
        ScreenHub.reset();
        if (!"denied".equals(ScreenHub.state)) ScreenHub.setState("idle");
    }

    @Override
    public void onDestroy() {
        stopCapture();
        super.onDestroy();
    }
}
