# BDIX Engine

## Status and boundary

This is a real, opt-in Android transport and exact-mapping provider, not an inventory of working servers. It is implemented but **has not been built or tested in this checkout**. No ISP/public/private server was probed during development. Reachability, peering, codec compatibility, first-frame playback, and device network-loss behavior remain unverified until authorized cloud/device tests run.

The engine is confined to `modules/cinetor-bdix`, `src/providers/bdix.ts`, `src/providers/bdix/`, its tests, and this document. It does not change the app, workflow, shared contracts, runtime, state, or UI. `ProviderHttp` remains public-HTTPS-only. BDIX uses its own consent-scoped native transport because React Native fetch cannot guarantee routing through a selected Android `Network`.

Importing the engine or native bridge makes no network requests. There is no bundled host list, subnet discovery, startup scan, search scan, public scan, guessed URL, or remote filename fallback. An explicitly configured endpoint is permission for that endpoint and root only, not permission for adjacent IP addresses or ports.

## Endpoint consent and identity

The host persists endpoint settings only after an explicit user approval. Empty settings are the default. `configure` does not persist settings or start indexing. The host must not re-approve endpoints programmatically after the user revokes them.

```ts
interface BdixEndpoint {
  id: string;
  name: string;
  url: string;                  // Directory root ending in '/'; no auth/query/fragment.
  enabled: boolean;
  allowPlainFtp: boolean;        // Separate unencrypted FTP approval.
  allowCleartextHttp?: boolean;  // Separate unencrypted HTTP approval.
  network: 'wifi';
  anonymous?: boolean;          // Explicit anonymous FTP account approval.
  credentialRef?: string;       // Reserved; currently rejected as unsupported.
  mappings: ReadonlyArray<{ contentKey: string; path: string }>;
}
```

HTTP and HTTPS may target a user-approved public or private unicast server. HTTP requires `allowCleartextHttp: true`. FTP requires both `anonymous: true` and `allowPlainFtp: true`. FTPS requires `anonymous: true`; it never falls back to plain FTP. No account is tried without this approval. Anonymous login uses `USER anonymous` and an empty `PASS`, not credential guessing or a user email address. Servers requiring a different password are unsupported.

Only explicit FTP-over-TLS (`AUTH TLS`, normally port 21) is implemented. Implicit FTPS, SFTP, authenticated HTTP, cookies, HTTP authentication, signed query URLs, password-based FTP, and opaque secret-store lookup are unsupported. Supplying `credentialRef` does not silently enable authentication. Secrets must never be stored in URLs, mappings, manifests, logs, localhost URIs, or future evidence records.

Canonical identity is structural and strict:

```ts
{ namespace: 'tmdb', mediaType: 'movie', externalId: 123 }
// tmdb:movie:123
{ namespace: 'tmdb', mediaType: 'tv', externalId: 123, season: 0, episode: 2 }
// tmdb:tv:123:s0e2
```

A TV series without exact season/episode cannot resolve. Season zero is valid; episode zero is not. One endpoint cannot map the same path to different canonical keys or one key to different paths. Identical duplicate pins collapse. Filename evidence remains separate from identity. Indexing can return unmapped files; it never guesses TMDB IDs, remake identity, episodes, language, quality, or locality.

## TypeScript integration

```ts
import nativeBdix from '../../modules/cinetor-bdix';
import { BdixEngine, NativeBdixTransport } from '../providers/bdix';

const engine = new BdixEngine(new NativeBdixTransport(nativeBdix));
await engine.configure(savedApprovedEndpoints);
// Only after an explicit network selection action:
const networks = await nativeBdix?.getNetworks();
await nativeBdix?.selectNetwork(selectedNetworkId);
// Only after an explicit index action:
const index = await engine.index(endpointId, signal);
// Resolve searches saved canonical pins only, never the directory or the network:
const sources = await engine.resolve(contentRef, signal);
// Hold this transient ownership until playback/download is finished:
await engine.close(sources[0].nativeToken);
```

Exports from `src/providers/bdix.ts` include `BdixEngine`, `NativeBdixTransport`, `BdixEndpoint`, `BdixContentRef`, `BdixTransport`, `BdixNetworkContext`, `BdixProbe`, and `BdixError`.

Engine methods:

- `configure(endpoints): Promise<void>` validates and replaces consent, cancels in-flight work, and releases prior sources.
- `index(endpointId, signal?): Promise<BdixIndex>` traverses only the saved endpoint/root.
- `resolve(ref, signal?): Promise<BdixPlaybackSource[]>` prepares the first successful exact pinned source. No match returns an empty array. Transport failures remain errors, not fabricated sources.
- `probe(endpointId, ref, signal?): Promise<BdixProbe>` probes only that exact pin. FTP REST testing is explicit here.
- `close(nativeToken): Promise<void>` revokes URI access and deletes the private spool. It is idempotent natively.
- `transferStatus(nativeToken)` returns transfer state, bytes, size, non-capability representation ID, and SHA-256 only after completion.
- `copySnapshot(nativeToken, signal?)` copies a **completed MP4 spool only** into app-private storage and returns `{uri, sizeBytes, sha256, mimeType}`. The host owns successful copies and must manage retention/deletion.
- `dispose(): Promise<void>` stops subscriptions, aborts operations, and releases owned sources.

`BdixIndex` contains `{endpointId, networkContext, files, pages, bytes, rejected, ambiguous, truncated}`. File rows are `{url, name, kind, sizeBytes?, contentKey?}`. `contentKey` appears only for an existing exact saved mapping. Index data is bounded and not persisted by this engine.

Playback sources have `url` set to the prepared localhost URI, `engine: 'bdix'`, `providerId`, `sourceId`, `contentKey`, `nativeToken`, `expiresAt`, `container`, `mimeType`, `fileSizeBytes`, `restart`, `representationId`, and `representationValidator`. `networkContext` is serialized as `wifi:<networkHandle>:<epoch>` for the shared contract. `bdixNetworkContext` retains `{id, epoch, transport: 'wifi'}`. Network IDs are decimal strings, not JavaScript floating-point handles.

`verificationState: 'transport-verified'` means a finite size and compatible container signature were read from this connection. It does not mean codec decoding, playback confirmation, local peering, a healthy provider count, or a matching cut. Parent first-frame evidence must be separate.

MP4/M4V/MOV are surfaced as the MP4-family container; MKV and WebM remain distinct. Only MP4-family sources have `downloadable: true`. MKV/WebM are online-only in this bridge. The parent must support `'webm'` in playback types or reject it explicitly; never cast it to MP4. Remote HLS/DASH manifests are unsupported, because a single-file proxy cannot safely stand in for their child resources.

The shared parent `resolverPool`/`probePool`, 45-second request ceiling, priorities, fair scheduling, and fallback publication remain outside this module. `resolve` already includes a byte/signature preflight inside native `preparePlayback`; do not probe the same source again by unscoped JS fetch. Parent adapters should place that work under their shared admission policy and use `transferStatus` for prepared-source readiness. Indexing runs only from its explicit UI action, not Play.

## Expo bridge and native classes

`modules/cinetor-bdix/index.ts` uses `requireOptionalNativeModule('CinetorBdix')` from Expo. It is `null` on Expo Go, iOS, and web. A native Android cloud build is required. Local module autolinking is described by `expo-module.config.json`; the host should verify generated linking in CI rather than assuming a JS import proves native availability.

All methods below are asynchronous except `cancel`, listener registration, and constants:

```ts
sourceVersion: string; // '1.0.0'
sourceSha256: string;  // Actual cloud-computed adapter input SHA-256.
configure(endpointsJson: string): Promise<void>;
getNetworks(): Promise<Array<{id: string; label: string; selected: boolean}>>;
selectNetwork(id: string): Promise<{id: string; epoch: number; transport: 'wifi'}>;
getNetworkContext(): Promise<{id: string; epoch: number; transport: 'wifi'} | null>;
list(requestId: string, endpointId: string, url: string, maxBytes: number, maxItems: number): Promise<BdixListResponse>;
probe(requestId: string, endpointId: string, path: string): Promise<BdixProbe>;
preparePlayback(requestId: string, endpointId: string, path: string, maxBytes: number): Promise<BdixPrepared>;
transferStatus(token: string): Promise<BdixTransferStatus>;
copySnapshot(requestId: string, token: string): Promise<BdixSnapshot>;
release(token: string): Promise<void>;
cancel(requestId: string): void;
addListener('onNetworkContext', listener): {remove(): void};
```

`BdixPrepared` includes `{uri, token, sizeBytes, mimeType, container, restart, networkContext, expiresAt, representationId, representationValidator, providerVersion, providerHash}`. Remote `validator` metadata may also be present, but is not permission to append data from another connection.

Native package: `expo.modules.cinetorbdix`.

- `CinetorBdixModule`: Expo export, consent generation, bounded workers, request cancellation, lifecycle cleanup.
- `SelectedNetwork`, `NetworkScope`, `BoundSocketFactory`, `BdixOperation`: explicit Wi-Fi selection, bound sockets, epoch invalidation, cancellable I/O.
- `BdixFtpClient`, `FtpTransport`: Apache Commons Net protocol and MLSD/LIST parsing with separately owned network-bound TLS sockets.
- `HttpTransport`, `FixedBody`, `ChunkedBody`: bounded HTTP/1.1 framing over the selected network, never default-route HTTP APIs.
- `SpoolStore`, `BdixSpool`: single-representation transfer, quotas, final validation, completed copy.
- `BdixLoopbackProxy`: exact-file loopback capability endpoint and single-byte-range serving.
- `PathPolicy`, `PassivePolicy`, `RangePolicy`, `ControlReader`: independent native validation, pre-connect passive-host checks, range validation, bounded FTP control parsing.

## Parsing and network safety

HTTP listing bodies use the existing `htmlparser2` dependency. Apache table/pre listings, nginx HTML, and IIS anchor listings use structural parsing, including unquoted and single/double-quoted attributes and decoded entities. Scripts, base tags, forms, frames, and objects are not executed or treated as discovery instructions. Displayed HTML sizes are not promoted to exact file sizes.

Accepted JSON forms are nginx autoindex arrays (`name`, `type`, `size`) and an explicit API shape `{entries:[{name,href,type,sizeBytes?}], next?: string|null}`. Unknown JSON schemas are unsupported. Pagination must be explicit `rel=next` or API `next`; only `page`, `offset`, and `cursor` queries are allowed. Credential-bearing or arbitrary query URLs are refused. No pagination parameters are guessed.

Paths normalize percent-encoding and dot segments while preserving exact Unicode spelling. Encoded traversal, encoded separators, double encoding, invalid UTF-8, controls, backslashes, fragments, credentials, authority/port/protocol changes, and root-prefix lookalikes are refused. Unicode normalization is deliberately not applied: two canonically equivalent Unicode strings may be different files. Remote redirects are refused entirely, including same-origin ones. This is stricter than following contained redirects and avoids ambient credential or downgrade behavior.

FTP is binary (`TYPE I`). `MLSD` is preferred; recognized unsupported-command replies permit `LIST` with the Commons Net server-specific parser. LIST format guessing is not unbounded. Symlinks and nonregular entries are excluded; canonical `PWD` must match the requested contained directory. A pinned file must have regular-file evidence from MLST or bounded MLSD/LIST fallback. The server itself remains authoritative about its filesystem; a malicious server can lie about metadata.

EPSV is preferred. Only recognized unsupported EPSV replies on IPv4 permit PASV. PASV's raw advertised address must exactly equal the established control peer **before any data socket is created**. No NAT-host rewriting, third-party data address, active FTP, or port scan is allowed. Data sockets connect only to that control peer. Both control and data use the selected Android network. Connect/DNS/TLS handshake deadlines are 1.5 seconds; listings and preparation batches have 30-second deadlines. Cancellation closes sockets and cancels bounded DNS futures, not only wrapper promises.

FTPS uses `AUTH TLS`, platform certificate trust, endpoint hostname verification, TLS 1.2/1.3, `PBSZ 0`, and `PROT P` on both channels. There is no trust-all manager, custom user trust store, plaintext downgrade, or session-reuse workaround. Servers requiring nonstandard TLS session reuse may be unsupported.

Only explicitly selected Wi-Fi networks are eligible. VPN, cellular, automatic replacement networks, and process-wide network binding are not used. Link/capability changes, network loss, reselection, endpoint reconfiguration, and destruction revoke in-flight work and source capabilities. Selection is not persisted as a reusable Android handle.

Native HTTP uses raw selected-Network sockets and its own strict policy. The parent may retain default Android cleartext denial and permit only `127.0.0.1` for its media player. Do not globally enable cleartext traffic to make endpoint HTTP work. Consent for raw HTTP is independently enforced at both TS and native boundaries.

## Playback, ranges, and download integrity

A successful prepare creates an exact URI:

```text
http://127.0.0.1:<random-port>/media/<256-bit-base64url-token>/video.<mp4|mkv|webm>
```

The listener binds only `127.0.0.1`. There is no directory browser, arbitrary upstream URL argument, wildcard path, manifest expansion, or credential route. It accepts only exact GET/HEAD requests with the expected Host. Browser-origin requests, ambiguous headers, request bodies, and multiple ranges are refused. Four local readers are allowed; stalled readers are closed. A random capability must remain transient and must not be logged or persisted in evidence.

The native worker opens **one continuous remote stream from byte zero**, writes a fresh private spool without append, checks exact finite size, and computes SHA-256. There are no remote retries or range reassembly into that spool. EOF, FTP completion reply, before/after metadata checks when available, and `fsync` must succeed before the final byte becomes readable. A generic downloader therefore cannot finish the declared body before upstream completion validation. Failure invalidates even previously buffered byte access and removes the partial file.

The localhost proxy supports closed/open/suffix single ranges with exact `Content-Range` and `Content-Length`. Range bytes always come from the same spool. Seeking ahead waits for preceding bytes, up to 30 seconds per wait; it does not reconnect with REST to another representation. This trades random-seek speed for correctness on servers without strong validators. Large MP4 files with a tail `moov` atom can need most of the file before playback. No container-seek performance claim has been validated.

REST capability is separately tested by the explicit FTP `probe`: compare a distinguishable baseline slice against bytes from a fresh `REST <offset>`/`RETR`. A rejection or mismatched sample returns `unsupported`; nondistinguishable data returns `unverified`; a matching finite sample returns `verified`. This is sampled offset behavior, not proof of immutable server content. Playback preparation reports `unverified` for FTP because it does not perform the extra REST probe. HTTP reports `not-applicable`. Neither FEAT nor a `350` reply alone means working REST.

Every spool gets an independent, non-capability UUID. `representationId = bdix-spool:<uuid>` and the strong local ETag/`representationValidator = "bdix-<uuid>"` identify only that spool. They do not contain its bearer token. A new prepare creates a different representation ID even for the same canonical pin. Do not derive `timelineId` from endpoint/name/size or resume across sources/cuts. Complete `transferStatus.sha256` and snapshot `sha256` are content digests, not provider code provenance.

When the optional download module is present, native reflection calls `expo.modules.cinetormedia.TrustedLoopbackSources.register(uri)` and `.revoke(uri)` for the exact assigned URI. No JS registration API is added. The parent/download owner must hold the token until playback/download completes, then call `engine.close(token)`. Aborting the resolver signal **after success** does not close its returned source; Stop/profile/revoke/network actions must explicitly release or invalidate it. Revocation cancels already-connected local readers too.

Spooling is foreground/process-owned, not a background-download service. Limits: two simultaneous spools, 2 GiB total reserved spool bytes, 2 GiB per file, free-space check with 16 MiB reserve, four-hour absolute capability lifetime, and no restart after process death. Completed copies are independent app-private files; the host must import/delete them and enforce its own download catalog quota. HLS/DASH packaging is not implemented here.

## Resource ceilings

- At most 16 configured endpoints and 1,000 explicit mappings per endpoint.
- Index depth 4, 32 pages, 1,000 observed entries, 1,000 queued/visited URLs.
- At most four listing requests per batch; total native request workers four with bounded queue 16.
- Listing body 512 KiB per page, 4 MiB total; raw duplicate/rejected entries count toward parser limits.
- 1.5-second connection/DNS/TLS deadlines, 5-second socket reads, 30-second listing/preparation batches.
- FTP control connection 64 KiB total and 8 KiB per line; listings 8 KiB per line.
- HTTP response headers 32 KiB and 64 fields; local request headers 8 KiB and 32 fields.
- Separate two-worker bounded DNS pool, two transfer workers, four local readers. Parent shared playback admission remains required.

A strict limit can make a large/malformed server unsupported; it never silently authorizes broader traversal. Limit failures do not publish a partially trusted index as complete. Completed bounded traversal reports `truncated` when a page/depth/queue ceiling leaves work unvisited.

## Source provenance and licensing

`android/build.gradle` hashes actual module Kotlin, provider TypeScript, bridge/config, manifest, and Gradle inputs during the **cloud build**. Sorted repository-relative path + NUL + file bytes + NUL feed SHA-256. `BuildConfig.BDIX_SOURCE_SHA256`, native `sourceSha256`, and response `providerHash` expose that exact input digest. `providerVersion` is `1.0.0`. A Git commit SHA-1 is not used as a SHA-256. This is reproducible input provenance, not a signing attestation; OTA updates to provider TypeScript must rebuild native code or invalidate this evidence. No built digest is claimed in this checkout.

Runtime dependency: `commons-net:commons-net:3.12.0`, Apache License 2.0. Its original `LICENSE.txt` and `NOTICE.txt` are preserved as packaged Android assets under `cinetor-bdix-licenses/`. The module links Commons Net; no downloaded provider code or scripts are executed. CI tests additionally use JUnit 4.13.2 and `okhttp-tls:4.12.0` solely to generate owned fixture certificates; they are not production trust overrides or runtime dependencies. Parent About/license UI may read/present packaged notices but must not strip them.

## Validation: authored, NOT RUN

No installs, package tests, TypeScript compiler, Expo prebuild/bundles, Gradle, JVM, emulator, or device tests ran locally. No cloud run was dispatched by this worktree, and nothing was pushed. The parent owns the workflow and merge/push decision.

Cloud-only commands for the existing CI owner:

1. Install locked root dependencies in GitHub Actions, then `npm test` (includes `test/providers/bdix.test.ts`).
2. Run the parent's TypeScript check in that cloud job.
3. Run Expo Android prebuild in CI, verify local module autolinking, then the generated Gradle project's `:cinetor-bdix:testDebugUnitTest`. If Expo names the generated project differently, obtain its actual path using cloud `./gradlew projects` and use that module's `testDebugUnitTest`. Assert that XML exists for all four classes under `modules/cinetor-bdix/android/build/test-results/testDebugUnitTest/TEST-expo.modules.cinetorbdix.<Class>.xml` and each has nonzero tests; `NO-SOURCE` is not acceptance.
4. Build the Android app in CI; preserve R8 parser/reflective registry rules and packaged notices.

Authored tests call production code:

- `test/providers/bdix.test.ts`: Apache/nginx/IIS parsing, entities/Unicode, malformed URLs, root/origin containment, explicit pagination, JSON ambiguity, limits, exact season-zero identity, endpoint/cleartext/anonymous consent, no-I/O preabort, configuration revocation, network epochs, late-token cleanup, concurrency/depth, no filename matching, and native bridge errors.
- `BdixPolicyTest`: native containment, canonical identity, pre-connect PASV/EPSV checks, range overflow/multiple-range rejection, media signatures.
- `BdixFtpFixtureTest`: owned loopback binary FTP, MLSD/LIST fallback, symlink filtering, EPSV/PASV, exact REST bytes and unsupported REST, oversized listing, preabort, and no data socket on hostile PASV.
- `BdixHttpFixtureTest`: owned finite HTTP transfer, request policy, redirects, framing conflicts, compressed/unbounded media rejection, truncated body, and chunk decoding.
- `BdixFtpsFixtureTest`: generated owned certificates, explicit AUTH TLS, protected listing channel, trust/hostname rejection before login, and refusal to downgrade AUTH/PROT failures.

Still required before claiming release readiness: cloud compilation/typecheck/test results, Android selected-Network instrumentation, data-channel TLS mismatch coverage, callback loss/revoke races on device, exact localhost Media3/Expo seek/first-frame tests for real codecs, disk-pressure and long-transfer tests, proxy malformed clients/ranges in instrumentation, and authorized owned endpoint reachability. These are open validation gates, not passing results or fictional working-server counts.
