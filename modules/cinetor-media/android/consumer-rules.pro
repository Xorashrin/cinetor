# Expo module and view are discovered from the generated autolinking provider.
-keep class expo.modules.cinetormedia.CinetorMediaModule { *; }
-keep class expo.modules.cinetormedia.CinetorDownloadService { *; }
# The independent BDIX module uses this tiny capability registry reflectively.
-keep class expo.modules.cinetormedia.TrustedLoopbackSources { public static *; }
# Media3's DefaultDownloaderFactory discovers adaptive downloaders reflectively.
-keep class androidx.media3.exoplayer.hls.offline.HlsDownloader$Factory { public <init>(...); }
-keep class androidx.media3.exoplayer.dash.offline.DashDownloader$Factory { public <init>(...); }
