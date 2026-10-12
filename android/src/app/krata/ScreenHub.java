package app.krata;

/** Estado compartilhado entre a captura de tela (serviço) e o WebView (quem pede os quadros). */
final class ScreenHub {
    private ScreenHub() {}

    static final Object LOCK = new Object();
    /** idle | asking | live | denied | error */
    static volatile String state = "idle";
    static volatile boolean inCall = false;

    private static byte[] frame;
    private static long frameId;

    // som: fila circular de PCM 16 bits estéreo 48 kHz (no máximo ~1 s)
    private static final int AUDIO_MAX = 48000 * 4;
    private static final byte[] audio = new byte[AUDIO_MAX];
    private static int audioStart = 0, audioLen = 0;

    static boolean keepAlive() { return inCall || "live".equals(state) || "asking".equals(state); }

    static void setState(String s) {
        synchronized (LOCK) { state = s; LOCK.notifyAll(); }
    }

    static void publishFrame(byte[] jpeg) {
        synchronized (LOCK) { frame = jpeg; frameId++; LOCK.notifyAll(); }
    }

    static void reset() {
        synchronized (LOCK) { frame = null; audioLen = 0; audioStart = 0; LOCK.notifyAll(); }
    }

    /** Espera um quadro mais novo que {@code after}. Devolve null se não chegou nada a tempo. */
    static Object[] awaitFrame(long after, long timeoutMs) throws InterruptedException {
        long end = System.currentTimeMillis() + timeoutMs;
        synchronized (LOCK) {
            while ((frame == null || frameId <= after) && "live".equals(state)) {
                long left = end - System.currentTimeMillis();
                if (left <= 0) break;
                LOCK.wait(left);
            }
            if (frame == null || frameId <= after) return null;
            return new Object[] { frame, Long.valueOf(frameId) };
        }
    }

    static void pushAudio(byte[] buf, int n) {
        synchronized (LOCK) {
            for (int i = 0; i < n; i++) {
                int pos = (audioStart + audioLen) % AUDIO_MAX;
                audio[pos] = buf[i];
                if (audioLen < AUDIO_MAX) audioLen++;
                else audioStart = (audioStart + 1) % AUDIO_MAX;
            }
            LOCK.notifyAll();
        }
    }

    /** Pega todo o som acumulado (espera um pouco se a fila estiver vazia). */
    static byte[] takeAudio(long timeoutMs) throws InterruptedException {
        long end = System.currentTimeMillis() + timeoutMs;
        synchronized (LOCK) {
            while (audioLen < 1920 && "live".equals(state)) { // ~10 ms
                long left = end - System.currentTimeMillis();
                if (left <= 0) break;
                LOCK.wait(left);
            }
            int n = audioLen - (audioLen % 4);
            byte[] out = new byte[n];
            for (int i = 0; i < n; i++) out[i] = audio[(audioStart + i) % AUDIO_MAX];
            audioStart = (audioStart + n) % AUDIO_MAX;
            audioLen -= n;
            return out;
        }
    }
}
