# Cinetor Engine Architecture

## Host and interface

The app retains Expo SDK 58, React Native 0.88, React Navigation, Hermes, and Reanimated. Native integrations live in `modules/` and survive clean Expo prebuild. Durable Android policy belongs in `app.json` and `plugins/withCinetorAndroid.js`, not ignored generated Android files.

Home, Anime, K-Drama, Others, and Profiles are the primary tabs. Metadata search/details are independent from playback. Live TV is a separate directory. Adult content is disabled and empty. Missing metadata remains unknown, and historical ranks or provider counts do not become verified catalog labels.

## Exact identity

Movies use `tmdb:movie:<id>`. TV playback/downloads use `tmdb:tv:<id>:s<season>e<episode>`, including explicit season-zero specials. A series-only ID is not a playable episode. Cloudstream must map its actual external-ID sync data and preserve exact opaque provider episode data. BDIX requires an explicit saved canonical mapping; filenames and title similarity do not establish identity.

`src/engine/contracts.ts` defines canonical references. `pluginContracts.ts` normalizes source candidates and origin-confined headers. `PlaybackControl` distinguishes candidates by their provider, artifact, content, representation, network/access context, and source locator. Reusing one URL does not make two representations interchangeable.

## Native engines

- **BDIX:** Explicit endpoint consent and selected Android Wi-Fi transport, validated FTP passive data routes, TLS/cleartext policy, bounded spooling, and native-only localhost registration. No scan, subnet discovery, or guessed login is present.
- **Nuvio:** Native Kotlin/QuickJS instances with bounded heap, stack, deadlines, host APIs, interruption, and I/O cancellation. Provider code never enters unrestricted React Native JavaScript.
- **Cloudstream:** Pinned 4.8.0 API, read-only private DEX staging, resources, registration, search/load/loadLinks, settings, and opaque-data validation. Code runs with the app UID; cancellation is cooperative. The classloader is not a sandbox.

Only `cinetor-bbb-nuvio` and `cinetor-bbb-cloudstream` are executable extensions. Both resolve Big Buck Bunny. Engine implementation, library availability, a parsed manifest, or a publisher flag does not establish broader compatible provider coverage.

## Repository separation

`src/providers/repositories.ts` owns saved repository declarations, bounded descriptor/index parsing, change counts, failures, and quarantine metadata. `CinetorEngines.inspectRepository` supplies DNS-filtered HTTPS JSON bytes and their hash. The app calls it only after explicit manual intake confirmation. One refresh reads the root and at most four declared indexes, with a 2 MiB aggregate limit and one 45-second deadline.

Repository metadata is not fed into `ProviderRegistry`, the native artifact store, or runtime admission. Publisher SHA-256 claims and status values remain claims. Invalid entries are recorded without secret-bearing URLs. No artifact is downloaded or executed by repository intake.

## Resolution and cancellation

Two shared resolver slots, two probe slots, and two transfer slots bound app work. A shortlist includes at most two remote adapters. Known-local resolution receives an approximately 750 ms hedge and a 1,500 ms preference hold; it never triggers discovery.

A playback attempt has one original 45-second startup/recovery deadline, at most three automatic switches, and one refresh per stable candidate. Rendering does not reset recovery allowance. Manual selection after that window has a bounded player load wait but no new automatic recovery budget. Stop, profile changes, backgrounding, and observed network changes invalidate active playback. Late callbacks must match their request and attempt IDs.

## Transport and decoder evidence

Remote media probes use the native DNS-safe broker. Global cleartext is disabled; only exact `127.0.0.1` has an Android exception for native-registered BDIX capabilities. Headers are origin-confined through redirects, child manifests, segments, keys, and captions. Syntax-level URL validation alone is not DNS safety.

A native remote representation digest covers the observed request, validators, and probe sample. A BDIX spool has an independent non-capability UUID. Neither is an independently compatible timeline ID or a full-file checksum. Position carries across sources only with compatible timeline identity.

`PlaybackEvidenceStore` v2 records only real rendered-first-frame events and exact provider/artifact/content/representation/access/device/network context. It never saves source URLs, headers, or native tokens. Default-routing identity is not stable enough for proof reuse, so the app uses per-launch device identity and per-resolution remote network context. Old v1 provider-only proof is not migrated as trusted evidence.

## Downloads and profiles

Media3 owns persistent downloads and a foreground lifecycle. MP4, finite non-DRM HLS (including AES-128 identity keys), and finite clear DASH are eligible. Native planning validates child playlists and exact 16-byte AES keys; DRM remains unsupported. MKV/WebM are online-only. Partial transfers restart at zero; cross-provider appends and automatic retries are not implemented. Byte ranges require exact 206/416 handling and reject changed known validators. Download range assembly additionally requires strong validators; ordinary online range playback does not. An offline miss never falls back online.

Profiles own list/progress/settings/download metadata. Native keys include profile identity. Mutations and storage writes are serialized; failed hydration does not silently overwrite unreadable data. Imports strip native IDs, local paths, saved-file claims, and timeline capabilities. Imported download rows cannot open foreign files. Deletion uses the native owner once, not a second path-based delete after removing ownership. Legacy private files without a native record use the native path validator.

## Verification and distribution

All execution belongs to GitHub Actions. The workflow separately gates TypeScript tests, native BDIX/media test XML, real engine instrumentation, signed universal APK inspection, and Android 15 startup. Missing test suites are failures, not NO-SOURCE success. Startup is not decoded playback coverage.

The combined app contains GPL-3.0-only engine material and retained third-party notices. Source archives, the exact Cinetor revision, fixture build provenance, and license texts accompany the passing Actions APK artifact. The original Expo MIT notice does not make the combined app MIT-only. See `NATIVE_ENGINE_PROVENANCE.md` and `LICENSES.md`.
