# Cinetor

Cinetor is an Android entertainment client built with Expo SDK 58, React Native 0.88, Hermes, Reanimated, and expo-video. Version 1.1.0 (5), package `com.cinator.app`.

The existing dark UI now uses the metadata and native media contracts recovered from the supplied CineHD APKs. Titles, artwork, search, cast, seasons, and episodes load independently of stream resolution. Home excludes Anime and K-Drama; those categories have dedicated feeds. Live TV uses the current IPTV-org directory. The Adult section remains age gated and empty because the inspected CineHD contracts did not supply a native adult catalog.

The native player supports play/pause, seeking, resume, source selection, automatic fallback, actual audio/subtitle tracks, and episode navigation. MP4 downloads can be copied to device media storage. Finite HLS downloads use three concurrent workers and local playlists for playback inside Cinetor. No advertising SDK or browser embed player is loaded.

```sh
npm ci
npm run typecheck
npm test
npm run test:live
npx expo install --check
npx expo-doctor
npm run prebuild:android
cd android
./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64
```

See [the implementation report](docs/CINEHD_IMPLEMENTATION_REPORT.md), [provider configuration](docs/SOURCE_CONFIGURATION.md), [architecture](docs/ENGINE_ARCHITECTURE.md), and [verification](docs/ENGINE_VERIFICATION.md).

Pushing `main` triggers [Android APK](https://github.com/Xorashrin/cinetor/actions/workflows/android.yml). The release contains an inspected universal APK, `SHA256SUMS`, and commit-bound signing/package evidence. The APK uses Android's development certificate. Private distribution signing is not configured. External stream uptime and Android device playback are separate from automated provider checks.
