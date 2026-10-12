package app.krata;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

/** Resposta do instalador do Android: abre a confirmação ou mostra o erro. */
public class InstallReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -999);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) {
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try { context.startActivity(confirm); } catch (Throwable t) { Updater.state = "error"; Updater.error = "Abra o Krata e toque em Atualizar de novo."; }
            }
        } else if (status == PackageInstaller.STATUS_SUCCESS) {
            Updater.state = "latest";
        } else {
            Updater.state = status == PackageInstaller.STATUS_FAILURE_ABORTED ? "available" : "error";
            String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            if (status == PackageInstaller.STATUS_FAILURE_CONFLICT || status == PackageInstaller.STATUS_FAILURE_INCOMPATIBLE)
                Updater.error = "Essa versão não foi assinada com a mesma chave do app instalado.";
            else if (status != PackageInstaller.STATUS_FAILURE_ABORTED)
                Updater.error = "A instalação falhou" + (msg == null ? "." : ": " + msg);
        }
    }
}
