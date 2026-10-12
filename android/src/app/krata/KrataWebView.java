package app.krata;

import android.content.Context;
import android.view.View;
import android.webkit.WebView;

/**
 * WebView que continua "visível" para o site enquanto há chamada ou transmissão.
 * Sem isso, o Android trata a página como escondida quando você troca de app e
 * desacelera tudo — a transmissão da tela travaria justamente quando você abre o jogo.
 */
public class KrataWebView extends WebView {
    public KrataWebView(Context context) { super(context); }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        if (visibility != View.VISIBLE && ScreenHub.keepAlive()) super.onWindowVisibilityChanged(View.VISIBLE);
        else super.onWindowVisibilityChanged(visibility);
    }
}
