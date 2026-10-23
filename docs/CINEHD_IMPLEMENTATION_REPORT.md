# Cinetor v1.1.1 CineHD Implementation Report

Date: October 23, 2026. Project: `/home/ASHRIN/Developer/netflix-clone`. Repository: [Xorashrin/cinetor](https://github.com/Xorashrin/cinetor). Release APK: [cinetor-v1.1.1-release.apk](https://github.com/Xorashrin/cinetor/releases/download/v1.1.1/cinetor-v1.1.1-release.apk).

## Recovered requirements and artifact findings

The recovered final request replaced earlier backend/source work with the supplied CineHD APKs, preserved the existing UI/tech stack, removed advertising, requested native search/playback/download behavior, and authorized creating the Cinetor repository, pushing code, and building an APK. The user explicitly deferred a TMDB credential field. Earlier phased BDIX/Cloudstream plans were superseded.

Both supplied APKs were investigated in the previous session. Only their Hermes bundle differs: one uses direct TMDB and the other prefixes TMDB with the public AutoEmbed metadata proxy. All 19,485 function bytecodes match. The supplied APKs use React Native/Hermes and include Unity Ads; Cinetor does not add that SDK or its ad links. Detailed artifact hashes and request evidence are in [APK-FINDINGS.md](cinehd-evidence/APK-FINDINGS.md). Raw analysis remains local because it contains third-party credentials.

## Delivered behavior

| Feature | Implementation |
| --- | --- |
| Title/thumbnail/metadata | Persistent TMDB metadata through the observed public proxy, real poster/backdrop/episode still URLs, cast, directors, year, runtime, and external IMDb identifiers. |
| Search and suggestions | 350 ms debounced remote search; typed results appear while editing; Unicode matching and relevance/newest/rating/title sorting. |
| Organization | Home excludes Anime/K-Drama; dedicated feeds use metadata classifications. Adult remains age gated and empty. Live TV contains current directory candidates. |
| Details and episodes | On-demand metadata, real seasons/episode names/stills, season loading, episode navigation. |
| Native playback | Recovered AWSIND request chain, bounded MP4/HLS probes, native play/pause/seek, resume, source selection, automatic fallback, speed/lock, and actual player audio/subtitle tracks. |
| Downloads | Direct MP4 and finite HLS packaging with three concurrent resource workers, provider headers, progress, cancellation, failed-file cleanup, deletion, and app-local playback. MP4 can also export to device storage. |
| UI | Existing dark colors, fonts, Expo/React Native/Reanimated, shared components, layouts, and navigation retained. About/version values updated to 1.1.1 (6). |
| Advertising | No advertising SDK, direct ad link, or browser embed player is added. Unsupported HTML media responses are rejected. |
| Refresh | Nonblocking startup, independent provider outcomes, cached browsing, background registration, live/catalog subscriptions, and immediate eligibility after cancellation. |

## Verification evidence

30/30 deterministic tests pass, TypeScript passes, Expo dependencies match SDK requirements, Expo Doctor passes 20/20 checks, and the Android bundle exports. Fresh verification is recorded through the installed Gravitas validator.

Live checks passed for 78 initial titles, 22 Anime titles, 21 K-Drama titles, Oppenheimer search/details/cast, Game of Thrones seasons/episode artwork, 45 browser registry entries, 1,000 IPTV candidates including 22 Bangladesh channels, three native HLS language sources, persistent cache hydration, and an offline HLS package plan with 2 playlists/2,159 resources. See [live-verification.json](cinehd-evidence/live-verification.json) for timestamped observations.

The [Android workflow](https://github.com/Xorashrin/cinetor/actions/runs/39914516525) completed successfully and published v1.1.1 from commit `381e421a3959eabe73d7787dbff11dc15c3847c3`. The downloaded APK is 91,579,957 bytes, is nondebuggable, contains armv7/arm64/x86_64 and embedded Hermes bytecode, and passes v2/v3 signature verification. Its SHA-256 is `8ef5f4a6579de61a0032069ac622f93d3b7697feaa64ad9c9d7dca79f3ab0895`. The release uses Android's debug certificate; private distribution signing is not configured.

Runtime verification found that the first v1.1.0 APK crashed in WorkManager/Room initialization before JavaScript started. That artifact remains a prerelease. Release minification and resource shrinking are disabled for the replacement, and the signed APK must render Home on an Android 15 emulator before the workflow publishes it. v1.1.1 uses a new tag and version code to preserve the failed preview's identity.

The player previously started an empty media item during initialization and could navigate back on its completion event. It now starts after attaching the resolved source and ignores completion until valid media time exists. The exact signed release passes Android 15 Home startup both in CI and locally. Local UIAutomator briefly returned an empty tree during startup; a bounded retry confirmed the visible Home screen without an application error.

The diagnostic APK completed a 1.3 GB finite HLS download. After upgrading to the exact signed v1.1.1 APK, the retained download played with Wi-Fi/mobile data disabled, restored saved progress, advanced continuously, paused, and deleted successfully. The published APK also passed remote search, real movie details/cast, native HLS decoding, pause, and ten-second seeking. Source switching, persisted resume, and ATN Bangla live playback also passed on that release. Android reports an unknown position (`-1`) for this live channel; playing state and changing video frames confirmed playback. See [android-runtime-verification.json](cinehd-evidence/android-runtime-verification.json) for checksum-bound observations. These observations establish sampled decoder/transfer behavior, subject to the upstream content issues below.

## Practical limits

The recovered registry describes browser embeds; only the AWSIND native path is implemented. 45 registry entries do not imply 45 playable native providers. Title/language coverage and uptime vary. Sports browser embeds, drama scraping, radio, third-party subtitle credentials, and a native adult catalog are not implemented. The website's protected browser behavior was not captured; this implementation relies on saved APK evidence and successful live endpoint checks.

HLS downloads require finite, supported manifests. Live HLS, DRM, byte-range layouts, and unsupported URI tags fail explicitly. Downloaded HLS stays inside Cinetor with the selected video and default alternate audio. It is not converted to a standalone MP4 or exported to the gallery. MP4 device media export, subtitle selection, and OS background execution still require runtime evidence. Emulator checks cover Android 15/x86_64; physical ARM devices have not been tested.

Visual verification found an upstream content problem: the Bengali stream returned for Oppenheimer showed a different film, and the Tamil stream contained a betting watermark inside the video. The app requested the correct IMDb ID, `tt15398776`, and the provider page explicitly identified Oppenheimer. Valid containers and successful decoding do not establish correct content or an ad-free upstream file. The app adds no ad SDK or browser player; baked-in watermarks cannot be removed by skipping browser advertising. No copied third-party TMDB key is used, and no credential field was added.
