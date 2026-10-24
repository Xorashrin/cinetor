# Cinetor

Cinetor 2.0.0 (Android version code 7) is an Expo SDK 58 / React Native 0.88 Android client with native BDIX, Nuvio, and Cloudstream engine integration. The package remains `com.cinator.app`; the new name and coral/ink interface do not change the installed application identity.

## Interface

- Five primary tabs: **Home, Anime, K-Drama, Others, Profiles**.
- Virtualized metadata lists, independent section search and filters, title details, and exact episode selection.
- Local profiles, saved titles, Continue Watching, native downloads, settings, import/export, and separate Live TV navigation.
- Reduced-motion support, accessible controls, honest loading/error/empty states, and no fabricated metadata or verification badges.
- Adult content remains disabled and empty. No restricted-content source is bundled.

Metadata discovery is not a promise of playback. The existing external TMDB metadata proxy remains available; `EXPO_PUBLIC_TMDB_API_KEY` optionally selects direct TMDB access. Build-time `EXPO_PUBLIC_` values are public application configuration, not secrets.

## Engines and extensions

**BDIX:** Explicitly approved HTTP/HTTPS or anonymous FTP/FTPS endpoints, an explicitly selected Android Wi-Fi network, and exact movie/episode mappings. Directory entries never become title matches automatically. There are no bundled local servers, subnet scans, credential guesses, or public ISP scans.

**Nuvio:** Native Kotlin/QuickJS runtime with bounded execution, cancellation, host APIs, and reviewed source/artifact admission. Provider JavaScript does not execute in the unrestricted React Native realm.

**Cloudstream:** Real Android DEX loading, resources, provider registration, search/load/opaque-data resolution, and native settings for the pinned 4.8.0 ABI. DEX runs with the app UID; a classloader is not a security sandbox.

Only two original reviewed fixtures are executable: `cinetor-bbb-nuvio` and `cinetor-bbb-cloudstream`. Both cover **Big Buck Bunny (2008), TMDB movie 810**, not arbitrary films or series. They are disabled until explicitly enabled. Historical provider counts are not reconstructed catalogs or working-provider evidence.

**Repository intake:** Save explicit Nuvio/Cloudstream JSON URLs, manually refresh metadata, filter declared entries, inspect publisher/hash claims, and see added/changed/removed counts. Cloudstream descriptors may name up to four indexes. All imported entries remain quarantined; intake never downloads plugin packages or changes the executable allowlist. New providers need independent source, license, artifact, ABI, network, and device review before a new pinned build can admit them.

## Playback and downloads

The Media3 player supports online and offline playback, pause/seek, speed, source selection, audio/caption/video tracks, exact episode navigation, and lifecycle cancellation. Source changes preserve position only with an independently compatible timeline ID. A decoded-playback record requires the actual rendered-first-frame callback and exact provider, representation, content, access, device, and network context. Probe success is not decoded evidence.

Shared limits are two resolvers, two media probes, and two transfers. Automatic startup/recovery stays within the original 45-second attempt, at most three automatic switches, and one refresh per stable candidate. A new attempt requires an explicit action.

Downloads support MP4, finite non-DRM HLS (including AES-128 identity keys), and finite clear DASH. Native planning validates child manifests and exact 16-byte AES keys; DRM is not supported. MKV and WebM are online-only. Paused/interrupted transfers restart at zero; there is no cross-provider byte append and no automatic retry. Offline missing files never fall back to the network. Imported download rows contain metadata only, not trusted local file capabilities.

## Build and verification

**Builds, dependency installation, typechecks, tests, bundles, JVM tools, and emulators run only in cloud CI. Do not run them on the development PC.**

The [Android APK workflow](https://github.com/Xorashrin/cinetor/actions/workflows/android.yml) runs on `main`, `feat/cinetor-three-engine-redesign`, and manual dispatch. It generates original icon assets, verifies TypeScript and native tests, builds the owned Cloudstream fixture, builds the universal APK, checks signatures/package/bundle/ABIs, and gates the final download on native instrumentation and Android 15 startup.

A passing run uploads a commit-bound Actions artifact containing the APK, evidence, checksums, licenses, and corresponding engine/application source. It does **not** automatically create or overwrite a public GitHub Release. Signing remains Android's debug certificate; private distribution signing is not configured. CI rejects certificates that differ from the recorded v1.1.1 fingerprint in `config/android-signing.json`. The new APK's certificate match remains unverified until CI runs.

This implementation has source-level review, not completed cloud/runtime verification. No current test, build, physical-device playback, broad-provider coverage, performance, or APK-size result is claimed before the corresponding CI evidence exists. Old v1.1.1 evidence is historical only.

## Documentation

- [Current implementation status](docs/PROGRESS.md)
- [Architecture and trust boundaries](docs/ENGINE_ARCHITECTURE.md)
- [Source configuration](docs/SOURCE_CONFIGURATION.md)
- [Verification gates](docs/ENGINE_VERIFICATION.md)
- [Native engine provenance and source obligations](docs/NATIVE_ENGINE_PROVENANCE.md)
- [Distribution licensing](LICENSES.md)

Developed By: Asraful Islam

Contributed By: Sazzad Hossain

Cinetor is an independent application. Third-party engine names identify compatibility and attribution, not endorsement. The original Expo MIT notice remains in `LICENSE`; the combined native integration is not MIT-only.
