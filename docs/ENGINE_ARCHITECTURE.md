# Cinetor CineHD Architecture

## Replacement and preserved UI

The user superseded the previous BDIX work and requested the CineHD contracts from two supplied APKs. The prior implementation remains recoverable in Git history. This release removes its source registry, directory parsers, network scanner, verification catalog, and legacy tests from the active app.

Theme tokens, typography, shared visual components, React Native/Expo stack, and navigation retain their existing design. Screen changes connect real provider data and native controls.

## Modules

| Module | Responsibility |
| --- | --- |
| `src/providers/client.ts` | TMDB/proxy request construction, two-request concurrency, independent cancellation, cache, body/timeout limits. |
| `src/providers/metadata.ts` | Metadata mapping, persistent catalog, classification, on-demand detail/season loading. |
| `src/providers/search.ts` | Unicode normalization, matching, relevance/newest/rating/title ordering. |
| `src/providers/request.ts` | Public HTTPS validation, redirects, bounded reads, timeout/cancellation. |
| `src/providers/streams.ts` | Domain discovery, ephemeral playlist contracts, MP4/HLS transport probes, mirrors and recent failure suppression. |
| `src/providers/registry.ts` | Observed embed registry metadata; never passes browser pages to native playback. |
| `src/providers/live.ts` | Current IPTV directory mapping, candidate ranking, separate persistent snapshot and request headers. |
| `src/providers/offline.ts` | Local HLS manifest planning and a bounded three-worker resource queue. |
| `src/services/downloads.ts` | Native file transfer, cancellation, cleanup, HLS packaging, and MP4 device export. |
| `src/engine/runtime.ts` | Shared providers, UI catalog publishing, independent refresh outcomes, playback adapters. |
| `src/engine/useEngine.ts` | Nonblocking startup, app/network lifecycle, metadata/live subscriptions, background registration. |

## Startup and playback

App/font/state failsafes render navigation independently of provider refresh. Cached metadata and live channels load without a complete scan. Providers refresh independently; a failed registry or live endpoint does not erase successful metadata. A canceled refresh remains eligible when the app returns online.

Title playback resolves only native streams. The resolver fetches an IMDb-based page, extracts the per-response playlist values, and returns independently probed source choices. The player preserves position and play/pause state when switching sources, reports decoder failures, and tries other cached alternatives. A live channel tries candidate mirrors sequentially and aborts pending verification on navigation.

Metadata stays separate from media URLs, so posters/search/detail pages remain responsive while streams resolve. Normal navigation does not display raw endpoints, CSRF tokens, source filenames, or parser diagnostics.

## Verification boundaries

The registry's 45 browser providers are not 45 native playback adapters. Sports, drama scrapers, radio, external subtitle credentials, and a native adult catalog are not reconstructed in this release. Native media uses the recovered AWSIND path; its coverage and availability vary by title/language/network. Android WorkManager controls actual background scheduling. Unit tests do not establish device or OS behavior.
