package expo.modules.cinetormedia

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.exoplayer.scheduler.Scheduler

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class CinetorDownloadService : DownloadService(NOTIFICATION_ID, 1000L) {
  companion object {
    private const val CHANNEL = "cinetor.private.downloads"
    private const val NOTIFICATION_ID = 3741
  }

  override fun onCreate() {
    if (Build.VERSION.SDK_INT >= 26) {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "Offline downloads", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Background media transfer status"
        setShowBadge(false)
        lockscreenVisibility = Notification.VISIBILITY_SECRET
      })
    }
    super.onCreate()
  }

  override fun getDownloadManager(): DownloadManager = MediaEngine.get(this).manager
  // Android 12+ does not allow arbitrary background foreground-service starts. Restore paused;
  // the next user action in the foreground explicitly starts a new transfer, never boot-loop it.
  override fun getScheduler(): Scheduler? = null

  override fun getForegroundNotification(downloads: MutableList<Download>, notMetRequirements: Int): Notification {
    val builder = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle("Offline downloads")
      .setContentText(if (notMetRequirements != 0) "Waiting for a connection" else "Saving media privately")
      .setOngoing(true).setOnlyAlertOnce(true).setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setVisibility(NotificationCompat.VISIBILITY_SECRET).setProgress(0, 0, true)
    packageManager.getLaunchIntentForPackage(packageName)?.let { intent ->
      builder.setContentIntent(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    }
    return builder.build()
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    MediaEngine.get(this).pauseAll("Android stopped background work. Open the app and restart the download.")
    super.onTimeout(startId, fgsType)
  }
}
