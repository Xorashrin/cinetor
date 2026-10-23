# Cinetor CineHD Verification

The previous BDIX verification claims are superseded by the CineHD replacement. Run these checks from the project root:

```sh
npm run typecheck
npm test
npm run test:live
npx expo install --check
npx expo-doctor
npx expo export --platform android --output-dir builds/cinehd-bundle
```

The deterministic suite has 30 tests covering metadata/proxy encoding, independent cancellation, timeouts/body bounds, persistence, feed classification, current live directory schemas, source ranking, native playlist/movie/episode resolution, transport rejection, search sorting, finite HLS packaging, alternate audio, keys, concurrency, failure cleanup, and cancellation.

Live results are recorded in [live-verification.json](cinehd-evidence/live-verification.json): 78 initial titles, 22 Anime titles, 21 K-Drama titles, 45 registry providers, 1,000 channel candidates, movie search/details/cast, eight TV seasons with episode artwork, three transport-verified HLS language sources, offline cache hydration, and a complete local HLS package plan. Directory rows are candidates, not verified live channels. The sampled HLS plan contains 2 playlists and 2,159 resources.

Expo compatibility checks passed: dependencies are current and Expo Doctor passed 20/20 checks. Android bundle export is a separate validator from the Gradle build. GitHub Actions builds the release, verifies version 1.1.1 (6), checks all three architectures and the embedded Hermes bundle, verifies signing schemes, and rejects debuggable APKs. Downloaded artifacts must match `SHA256SUMS` and the source commit in `release-evidence.json`.

The first release's native WorkManager/Room startup crash was discovered on an Android 15 emulator. Release minification/resource shrinking are disabled, and the workflow now tests the signed APK's Home screen before publication. A diagnostic build verified native HLS playback, pause, seeking, and source switching. The final v1.1.1 signed artifact still needs those runtime checks.

Complete movie downloads/local playback, device media export, subtitle selection, and actual background execution require runtime evidence. Physical ARM devices have not been tested. Provider uptime and all-title stream coverage are external limitations.
