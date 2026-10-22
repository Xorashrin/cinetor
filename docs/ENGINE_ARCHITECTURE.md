# Cinetor catalog engine rebuild

## Reconnaissance (2026-10-22)

Baseline: `c75d375e75f7a5ad382a896cdf72e1b8a2fafaeb`, clean main; TypeScript passes. No tests remain. Expo 58 / React Native 0.88 / Hermes / expo-video. App renders without awaiting fonts or profile storage, with 1s/1.8s splash failsafes. Preserve those. Screen layouts consume empty mutable arrays in `data/mock.ts`; catalogVersion and playback source references survive. Live TV is bundled separately; Adult contains fabricated sample-video channels, which must be retired.

The removal commit explicitly requests a lightweight blank application; it does not document a crash root cause. Inspection of its parent reveals concrete defects: fictitious automatically seeded `.internal`/`.local` sources, an FTP adapter without native transport, timers presented as background scheduling, extension fallback after an inconclusive media signature, and an unbounded arrayBuffer fallback. None of those behaviors will be restored. Old cache records lack trustworthy verification evidence and will not be promoted to the new catalog.

## Decision and scope

Policy: planning=deep, context_depth=dependency, verification_depth=full, delegation=conditional reviewer; reasons=engine rebuild, stateful persistence, network safety, native scheduling, production release. Write scope: src/engine, catalog/UI integration in src/data/src/state/src/screens, index.ts, app.json, dependency manifest/lock, tests, docs, release workflow/tools. Keep navigation, startup failsafes, downloads and feed designs.

The user explicitly authorizes implementation, safe schema migration, Android release configuration, commit and push to main. No destructive legacy-cache migration, force push or credential changes are needed. Release risk: native-module/version incompatibility or misleading signing claims. Mitigation: Expo validation, locked dependency install, regenerate native project, release build and APK inspection; label the existing debug-certificate signing accurately unless private distribution signing is supplied.

## Minimal complete architecture

- `model.ts`: versioned internal records, source policy, stage and verification contracts.
- `sources.ts` + `config/sources.json`: persistent validated allowlist; no default endpoints, secrets or host scanning. HTTP(S) JSON catalogs, one-level HTML directory pages, M3U playlists and explicit direct references. FTP/FTPS and arbitrary XML are unsupported.
- `security.ts`: origin/path scopes, private-address opt-in, credential-free URLs, safe manual redirects, safe artwork, endpoint-free diagnostics.
- `network.ts`: injected streaming transport (Expo native fetch in production), connectivity, absolute request deadline, bounded reads, cancellation, backoff/jitter and per-source pacing.
- `parsers.ts`, `metadata.ts`, `classifier.ts`: independent validated parsers, Unicode normalization, explicit metadata first, conservative categories and deterministic content/episode identities. Mirrors merge only with matching trusted identity or complete edition metadata.
- `verifier.ts`: bounded byte-range MP4 signature or HLS manifest plus bounded child/segment probe. Never publish from an extension or listing; unsupported/DRM manifests stay unverified. This is transport/container evidence, not a guarantee of codec decoding. Actual player failures mark source health and trigger same-content fallback.
- `catalog.ts`: versioned journaled AsyncStorage snapshot with backup recovery, incremental upsert, stable identity, verified-only feed queries. Legacy cache remains untouched. User-facing content never contains source records.
- `resolver.ts`: healthy verified same-content/episode mirrors, temporary player failure cooldown.
- `scheduler.ts`: eligible per-source refresh/circuit cooldown, bounded foreground/background batches, persisted checkpoints and lease for interrupted process recovery; no overlapping runs.
- `diagnostics.ts`: sanitized stage/outcome counts and source IDs/error codes only.
- `background.ts`: module-scope Expo TaskManager definition and Expo BackgroundTask registration (Android WorkManager, connectivity constraint), bounded restartable scans. OS deferral/force-stop limitations apply.
- `runtime.ts`, `ui.ts`, `lifecycle.ts`: singleton dependency composition, cache publication before discovery, AppState foreground/resume and connectivity wakeup, screen-independent execution. No parser tab. Development-only settings diagnostics.

## Persistence and publication

Separate source configuration, scheduling state and content snapshots. Valid updates commit incrementally; refresh failures do not delete previous content. Corrupt primary loads backup; invalid records are skipped. Secret references resolve from SecureStore at request/player time; never persist authentication headers. Publication requires explicit kind/category, clean title, episode coordinates for series, and verified transport evidence. General adult-like metadata is rejected; restricted sources require configured age/access approval and legal-content attestation, and run only after the app's age gate for that session. Restricted content stays out of general search and feeds.

No configured authorized BDIX endpoints currently exist. A successful empty initialization is not a successful source scan. Live-source and device checks are separate from deterministic fixture tests and remain NOT VERIFIED unless actually executed.

## Verification contract

Test parser malformed/Unicode/scope cases; timeout/cancellation/retry/ISP variation; strict gate, dedupe/edition/episode identity; cache corruption/migration/partial failures; lifecycle overlap/registration/interruption; all five feed boundaries. Run typecheck, tests, Expo dependency and doctor checks, production bundle, native release workflow, APK manifest/signatures/hash inspection. Install/run only if adb provides a device. Report exact commit/run/artifact and all unavailable runtime checks.
