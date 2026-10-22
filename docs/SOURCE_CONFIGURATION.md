# Authorized source configuration

`src/engine/config/sources.json` is deliberately empty. Supply actual endpoints you own or have permission to index. Being reachable through an ISP is not authorization. There is no IP-range scan, ISP-host enumeration, guessed endpoint or credential bypass.

Sources may also be provisioned through `sourceRegistry.configure()` into the versioned AsyncStorage registry. This developer/provisioning interface is not exposed as a parser navigation screen. After changing configuration, restart the engine/application to reload and republish. Use a source-specific ID and origin/path scopes; CDN media and artwork origins must be explicitly scoped too. Sources are independent: a BDIX-only host failure does not prevent internet-host discovery or cached browsing.

Supported adapters: `json` (array or `{items:[]}`), `html-directory` (anchor listings, bounded downward traversal), `m3u` (EXTM3U + EXTINF channel playlist), `direct` (explicit metadata plus endpoint). All use HTTP(S). An ISP's so-called FTP server with an HTTP directory is supported through `html-directory`. Direct FTP/FTPS, XML catalogs, DASH, arbitrary scraper JavaScript, encrypted/DRM HLS and unsupported containers are rejected. There is no implicit HTTP-to-FTP gateway.

Example schema below is a template; the `.invalid` hostname is intentionally unusable and is NOT bundled as a source:

```json
{
  "id": "my-authorized-media",
  "authorized": true,
  "enabled": true,
  "protocol": "https",
  "endpoint": "https://your-authorized-host.invalid/media/",
  "adapter": "html-directory",
  "scopes": [{"origin": "https://your-authorized-host.invalid", "pathPrefix": "/media"}],
  "expectedContentTypes": ["text/html"],
  "kind": "movie",
  "category": "home",
  "timeoutMs": 8000,
  "retries": 1,
  "minRequestIntervalMs": 500,
  "refreshMs": 21600000,
  "maxResponseBytes": 524288,
  "maxDepth": 2,
  "maxPages": 20,
  "allowPrivateNetwork": false,
  "restricted": false
}
```

Set `allowPrivateNetwork:true` only for a deliberately authorized local/private source. Scope validation blocks literal private addresses and local/internal names by default. DNS resolves at the platform layer: the JavaScript layer cannot reliably detect DNS rebinding or prove a public hostname resolves publicly. Only provision trusted origins; this is not an arbitrary URL-fetch service. HTTP remains enabled for authorized BDIX hosts. HTTPS is preferred; redirects cannot downgrade HTTPS or forward authentication across origins.

JSON items contain `title`, `url`, `kind` (`movie`, `series`, `channel`), `category` (`home`, `anime`, `kdrama`, `live`, `adult`), optional `year`, `language`, `edition`, `genres`, `poster`, `backdrop`, `synopsis`, `rating`, `runtime` (minutes), `country`, `season`, `episode`. Series require positive season/episode coordinates. K-Drama requires Korean-language series plus explicit category. Anime requires explicit category or source convention. HTML filenames provide conservative title/year/episode extraction; unknown categories/kinds stay unpublished. Unknown ratings and artwork are not fabricated. M3U channels remain distinct from movies/series.

For mirrors, matching `canonicalId` + `identityNamespace` is a trusted identity assertion by the configured catalog. Otherwise cross-source merge needs matching title/year/kind/category/language and explicit edition. Unknown editions/years stay source-scoped. Episode sources are grouped only within the same series identity and coordinates.

Authentication: source `authRef` points to a SecureStore key. Provision a JSON object of `Authorization` and/or `X-API-Key` request headers using `SecureStore.setItemAsync` in trusted device provisioning. No secrets belong in sources.json, repository, APK, diagnostics or chat. Credentials are loaded at request/player time and sent only to the endpoint's origin. Cookie auth and signed URLs are unsupported in this release; secret-bearing URL parameters are rejected. Artwork needing headers is not supported by the current image UI.

Restricted sources require `restricted:true`, `category:"adult"`, `legalContentAttested:true`, source authorization and an appropriate real-world access policy. Only legally distributable consensual adult material is eligible; this engine cannot determine age/consent/legal rights from filenames. General sources reject adult flags and explicit adult metadata. Restricted discovery runs only after the existing 18+ confirmation for the current session, never in scheduled background work. Adult channels and movies/series appear only there; nothing restricted enters general title arrays/search. Session access resets when the app leaves the foreground. Self-declared age confirmation is the current app safeguard; it is not identity-based age verification.

Publication gate: MP4 bounded byte range with recognized ftyp brand, or unencrypted HLS manifest with a scoped, signature-valid TS segment (or fragmented MP4 plus init segment). Listing success/extension/nonempty URL do not publish. Transport verification cannot prove codec decoding; `decoder:unverified` remains explicit until playback emits progress while playing. The player reports failures and switches to a verified same-content/episode alternative. Previously published content stays cached during temporary failures; cooldown health influences playback selection. Probing reads bounded prefixes and cancels the stream even when Range is ignored; a server/native transport can still send/buffer some extra bytes before cancellation.

Scheduling: initialization loads cache independently of first render; foreground scans use two source workers and 90s batches, background batches 20s and eight candidates per source. Candidate/page checkpoints persist after each result. A lease blocks overlapping work and expires after interruption. Source cooldown/refresh times and HTTP cache validators persist; HTML trees refresh within bounded traversal rather than treating a root 304 as evidence all child folders are unchanged. Foreground timers schedule only foreground work. Expo BackgroundTask/TaskManager uses Android WorkManager with connected-network constraints and an inexact 15-minute minimum interval. Android can defer jobs; force-stop prevents execution until relaunch. No continuous service or permanent notification is added.

Diagnostics: development-only App Settings prints codes, stage counts, timing, mode and per-source status; it excludes endpoints, checkpoint URLs, headers and exception messages. Empty source initialization reports idle/zero configured, never a successful scan. Storage errors and registration failures are observable.
