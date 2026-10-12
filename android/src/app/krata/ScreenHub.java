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

    // vídeo H.264 (modo rápido): pedaços codificados pelo hardware do celular
    static volatile String mode = "jpeg";
    static volatile String codec = "avc1.42E01F";
    static volatile boolean keyRequested = false;
    private static final java.util.ArrayDeque<Object[]> video = new java.util.ArrayDeque<Object[]>(); // {seq, key, pts, data}
    private static long videoSeq = 0;
    private static byte[] csd = null;

    static void setCsd(byte[] b) { synchronized (LOCK) { csd = b; codec = codecFromSps(b); } }

    static void pushVideo(byte[] data, boolean key, long ptsUs) {
        synchronized (LOCK) {
            if (key && csd != null && !startsWithSps(data)) {
                byte[] both = new byte[csd.length + data.length];
                System.arraycopy(csd, 0, both, 0, csd.length);
                System.arraycopy(data, 0, both, csd.length, data.length);
                data = both;
            }
            video.addLast(new Object[] { Long.valueOf(++videoSeq), Boolean.valueOf(key), Long.valueOf(ptsUs), data });
            while (video.size() > 180) video.removeFirst();
            LOCK.notifyAll();
        }
    }

    /**
     * Pedaços depois de {@code after}. Se quem pede está chegando agora (ou ficou para trás demais),
     * começa do último quadro-chave e pede um novo ao codificador.
     */
    static java.util.List<Object[]> awaitVideo(long after, long timeoutMs) throws InterruptedException {
        long end = System.currentTimeMillis() + timeoutMs;
        synchronized (LOCK) {
            for (;;) {
                java.util.List<Object[]> out = new java.util.ArrayList<Object[]>();
                if (!video.isEmpty()) {
                    long oldest = (Long) video.peekFirst()[0];
                    long from = after;
                    if (after <= 0 || after < oldest - 1) {
                        Object[] lastKey = null;
                        for (Object[] c : video) if ((Boolean) c[1]) lastKey = c;
                        keyRequested = true;
                        from = lastKey == null ? Long.MAX_VALUE : (Long) lastKey[0] - 1;
                    }
                    for (Object[] c : video) if ((Long) c[0] > from) out.add(c);
                }
                long left = end - System.currentTimeMillis();
                if (!out.isEmpty() || left <= 0 || !"live".equals(state)) return out;
                LOCK.wait(left);
            }
        }
    }

    private static boolean startsWithSps(byte[] d) {
        for (int i = 0; i + 4 < d.length && i < 64; i++)
            if (d[i] == 0 && d[i + 1] == 0 && (d[i + 2] == 1 || (d[i + 2] == 0 && d[i + 3] == 1))) {
                int at = d[i + 2] == 1 ? i + 3 : i + 4;
                return (d[at] & 0x1f) == 7;
            }
        return false;
    }

    /** "avc1.PPCCLL" a partir do SPS (perfil, restrições e nível). */
    static String codecFromSps(byte[] d) {
        for (int i = 0; i + 7 < d.length; i++) {
            boolean three = d[i] == 0 && d[i + 1] == 0 && d[i + 2] == 1;
            if (three && (d[i + 3] & 0x1f) == 7) return String.format(java.util.Locale.US, "avc1.%02X%02X%02X", d[i + 4] & 0xff, d[i + 5] & 0xff, d[i + 6] & 0xff);
        }
        return "avc1.42E01F";
    }

    static boolean keepAlive() { return inCall || "live".equals(state) || "asking".equals(state); }

    static void setState(String s) {
        synchronized (LOCK) { state = s; LOCK.notifyAll(); }
    }

    static void publishFrame(byte[] jpeg) {
        synchronized (LOCK) { frame = jpeg; frameId++; LOCK.notifyAll(); }
    }

    static void reset() {
        synchronized (LOCK) { frame = null; audioLen = 0; audioStart = 0; video.clear(); csd = null; LOCK.notifyAll(); }
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
