# Cinetor Development Progress

## October 24, 2026: Three-engine integration

The recovered Cinetor branch now contains the redesigned five-tab interface, exact metadata/episode contracts, local profile hub, native engine bridges, explicit provider controls, quarantine-only repository intake, and cloud-only verification configuration.

### Implemented source

- Native BDIX endpoint consent, selected Wi-Fi transport, exact mappings, FTP/FTPS/HTTP handling, cancellation, and registered local playback capabilities.
- Native Nuvio/QuickJS and Cloudstream DEX/resource hosts with pinned provenance and two original reviewed Big Buck Bunny fixtures.
- Separate repository metadata reader and ledger. Manual refresh is bounded; publisher declarations stay quarantined and cannot enable code execution.
- Bounded progressive playback coordination, native remote probes, exact representation-scoped rendered-frame evidence, and conservative network/profile invalidation.
- Media3 player controls, tracks/captions, finite non-DRM HLS with AES-128 identity keys, clear DASH/MP4 offline media, persistent native download state, and restart-at-zero semantics.
- Per-profile state, exact episode checks, import/export stripping local capabilities, source-selection identity fixes, and native settings-envelope handling.
- Cinetor 2.0.0/code 7 branding with retained `com.cinator.app`, secure Expo prebuild configuration, Kotlin/JDK alignment, fixture packaging, native test-report gates, source/license packaging, and signed-APK startup checks in GitHub Actions.

### Source-review corrections

Review found and corrected a standalone Cloudstream fixture JVM-target mismatch and a native HTTP redirect call-ID race. Media review identified mutable online-manifest identity checks and parent double-deletion of native-owned files. Both corrections and the native manifest regression test source are integrated. The focused media follow-up also fixes validator-free online ranges, replacement-attempt terminal events, canceled-session cleanup, URI-first rotated HLS key validation, and missing-native view fallback. Parent/native source normalization now agrees on download formats, live DASH handling, and representation-specific source selection. Regression sources cover legacy-versus-native deletion ownership and finite non-DRM HLS admission. Historical signer output exposed an obsolete digest parser; CI now accepts versioned apksigner output and requires the recorded v1.1.1 certificate fingerprint. These are source-level corrections, not claims that tests passed.

### Evidence status

- Local repository, source, configuration, and contract inspection: performed.
- Typecheck, tests, dependency installation, Gradle/JVM execution, bundling, app execution, and emulator work on the development PC: **not run**, by instruction.
- Cloud run `40113406031` at commit `b8c8bb0` passed typechecking, deterministic checks, pinned host/fixture assembly, instrumentation compilation, all 16 BDIX tests, and all eight Media3 policy tests. No native tests were skipped.
- Full APK assembly stopped because 16 Expo AARs require compile SDK 37. Instrumentation execution, APK size/signature/startup results, and device playback: **pending cloud evidence**.
- Broad third-party extension coverage, real BDIX endpoint playback, physical ARM-device playback, and performance benchmarks: **not established**.
- Only two reviewed fixture IDs are admitted. A historical manifest count or successful HTTP response is not decoded playback proof.

The initial delivery stopped after one source push. The user then reported the failed workflow and requested a corrected cloud-built release APK. Run `40100551613` failed because Android SDK setup requested the unavailable legacy `tools` package. Subsequent cloud runs exposed React Native 0.88 type errors, undefined optional probe headers, and outdated Expo patch dependencies. The type and header fixes passed typechecking, 92 TypeScript tests, and four Python signer tests in run `40102504186`; that run stopped at the Expo compatibility gate before native compilation. Expo patch dependency resolution was performed only in Actions, and its lockfile was reviewed before integration. A passing release workflow uploads a commit-bound Actions APK/source artifact; no public GitHub Release is created automatically.

The native DNS repair and literal-address policy regressions passed in run `40113406031`. The FTP fixture now snapshots client cleanup under its lock, and Media3 selects the release unit-test variant explicitly for AGP 9. Cloud stages isolate host assembly, fixture packaging, instrumentation compilation, BDIX tests, and media tests. Independent native tests can report failures in the same run, while APK assembly still requires every preceding gate to pass.

The next correction raises compile SDK to 37 for the published Expo AAR requirements without changing target SDK 36, minimum API 26, package identity, or signing. It also strengthens the cross-thread QuickJS interruption test: JavaScript must signal entry, manual interruption must produce the expected exception within three seconds, and the independent evaluation deadline cannot supply a false pass. These latest corrections require their own cloud evidence.

## Historical evidence

The October 23, 2026 CineHD v1.1.1 implementation and its prior checks are documented in `CINEHD_IMPLEMENTATION_REPORT.md` and `cinehd-evidence/`. Those results apply to their recorded commits/APKs only. They do not validate the new engines, UI, native downloads, or version 2.0.0.
