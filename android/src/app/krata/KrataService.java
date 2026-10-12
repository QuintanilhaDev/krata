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
    private boolean video = false;
    private android.media.MediaCodec encoder;
    private android.view.Surface encoderSurface;
    private Thread drainThread;
    private volatile boolean draining = false;
    private final java.util.concurrent.ExecutorService jpegPool = java.util.concurrent.Executors.newFixedThreadPool(2);
    private final java.util.concurrent.atomic.AtomicInteger jpegBusy = new java.util.concurrent.atomic.AtomicInteger();
    // 3 bitmaps reaproveitados (no máximo 2 comprimindo + 1 sendo copiado): sem lixo de memória a cada quadro
    private final Bitmap[] pool = new Bitmap[3];
    private final boolean[] poolBusy = new boolean[3];

    private synchronized int takeBitmap(int w, int h) {
        for (int i = 0; i < pool.length; i++) {
            if (poolBusy[i]) continue;
            if (pool[i] == null || pool[i].getWidth() != w || pool[i].getHeight() != h) {
                if (pool[i] != null) pool[i].recycle();
                pool[i] = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            }
            poolBusy[i] = true;
            return i;
        }
        return -1;
    }
    private synchronized void giveBitmap(int i) { poolBusy[i] = false; }
    private int fps = 30;
    private int width, height, dpi;
    private long lastFrameAt = 0;


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
            video = "video".equals(ScreenHub.mode);
            // vídeo por hardware aguenta 60 qps; o modo antigo (JPEG) fica em até 30
            fps = Math.max(5, Math.min(video ? 60 : 30, intent.getIntExtra("fps", 30)));
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
        if ("source".equals(q)) return 1080; // "automático" no celular: 1080p no lado menor (fluido e nítido)
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
        android.view.Surface target;
        if (video) {
            try { startEncoder(); target = encoderSurface; }
            catch (Throwable t) { video = false; ScreenHub.mode = "jpeg"; reader = newReader(); target = reader.getSurface(); }
        } else { reader = newReader(); target = reader.getSurface(); }
        display = projection.createVirtualDisplay("krata", width, height, dpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, target, null, handler);

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
                if (video) {
                    // girou: recria o codificador no tamanho novo
                    stopEncoder();
                    try { startEncoder(); display.resize(width, height, dpi); display.setSurface(encoderSurface); }
                    catch (Throwable t) { stopCapture(); updateForeground(); }
                    return;
                }
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
        int align = video ? 16 : 2;
        width = Math.max(align, Math.round(w * scale) / align * align);
        height = Math.max(align, Math.round(h * scale) / align * align);
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
            // os dois compressores ocupados: pula este quadro em vez de acumular atraso
            if (now - lastFrameAt < 1000 / fps || jpegBusy.get() >= 2) return;
            lastFrameAt = now;
            Image.Plane plane = image.getPlanes()[0];
            ByteBuffer buf = plane.getBuffer();
            int pixelStride = plane.getPixelStride();
            int rowStride = plane.getRowStride();
            final int w = image.getWidth(), h = image.getHeight();
            int padded = rowStride / pixelStride;
            final int slot = takeBitmap(padded, h);
            if (slot < 0) return;
            final Bitmap bmp = pool[slot];
            buf.rewind();
            bmp.copyPixelsFromBuffer(buf);
            image.close();
            image = null;
            jpegBusy.incrementAndGet();
            jpegPool.execute(new Runnable() {
                @Override public void run() {
                    try {
                        Bitmap out = bmp.getWidth() == w ? bmp : Bitmap.createBitmap(bmp, 0, 0, w, h);
                        ByteArrayOutputStream os = new ByteArrayOutputStream(256 * 1024);
                        out.compress(Bitmap.CompressFormat.JPEG, Math.min(w, h) > 1100 ? 62 : 72, os);
                        if (out != bmp) out.recycle();
                        ScreenHub.publishFrame(os.toByteArray());
                    } catch (Throwable ignored) {
                    } finally { giveBitmap(slot); jpegBusy.decrementAndGet(); }
                }
            });
        } catch (Throwable ignored) {
        } finally {
            if (image != null) image.close();
        }
    }

    // ------------------------------------------------------------- vídeo por hardware (H.264)
    private void startEncoder() throws Exception {
        android.media.MediaFormat f = android.media.MediaFormat.createVideoFormat("video/avc", width, height);
        f.setInteger(android.media.MediaFormat.KEY_COLOR_FORMAT, android.media.MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
        // a conexão aqui é local (dentro do celular): bitrate alto para chegar no WebRTC sem perder detalhe
        int bitrate = (int) Math.min(40_000_000L, (long) width * height * fps / 4);
        f.setInteger(android.media.MediaFormat.KEY_BIT_RATE, Math.max(4_000_000, bitrate));
        f.setInteger(android.media.MediaFormat.KEY_FRAME_RATE, fps);
        f.setFloat("max-fps-to-encoder", fps);
        f.setInteger(android.media.MediaFormat.KEY_I_FRAME_INTERVAL, 2);
        f.setLong(android.media.MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 1_000_000L / 10); // tela parada: repete o quadro
        f.setInteger(android.media.MediaFormat.KEY_PRIORITY, 0); // tempo real
        android.media.MediaCodec c = android.media.MediaCodec.createEncoderByType("video/avc");
        try {
            android.media.MediaFormat low = new android.media.MediaFormat(f);
            if (Build.VERSION.SDK_INT >= 30) low.setInteger(android.media.MediaFormat.KEY_LOW_LATENCY, 1);
            c.configure(low, null, null, android.media.MediaCodec.CONFIGURE_FLAG_ENCODE);
        } catch (Throwable t) {
            c.reset();
            c.configure(f, null, null, android.media.MediaCodec.CONFIGURE_FLAG_ENCODE);
        }
        encoderSurface = c.createInputSurface();
        c.start();
        encoder = c;
        draining = true;
        final android.media.MediaCodec enc = c;
        drainThread = new Thread(new Runnable() {
            @Override public void run() {
                android.media.MediaCodec.BufferInfo info = new android.media.MediaCodec.BufferInfo();
                while (draining) {
                    try {
                        if (ScreenHub.keyRequested) {
                            ScreenHub.keyRequested = false;
                            android.os.Bundle b = new android.os.Bundle();
                            b.putInt(android.media.MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0);
                            enc.setParameters(b);
                        }
                        int idx = enc.dequeueOutputBuffer(info, 20_000);
                        if (idx == android.media.MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                            android.media.MediaFormat of = enc.getOutputFormat();
                            ByteBuffer s0 = of.getByteBuffer("csd-0"), s1 = of.getByteBuffer("csd-1");
                            if (s0 != null) {
                                byte[] a = new byte[s0.remaining()]; s0.get(a);
                                byte[] b2 = new byte[0];
                                if (s1 != null) { b2 = new byte[s1.remaining()]; s1.get(b2); }
                                byte[] both = new byte[a.length + b2.length];
                                System.arraycopy(a, 0, both, 0, a.length);
                                System.arraycopy(b2, 0, both, a.length, b2.length);
                                ScreenHub.setCsd(both);
                            }
                        } else if (idx >= 0) {
                            ByteBuffer ob = enc.getOutputBuffer(idx);
                            if (ob != null && info.size > 0) {
                                byte[] data = new byte[info.size];
                                ob.position(info.offset);
                                ob.get(data, 0, info.size);
                                if ((info.flags & android.media.MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) ScreenHub.setCsd(data);
                                else ScreenHub.pushVideo(data, (info.flags & android.media.MediaCodec.BUFFER_FLAG_KEY_FRAME) != 0, info.presentationTimeUs);
                            }
                            enc.releaseOutputBuffer(idx, false);
                        }
                    } catch (Throwable t) {
                        if (!draining) break;
                        try { Thread.sleep(10); } catch (InterruptedException e) { break; }
                    }
                }
            }
        }, "krata-encoder");
        drainThread.setPriority(Thread.MAX_PRIORITY);
        drainThread.start();
    }

    private void stopEncoder() {
        draining = false;
        try { if (drainThread != null) drainThread.join(300); } catch (InterruptedException ignored) {}
        drainThread = null;
        try { if (encoder != null) { encoder.stop(); encoder.release(); } } catch (Throwable ignored) {}
        encoder = null;
        try { if (encoderSurface != null) encoderSurface.release(); } catch (Throwable ignored) {}
        encoderSurface = null;
    }

    private void startAudio() {
        try {
            AudioPlaybackCaptureConfiguration.Builder cb = new AudioPlaybackCaptureConfiguration.Builder(projection);
            java.util.List<Integer> uids = new java.util.ArrayList<Integer>();
            for (String pkg : ScreenHub.audioApps) {
                try { int uid = getPackageManager().getApplicationInfo(pkg, 0).uid; if (uid != Process.myUid() && !uids.contains(uid)) uids.add(uid); } catch (Exception ignored) {}
            }
            if (!uids.isEmpty()) {
                // só o som dos apps escolhidos (como no GoLive)
                for (int uid : uids) cb.addMatchingUid(uid);
            } else {
                cb.addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                  .addMatchingUsage(AudioAttributes.USAGE_GAME)
                  .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                  .excludeUid(Process.myUid()); // não manda de volta a voz de quem está na chamada
            }
            AudioPlaybackCaptureConfiguration cfg = cb.build();
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
        stopEncoder();
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
