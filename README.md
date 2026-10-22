# Cinetor

Android streaming application using Expo SDK 58, React Native 0.88, Hermes and expo-video.

Home, Anime, K-Drama, Live TV and the age-gated Adult section consume the shared persistent catalog. Discovery starts after essential initialization and never gates first render. No parser/server tab exists.

The source registry starts empty. Configure authorized endpoints using [SOURCE_CONFIGURATION.md](docs/SOURCE_CONFIGURATION.md). Protocol support, verification limits, secrets provisioning and Android scheduling constraints are documented there. See [ENGINE_ARCHITECTURE.md](docs/ENGINE_ARCHITECTURE.md) for the removal investigation and module design.

```sh
npm ci
npm run typecheck
npm test
npx expo install --check
npx expo-doctor
npm run prebuild:android
cd android
./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64
```

Pushing main triggers [Android APK](../../actions/workflows/android.yml). The `cinetor-android-release` artifact contains the real release variant APK, SHA256SUMS and commit-bound inspected metadata. Version 1.0.3 (4), package `com.cinator.app`. Current signing uses Android's development certificate; private distribution signing is not configured. Device and real BDIX-source runtime results require actual devices and authorized source configuration; unit fixtures do not establish them.
