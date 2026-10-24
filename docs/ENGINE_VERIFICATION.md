# Cinetor Verification Gates

## Current evidence state

The 2.0.0 integration has been inspected at the source level. No local dependency installation, typecheck, tests, bundle, Gradle/JVM process, emulator, or app execution was run for this task. All such checks belong to GitHub Actions. Do not substitute older v1.1.1 results for current evidence.

The initial handoff stopped after one source push. After the user reported the SDK setup failure, they requested a corrected release APK through Actions. Follow-up verification therefore runs in the cloud; no local execution restriction has changed.

## Cloud workflow

`.github/workflows/android.yml` runs on `main`, `feat/cinetor-three-engine-redesign`, and manual dispatch. Its gates are:

1. Locked npm install and original asset generation.
2. TypeScript checking, deterministic TypeScript tests, Python release-tool regressions, Expo dependency compatibility, and Expo Doctor.
3. Secure Expo Android prebuild with API 26 minimum, compile/target SDK 36, build-tools 36.0.0, JDK 17, Kotlin 2.4.10, JitPack, and AGP 9 compatibility settings. Expo autolinking builds the locked module sources in CI instead of using precompiled Expo AARs that require unavailable SDK 37. App and Expo AAR metadata are checked before full APK assembly.
4. Native engine bootstrap AAR, compiled original Cloudstream fixture, source-pin validation, DEX/resource packaging, and generated artifact pin.
5. BDIX JUnit tests for policy, HTTP, FTP, and FTPS; Media3 policy tests. `verify_native_tests.py` requires every named class, actual nonzero test cases, and no failed or skipped tests.
6. Universal release APK for armeabi-v7a, arm64-v8a, and x86_64. Release minification/resource shrinking remain disabled because the previous baseline had a minified startup failure.
7. APK signature, package/version/code, Android SDK requirements, embedded bundle, native library parity across all three ABIs, ELF architecture, and nondebuggable-manifest inspection. Directory presence alone is insufficient: every packaged native library must have all three architecture variants. This static gate does not establish physical-device or 16 KiB page-size behavior. The signer fingerprint must match the recorded v1.1.1 certificate in `config/android-signing.json`. Signing remains the Android debug certificate, not private distribution signing.
8. Real native Nuvio/Cloudstream instrumentation on Android API 35, with nonempty XML evidence. The owned fixture tests exercise QuickJS, cancellation, DEX/resources, exact opaque data, settings, and admission boundaries without pretending to establish broad provider coverage.
9. Android 15 startup smoke on the exact signed APK. It requires rendered navigation and a live application process; it explicitly does not test playback.
10. Corresponding engine source, exact application Git source, generated fixture provenance, notices, and checksums packaged with the passing commit-bound Actions artifact.

Verification logs and native reports upload even after failures when available. Host assembly, fixture packaging, instrumentation compilation, BDIX tests, and media tests have separate logs. Once prebuild and Gradle setup pass, independent BDIX and media tests still run after another native stage fails. No failure is ignored: APK assembly and final artifact publication remain blocked until all preceding gates pass. The workflow does not create a public release or overwrite the historical v1.1.1 tag.

## Interpretation

- A parser test does not establish native ABI compatibility.
- A fixture test does not establish every external extension works.
- An HTTP status, manifest, probe, timestamp, or repository entry is not decoded playback proof.
- A rendered-first-frame event establishes one exact source attempt, not an independently reviewed identity for an arbitrary file.
- A probe representation hash is not a full-file checksum or timeline identity.
- Startup success is not playback, offline persistence, physical-device, or performance coverage.
- Native test tasks that report NO-SOURCE cannot count as passing coverage.

## Still requiring real acceptance evidence

Before describing the application as production-ready, inspect the current CI results and exercise the exact signed APK on representative devices. Required follow-up includes first-frame playback for both reviewed fixtures, an explicitly authorized real BDIX endpoint, Wi-Fi changes/cancellation, track selection, seek/source transitions, background/restart behavior, complete MP4, finite non-DRM HLS (including AES-128 identity keys), and clear DASH downloads with offline playback, storage exhaustion, deletion, profile isolation, larger text, and reduced motion.

Physical ARM-device compatibility, 16 KiB page-size behavior, broad source coverage, latency/memory/power measurements, and download throughput remain unmeasured. No numerical improvement or APK-size target is asserted without current measurements.

## Historical records

`CINEHD_IMPLEMENTATION_REPORT.md` and `cinehd-evidence/` retain prior commit/APK-bound records. They are historical research and baseline evidence only. Their old test counts, provider results, decoded media, and download checks do not validate this version.
