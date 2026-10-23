# CineHD APK Static Findings

Investigation date: October 23, 2026. Both supplied APKs were read without installing or executing them. REA archive evidence was collected by the root agent; Android JADX inspection was unavailable because the REA JADX bridge was not configured. Existing AAPT2 and an offline Hermes v96 parser/disassembler were used to recover additional package and request facts. All observations below are static unless explicitly identified otherwise.

## Artifact identity and exact difference

| Artifact | SHA-256 | ZIP members |
| --- | --- | --- |
| CineHD-v1.1.4-(Universal).apk | b5dbde0140faa20b48da87e23e1ec2c0d45df7f84037df5b0c2f1948639da875 | 1,922 |
| CineHD-v1.1.4-(Universal)(1).apk | 9d41ba2ae4da328491b2773580861f9b56cce06481ff97113ff96a159d90959d | 1,922 |

REA archive evidence IDs: `ev_9c531cbc20ee22e8b267de3028fa5572fe657bb692526843deba3a0434eac197` and `ev_927e8b58796c4caee1b0ebf44c3d9358d627b150056f4c5b2363fd752f23d54a`.

The two archives contain identical member sets. Only `assets/index.android.bundle` differs. All 19,485 functions have identical bytecode bytes in both bundles. Both bundles contain 29,799 decoded strings. Exactly one string changes: the first APK uses `https://api.themoviedb.org/3`; the second uses `https://autoembed.app/aproxy/proxy.php?url=https://api.themoviedb.org/3`. The second string is 44 bytes longer. This establishes a metadata proxy variant; it does not establish the proxy's current availability or authentication policy.

Evidence: `apk-comparison.json`, `hermes-version-comparison.json`, `function-bytecode-comparison.json`, and the two member inventories.

## Package and stack

AAPT2 reports package `com.cinehd`, version name `1.1.4`, version code `1`, minimum SDK 24, target SDK 35, and launch activity `com.cinehd.MainActivity`. Native payloads include React Native, Hermes, Reanimated, gesture handler, SVG, screens, and slider libraries across arm64, armv7, x86, and x86_64. The main JavaScript bundle is Hermes bytecode version 96. Flutter payloads are absent from the member inventory.

Permissions include Internet, network state, wake lock, external storage, Google advertising ID, ad services topics/attribution, foreground service, and boot completion. The manifest declares Unity Ads initialization. Evidence: `apk-badging.txt`, `AndroidManifest.txt`, and member inventories.

## Metadata requests

Recovered bytecode constructs TMDB GET requests for:

| Feature | Contract |
| --- | --- |
| Catalog rails | `/{movie|tv}/{list}` with language, page, and API key |
| Discovery and sorting | `/discover/{movie|tv}` with release year, genres, sort order, original language, and watch provider filters |
| Unified search | `/search/multi` with `include_adult=false`, `language=en-US`, query, and page |
| Type-specific search | `/search/{movie|tv}` with the same search parameters |
| Detail | `/{movie|tv}/{id}` |
| Trailer | `/{movie|tv}/{id}/videos` |
| Cast | `/{movie|tv}/{id}/credits`, reading `cast` |
| Recommendations | `/{movie|tv}/{id}/similar` |
| Images | `/{movie|tv}/{id}/images` |
| Seasons | `/tv/{id}/season/{number}`, reading `episodes` |
| Person | `/person/{id}` and `/person/{id}/{movie|tv}_credits` |
| Stream identifier | `/{movie|tv}/{id}/external_ids`, reading `imdb_id` |
| Watch providers | `/watch/providers/{movie|tv}` with region |

Image literals use `https://image.tmdb.org/t/p/` and sizes `w300`, `w500`, `w1280`, and `original`. Trailer thumbnails use YouTube image URLs. A third-party TMDB key is embedded in the APK; its value is intentionally omitted and must not be committed or reused as a project credential. API availability and authorization are not established by the recovered key.

Evidence: Hermes functions #12164–#12230; sanitized copies in `sanitized-contracts.hasm`.

## Source and proxy systems

The registry is fetched from `https://raw.githubusercontent.com/michel8899/embed-proxy/main/providers.json`, with a 15-second request timeout, Accept JSON, an in-flight promise shared across requests, and a time-based cache. Registry parsing requires a nonempty `providers` array. Provider matching is case-insensitive and also ignores whitespace. A provider contains movie/TV URL configuration and can declare `noSeasonEpisode`; URL placeholders are replaced with the requested ID, season, and episode. The registry returns browser embed URL contracts, rather than proven native media streams.

The fallback bundle has embed templates for Videasy, Vidlink, Vidfast, Vidrock, Vidnest, Vixsrc, Peachify, XP, Vidking, Vidup, Primesrc, 111movies, Cinemaos, Mapple, 2Embed, Vidzee, Frembed, Moviesapi, Superflix, and other language-specific providers. Domain names and a stored URL do not establish that a provider currently works or that its player is ad free.

The native Allmovieland path uses this sequence, statically recovered from functions #18002 and #18011–#18014:

1. GET `https://allmovieland-proxy.60-60.workers.dev` with a 10-second timeout; read and validate HTTPS `awsIndStreamDomain` from the JSON body.
2. Fetch TMDB external IDs concurrently; require the title's IMDb ID.
3. GET `{domain}/play/{imdb_id}` with a desktop Chrome user agent and a Vegamovies referer. Extract JSON string values named `file` and `key` from the HTML. The key is a per-response CSRF value, not a static project credential.
4. Normalize the file value: an absolute URL is retained; `~id` becomes `{domain}/playlist/{id}.txt`; other relative values are prefixed with the domain.
5. POST to the playlist with an empty body and form content type; send the page's origin, referer, and extracted `x-csrf-token`.
6. Movie JSON may wrap an array in `folder`; TV chooses `[season-1].folder[episode-1].folder`.
7. For each leaf with `file`, remove the tilde and POST `{domain}/playlist/{file}.txt` with the same headers. The response body is the native media URI; return `{uri,label:title,headers}`. A direct `.m3u8` string is also accepted.
8. Return `{videos, subtitles}` and filter failed leaf results. Failure paths return empty arrays.

The worker root is a domain-discovery proxy. No generic JSON resolver for all browser embeds was recovered. Native playback, seek behavior, and downloadable media availability still require successful live resolution and device playback evidence.

## Subtitles, live TV, sports, drama, and radio

Subtitles use `https://sub.wyzie.io/search?id={imdb_id}` with a packaged third-party credential that is omitted here. The response is deduplicated by language and mapped to title, language, URI, and VTT/SubRip content type. Credential-free behavior was not established.

IPTV-org URLs include `https://iptv-org.github.io/api/{channels,streams,logos,countries,categories}.json`. These supply public channel directory metadata and candidate stream URLs. Stream codec and current transport availability cannot be inferred from the JSON directory.

Sports use `https://streamed.st/api/sports`, `/api/matches/{sport}`, `/api/matches/live/popular`, and `/api/stream/{source}/{id}`. Browser embeds are returned in this subsystem. Other sports/live literals include `https://dlhd.st`.

Drama pages use `https://dramacool.sh/`; recovered routines fetch listings, parse image/title entries, fetch episode server pages, and parse embed server rows. Radio uses `https://de1.api.radio-browser.info/json` and country/station query paths. These are independent subsystems, rather than one backend API.

## Advertising evidence

Unity Ads bridge calls, `Interstitial_Android` placement, Unity SDK initializer, and Open Measurement ad-viewer JavaScript are present. The bundle also sets `direct_link_ads=true`, stores an external ad landing URL, and reads it before navigating. Browser provider pages can independently load ads. Removing native ad modules alone would not establish an ad-free experience if third-party browser players are still loaded.

Evidence: manifest; Hermes functions around #13495–#13511; constants in #17912; direct-link reads near line 728828 of the raw disassembly.

## Coverage and unknowns

Answered: exact two-package difference; React Native/Hermes stack; declared permissions; metadata URL assembly; registry shape and caching; native Allmovieland request sequence; packaged ad mechanisms.

Partially answered: live TV, sports, drama, radio, subtitle, and download contracts. Their strings and selected bytecode were inspected, but complete subsystem tracing was outside this worker's scope.

Unresolved: current backend uptime, Cloudflare/browser challenges, provider codec/container support, native device playback and seek/download behavior, third-party credential authorization, protected/encrypted provider internals, and server-side implementation. Static package inspection does not recover server source code or prove runtime behavior.

Raw decoded strings, pseudocode, and full disassembly contain third-party credentials and must remain local. Publish this report or the sanitized contracts only. The analysis-tool source was acquired inside this analysis directory and no MCP/client configuration was modified.
