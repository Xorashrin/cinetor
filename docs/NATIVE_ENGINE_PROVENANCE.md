# Native engine provenance

Implementation date: October 24, 2026. Validation state: **source inspected; Android builds, tests, installation, playback, and shrinking NOT RUN locally**. Builds and device tests belong to GitHub CI only. The local computer must not run Gradle, JVM tools, dependency installs, bundles, or tests.

## Delivered scope

`modules/cinetor-engines` is a persistent local Expo Android module named `CinetorEngines`. It survives `expo prebuild`; generated `android/` files are not the integration source. Expo autolinking derives Gradle project `:cinetor-engines` from the local package name. The parent app must configure local module discovery, Kotlin 2.4.10, and JitPack, and must maintain its own exact-content mapping, profile authorization, publication gates, player, downloads, and UI.

The module contains a real QuickJS-backed Nuvio adapter and a real Cloudstream Android DEX loader. Only two original, source-reviewed Blender fixtures are admitted. Neither historical Nuvio inventories nor historical Cloudstream repository listings have been reconstructed or activated. Engine plumbing does not establish general provider compatibility or live catalog coverage.

## Immutable upstream selection

- **NuvioMobile:** `NuvioMedia/NuvioMobile@c114d6fb69fbed2bbed1f728bce7d752b5a19158`, GPL-3.0. The modular `composeApp/src/fullCommonMain/kotlin/com/nuvio/app/features/plugins/runtime` contract was reviewed. `JsBindings.kt` is adapted directly; runtime, host, network, DOM, and crypto seams follow that contract with Android-only replacements. Upstream unmodified `JsBindings.kt` SHA-256 is `a60e4ec5e783b148ea7a5e007671c92e05eebffe45cfc5c45cf271772c3bcad3`.
- **QuickJS-KT:** `io.github.dokar3:quickjs-kt-android:1.0.15`, source `dokar3/quickjs-kt@a081755bcdb18ee6afa7ffee25b8fa976f06d31f`, Apache-2.0 plus Bellard/c-vector MIT notices. AAR size 1,828,904 bytes; SHA-256 `406c3efb80d5fa3495df4a7f2663be8cc30c974fe5c2368effa929de77cf0ed8`. The Nuvio `fork1.0.5` artifact was not selected because its source provenance is incomplete. Official APIs used include `QuickJs.create(dispatcher)`, suspending `evaluate`, `memoryLimit`, `maxStackSize`, `evaluationTimeoutMillis`, and cross-thread `interruptEvaluation()`.
- **Cloudstream:** `com.github.recloudstream.cloudstream:library-android:v4.8.0` from JitPack, source `recloudstream/cloudstream@3796406e636356f556c16e04e1da4e37d6a19038`, GPL-3.0. AAR size 2,025,294 bytes; SHA-256 `c15283dcf40055e4e747aeb6d8ae000dbf66d6a7566cca90e8d68f01020d3a49`. Profile: `cloudstream-4.8.0-androidJvm`, not a universal Cloudstream ABI. Version 4.7 and older have incompatible collection getter descriptors.
- **NuvioTV:** `NuvioMedia/NuvioTV@b36db80835a79c09fef3675ea327e3f412841f23` is a reference only. It is not bundled or copied.

`config/engine-lock.json` records the complete pins, required dependency profile, original fixture source hashes, and source archive locators. The module's `verifyCinetorEngineArtifacts` task hashes the actual Gradle-selected release AAR files on every build. A changed AAR fails the build even if a separately downloaded file matched.

The complete published Cloudstream dependency graph is retained. There are no exclusions hiding missing implementations. It includes NiceHttp 0.4.18/OkHttp 5.3.2, Jsoup 1.22.1, Jackson 2.13.1, coroutines 1.11.0, serialization 1.11.0, datetime 0.8.0, atomicfu 0.33.0, Ksoup 0.2.6, Ktor HTTP 3.5.0, Rhino 1.8.1, cryptography 0.6.0, TMDB-java 2.13.0, fuzzywuzzy 1.4.0, and NewPipeExtractor v0.26.3. Published Kotlin stdlib/reflect metadata uses 2.3.21/2.3.20; the host compiler and direct Kotlin runtime are aligned to 2.4.10.

## Runtime boundaries

### Nuvio

Each invocation receives a new QuickJS instance, never the unrestricted React Native JavaScript realm, `new Function`, or a WebView. The host applies a 32 MiB JS heap, 512 KiB JS stack, 30-second maximum wall-clock deadline, independent native interruption, two shared engine request slots, and bounded code/results/network/timers/DOM/crypto work. Pending network calls are canceled. JS promises/jobs use the official suspending QuickJS evaluator. No bytecode cache can survive an ABI/polyfill change because no bytecode cache is used.

The adapter calls `getStreams(tmdbId, 'movie'|'tv', season?, episode?)` with a decimal-string TMDB ID. TV requires explicit season and episode; season zero is supported. Movies reject episode fields. `SCRAPER_ID`, `SCRAPER_SETTINGS`, optional `onSettings`, async fetch including binary bodies/responses and real abort signals, timers, URL/URLSearchParams, bounded HTML/Cheerio/DOMParser, and a constrained JCA-backed CryptoJS/WebCrypto subset are implemented. Unsupported algorithms, regex-native DOM selectors, XML DOM parsing, streaming TextDecoder, WASM, P2P, DRM, and native modules fail explicitly. There is no implicit TMDB API credential injection. Credentials must not be logged.

Upstream behaviors changed intentionally: exceptions no longer become empty arrays; malformed JSON does not become null success; URLSearchParams preserves duplicate keys and updates URL queries; HTML children/parent/filter operations do real work; unsupported WASM does not return empty exports. Optional output fields are omitted instead of emitting nulls incompatible with the parent bridge schema.

### Cloudstream

The original `com.lagradost.cloudstream3` binary namespace is preserved. The AAR supplies `BasePlugin`, `MainAPI`, `APIHolder`, response types, and extractors. The Android app-side `Plugin` ABI provides `load(Context)`, `resources`, and `openSettings`. Stateful `DataStore` methods use private Android preferences. Native settings are plugin-global; Cinetor's separate bridge settings store is encrypted and profile-specific.

The loader validates a pinned private archive, marks its inode read-only before writing through the open descriptor, fsyncs, and renames atomically. It rejects path traversal, duplicates, oversized or malformed manifests/archives, unsupported native libraries, and missing required resources. It uses `PathClassLoader`, the exact manifest class, a no-argument constructor, `filename`, a real Android `AssetManager`/`Resources`, and `Plugin.load(Context)` or `BasePlugin.load()`. Registration is read from actual `APIHolder` providers; each provider has a stable plugin-qualified class ID. Fixture loading verifies the class came from the external DEX rather than the host.

Calls use real provider `search(query,page)`, `load(providerUrl)`, and `loadLinks(opaqueData,false,subtitleCallback,callback)`. URLs and opaque data must have been issued by preceding native calls. Movie data and selected episode data pass unchanged. Actual `LoadResponse.getTMDbId()`/`getImdbId()` values are returned with `provider-sync-data` evidence. The adapter never substitutes a TMDB ID for opaque data and never chooses content by a fuzzy title match.

**DEX executes with the app UID. It is not sandboxed.** The reviewed registry is the admission boundary. Cloudstream cancellation is cooperative plus broker I/O cancellation; arbitrary uncooperative DEX cannot safely be stopped by a coroutine. The original fixtures are cooperative. Plugins requiring incompatible versions, video-click actions, WebView, player interceptors, separate-audio/playlist outputs, native libraries, or other missing app APIs are rejected. The fail-closed `VideoClickAction` linkage type is explicitly not a working implementation of that excluded UI API. No account, telemetry, P2P, or upstream app migration is included.

### Network

Nuvio host requests and Cloudstream's global NiceHttp client route through a separate TLS broker. The Cloudstream interceptor does not proceed on NiceHttp's cloned client, which can otherwise replace TLS, redirect, and timeout settings. The existing response parser is preserved. The selected Cloudstream profile supports read-only requests only.

Requests require exact reviewed HTTPS origins, default port 443, no URL credentials, public DNS addresses, and no proxy. DNS filtering rejects local/private/reserved destinations before connection, including IPv6 transition addresses. Redirects are followed manually with a maximum of five hops; all plugin-controlled headers are dropped on an origin transition, and cross-origin body replay is rejected. Fetch bodies are bounded to 1 MiB, requests to 32 per invocation and four simultaneous broker calls. No scan or unapproved endpoint discovery exists.

The original fixtures require no plugin network access; their reviewed media origin is `https://media.w3.org`. Stream outputs are candidates, not decoder evidence. `probeMedia` uses the same broker, only for installed reviewed media origins, with a 4 KiB ranged prefix or 1 MiB manifest cap. Its `representationId` is SHA-256 over sorted length-framed final URL, effective request headers/header origin, container, status, response validators/length/range, and probe bytes. This identifies a request/validator/sample tuple, not full-file identity or timeline equivalence. Raw fingerprint inputs are not persisted or logged. No `networkContext` is returned because sockets are not bound to one captured Android Network; the parent must use session-only evidence and decline cross-launch reuse. Parent playback must preserve header-origin confinement through redirects and nested media requests.

## Bridge contract

All inputs are maps, except no-argument `capabilities()` and `inventory()`. Duration `deadlineMs` means remaining milliseconds, clamped to 1–30,000, not an epoch timestamp. IDs must be unique per in-flight request.

- `installNuvio({pluginId})` / `installCloudstream({pluginId})`: only compiled-in reviewed IDs. No raw code, URL, archive path, or arbitrary registry input is accepted. Installation requires the parent UI's explicit user action.
- `resolveNuvio({requestId,pluginId,tmdbId,mediaType,season?,episode?,contentKey,profileId?,deadlineMs?})`.
- `searchCloudstream({requestId,providerId,query,page?,profileId?,deadlineMs?})`.
- `loadCloudstream({requestId,providerId,url,profileId?,deadlineMs?})`.
- `resolveCloudstream({requestId,providerId,opaqueData,contentKey,profileId?,deadlineMs?})`; `data` is an accepted alias.
- `cancel({requestId})`; cancellation also records a short bounded tombstone for a not-yet-started request.
- `readSettings({pluginId,profileId?})`, `writeSettings({pluginId,profileId?,settings})`, `nuvioSettings({requestId,pluginId,profileId?})`, `openCloudstreamSettings({pluginId})`.
- `probeMedia({requestId,url,headers?,headerOrigin?,container?,deadlineMs?})`.
- `inspectRepository({requestId,url,deadlineMs?})`: a separate metadata-only public HTTPS JSON fetch. No caller headers, auth, cookies, or request body; maximum 1 MiB strict UTF-8 JSON, duplicate/depth checks, public DNS, default port 443, no proxy, bounded redirects. Returns `document:{url,bodyText,byteLength,sha256}`. It cannot download/install/execute plugin packages and does not widen execution/probe allowlists. The parent must restrict calls to explicit manual intake and maintain its own quarantine ledger and bounded index traversal.

Request results contain `{requestId,contentKey?,status,sources?|items?|item?|probe?|document?,error?}`. Status is `ok`, `empty`, `unsupported`, `auth`, `timeout`, `cancelled`, or `error`. Error messages are sanitized. Source fields include `url`, `headers`, `headerOrigin`, `label`, optional `quality`, `container`, `downloadable`, `subtitleTracks`, `sourceId`, `providerId`, `providerVersion`, and `providerHash`. No timeline equivalence or decoded playback is fabricated. `contentKey` echoes the caller's identity, not a newly inferred mapping.

Cloudstream load items contain `name`, `url`, `mediaType`, `tmdbId`, `imdbId`, `mappingEvidence`, `data`/`dataUrl`, and `episodes[{name,season,episode,data,dubStatus}]`. The parent owns canonical mapping and exact fallback eligibility. Inventory distinguishes reviewed/installed/unsupported states and restores already installed reviewed providers after process restart; it does not install new plugins automatically.

## Original fixture and legal media

IDs: `cinetor-bbb-nuvio` and `cinetor-bbb-cloudstream`. Cloudstream provider ID: `cinetor-bbb-cloudstream:com.cinetor.fixture.BlenderProvider`.

Both resolve only **Big Buck Bunny (2008), TMDB movie 810**, an open movie by the Blender Foundation, under CC BY 3.0. Media URL: `https://media.w3.org/2010/05/bunny/movie.mp4`. Attribution: `https://peach.blender.org/about/`; license: `https://creativecommons.org/licenses/by/3.0/`.

A read-only HEAD request on October 24, 2026 returned HTTP 200, `video/mp4`, length 249,224,577 bytes, `Accept-Ranges: bytes`, and ETag `edadd81-4867d5d962e80`. This is not a full-byte SHA-256 pin, decoder check, or playback proof. Previous Blender direct `.mp4` paths were removed, Google sample endpoints returned 403, and the BBB3D endpoint failed TLS validation; no TLS bypass or broken URL is used.

The CS fixture is original Kotlin source, built separately from the host. It reads compiled Android resources, registers a real `MainAPI`, returns a non-URL opaque token, validates that exact token in `loadLinks`, and emits the open movie candidate. It has a real Android settings dialog and cooperative delay fixtures. The APK packager rejects runtime/host class definitions inside fixture DEX, constructs `.cs3`, hashes the compiled bytes, and embeds an immutable asset registry. The APK does not ship raw unreviewed remote extension code.

## CI-only build and validation

Prerequisites: Node/Expo installed by CI, JDK 17, Gradle wrapper from Expo prebuild, Android SDK platform 36/build tools, Kotlin 2.4.10, JitPack, and an API 35+ x86_64 emulator for device tests. Do not run these commands on the weak local computer.

Run from repository root in a fresh CI checkout, after Expo prebuild:

```sh
./android/gradlew -p android :cinetor-engines:assembleRelease -Pcinetor.fixtureBootstrap=true --no-daemon
python3 -I tools/fetch_engine_sources.py --prepare-fixture --host-aar modules/cinetor-engines/android/build/outputs/aar/cinetor-engines-release.aar
./android/gradlew -p modules/cinetor-engines/fixtures/cloudstream assembleRelease --no-daemon
python3 -I tools/fetch_engine_sources.py --package-fixture --fixture-apk modules/cinetor-engines/fixtures/cloudstream/build/outputs/apk/release/cloudstream-release-unsigned.apk
./android/gradlew -p android :cinetor-engines:connectedReleaseAndroidTest --no-daemon
./android/gradlew -p android :app:assembleRelease --no-daemon
```

`cinetor.fixtureBootstrap=true` permits only the intermediate native module AAR before compiled assets exist. Do not distribute or count that intermediate AAR as a finished app. Normal builds fail if the generated fixture asset/pin is missing. The separate fixture uses compile-only actual host/core API JARs; it does not copy fixture classes into the host.

Device tests are in `NativeEnginesInstrumentedTest.kt`. They cover real sync/promise/empty/throw/malformed/missing API/WASM behavior, native infinite-loop interruption, cancellation and promise timeout, runtime isolation, URL/DOM/digest round trips, profile settings, exact movie/TV inputs, external DEX/resources/registration, provider search/load/opaque links, and wrong opaque data/resource/ABI/traversal rejection. Network admission tests fail before external requests. Test deadlines are 100–5,000 ms; the engine maximum remains 30 seconds. There is no claim of general third-party provider success.

Reports: `modules/cinetor-engines/android/build/outputs/androidTest-results/connected/release/` and `modules/cinetor-engines/android/build/reports/androidTests/connected/release/`. `testReleaseUnitTest` has no dedicated JVM suite and must not be reported as runtime coverage. Module instrumentation targets the release library; the separately built final app still needs its own device startup/engine smoke evidence. The parent currently disables release minification and resource shrinking. Broad reflective keep rules preserve ABI requirements if shrinking is enabled in a later, separately verified build.

## Distribution source and license gate

Before publishing any APK, generate and attach corresponding source:

```sh
python3 -I tools/fetch_engine_sources.py --source-bundle --output artifacts/engine-corresponding-source
```

The output directory must not exist. Each upstream archive is fetched into a fresh empty directory without extraction or execution, copied into the release source bundle, and recorded in `SOURCE_RECEIPTS.json`. Archives cover immutable selected revisions of NuvioMobile, Cloudstream, NiceHttp, NewPipeExtractor, QuickJS-KT, Bellard QuickJS, and c-vector. Copy the exact Cinetor Git revision, original fixture source/build scripts, lockfile, and licenses alongside this bundle and the APK. The parent release workflow owns the full application dependency source/license closure and readable About/legal UI.

`--package-fixture` copies `licenses/engines` into APK assets at `cinetor/licenses/`. Verbatim GPL, Apache, and MIT texts plus `NOTICE.txt` are committed. The legacy root MIT notice is left untouched by this module. The combined application must not be represented as MIT-only. A later promise to fetch corresponding source is not a completed release gate.

## Remaining limitations

Compilation, release AAR hash checks, native tests, runtime interruption, resource loading, device playback, APK ABI/page-size inspection, and final app R8 behavior remain **NOT RUN** until CI produces evidence. Kotlin/AGP/JitPack/dependency closure compatibility must be established by that run. Android hidden `AssetManager.addAssetPath` acceptance is a device compatibility gate, not assumed proof. Third-party extensions remain disabled until their own source/hash/license/ABI/network review and device tests pass. Cloudstream cancellation cannot contain arbitrary same-UID hostile DEX. Encrypted Cinetor settings are profile-specific; upstream-style native settings remain plugin-global and must not be presented as profile-isolated credentials.
