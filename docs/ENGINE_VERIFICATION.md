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

The first release's native WorkManager/Room startup crash was discovered on an Android 15 emulator. Release minification/resource shrinking are disabled, and the workflow now tests the signed APK's Home screen before publication. [Actions run 39914516525](https://github.com/Xorashrin/cinetor/actions/runs/39914516525) passed and published v1.1.1 from commit `381e421a3959eabe73d7787dbff11dc15c3847c3`. The downloaded artifact matches its checksum and passes local startup, remote search/details, HLS decoding, pause, ten-second seek, Bengali-to-Tamil source switching, and resume. ATN Bangla live playback also passed using native playing state and changing video frames. Checksum-bound observations are in [android-runtime-verification.json](cinehd-evidence/android-runtime-verification.json).

A full 1.3 GB HLS package downloaded on the diagnostic APK and remained playable offline after upgrading to the exact signed v1.1.1 release. Pause and download deletion also passed on that release. Visual evidence showed upstream content problems: Bengali returned a different film under the Oppenheimer entry, while sampled media contained betting watermarks. Transport/decoder success does not validate content identity or upstream advertising.

MP4 device media export, subtitle selection, and actual background execution require runtime evidence. Physical ARM devices have not been tested. Provider uptime and all-title stream coverage are external limitations.
