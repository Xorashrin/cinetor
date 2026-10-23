# CineHD Provider Configuration

Version 1.1.1 replaces the previous BDIX/JSON/directory/M3U discovery subsystem with CineHD provider adapters. There is no server configuration screen and no TMDB credential field, as requested.

## Active contracts

| Purpose | Endpoint | Behavior |
| --- | --- | --- |
| Metadata without a project key | `https://autoembed.app/aproxy/proxy.php?url=` | Proxies TMDB requests; preserves nested URL encoding. |
| Metadata with a future project key | `https://api.themoviedb.org/3` | Set `EXPO_PUBLIC_TMDB_API_KEY` at build time; the app switches to direct TMDB. |
| Posters and episode stills | `https://image.tmdb.org/t/p` | Restricted image paths and documented image sizes. |
| Native media domain discovery | `https://allmovieland-proxy.60-60.workers.dev` | Reads `awsIndStreamDomain`, then resolves IMDb IDs through page/playlist requests. |
| Browser provider registry | `https://raw.githubusercontent.com/michel8899/embed-proxy/main/providers.json` | Parses/caches registry metadata; browser embed URLs are not used by the native player. |
| Live TV directory | `https://iptv-org.github.io/api` | Channels, streams, logos, countries, and categories joined into native stream candidates. |

The public metadata proxy works without a copied credential in the observed checks. Its service is external and can change. `EXPO_PUBLIC_` configuration is embedded in the APK; it is not a secret vault. No third-party API key recovered from CineHD is committed or reused.

Requests use Expo's streaming fetch, bounded body reads, explicit timeouts, cancellation, and public HTTPS URL validation. Ephemeral CSRF tokens stay in the request flow and are excluded from playback/download headers. URLs returned by trusted providers can still resolve through platform DNS; JavaScript validation does not establish DNS-level isolation.

Metadata and live directory caches persist independently. Cached browsing does not require stream verification. Media references expire quickly and are resolved on demand. Stream probes inspect MP4 headers or HLS manifests and a bounded segment; actual decoder compatibility requires playback.

Offline HLS supports finite playlists, the selected video rendition, default alternate audio, initialization segments, and ordinary AES-128 keys. Live playlists, DRM, byte-range layouts, and unsupported manifest URI tags fail explicitly. Downloads preserve provider headers. HLS files remain in app storage, and deleting an HLS download removes its package directory. MP4 can additionally be exported to the Cinetor media album.
