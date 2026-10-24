# Native Download Engine

## Implementation status

This module adds Android Media3 downloads and secure native playback. Source review and fixture authoring were completed without running a local install, test, typecheck, bundle, Gradle task, JVM, or build. **Tests and device acceptance checks are NOT RUN.** A successful Android CI build and the device checks below are required before claiming verified release behavior.

The native dependency version is **Media3 1.9.1**, matching Expo SDK 58 `expo-video`. The module uses `com.android.library`, `expo-module-gradle-plugin`, and OkHttp 4.12.0. It does not add `kotlin-android` or depend on generated application `android/` source files.

## What is supported

- Direct MP4: a persistent native Media3 download, followed by a cache-only verification pass, exact size/header checks, Android media-track/DRM inspection, and atomic promotion into a private MP4 file. Public gallery export is not automatic. `savedToDevice` is always `false`.
- Finite clear HLS and DASH: `DownloadHelper.Factory` prepares the actual presentation and selects the highest supported video plus the default supported audio/text tracks. Media3 downloads the manifests, selected renditions, segments, initialization data, and AES-128 identity keys. A second cache-only downloader pass verifies that selected resources do not need the network. AES-128 keys must be exactly 16 bytes.
- Offline segmented media returns `cinetor-offline://download/<attempt-uuid>`, not a fabricated filesystem URI. Playback uses the matching stream keys and per-attempt cache namespace, with no upstream network factory.
- Online playback uses the same restricted native HTTP source. MP4, HLS, DASH, MKV, and WebM are truthful playback container types; actual codec support still depends on Media3 and the device.
- Existing private `documentDirectory/downloads/` MP4/HLS files remain playable and deletable. The native file source checks every referenced segment/key path. Legacy downloads are not renamed, migrated, or deleted during hydration.

Offline MKV/WebM, torrents, external player handoffs, live/low-latency/steered presentations, and DRM are explicitly unsupported. Online live manifest refreshes may evolve; range/segment identity checks are not relaxed. DRM playback has no license manager and fails explicitly.

## Persistent queue and lifecycle

`CinetorMedia` owns one process-wide `DownloadManager`, `SimpleCache` with `NoOpCacheEvictor`, and a private SQLite download index. `maxParallelDownloads` is 2. Download HTTP also enforces two total open transfer slots and one per normalized hostname, including redirect destinations. Each downloader uses a serial executor to avoid creating an independent segment-worker pool.

Queue state is not owned by a JS promise, screen, or React runtime. Unmounting the module detaches listeners but does not destroy ongoing downloads. Native state events have a profile-qualified key and immutable attempt ID.

The representation policy is deliberately conservative:

1. Every queue/restart creates a new UUID and cache namespace.
2. Pausing cancels current I/O, stops the native request, and reports that restart begins from zero.
3. Restart never appends bytes from a previous URL, server, redirect target, track selection, or attempt.
4. Incomplete records are stopped before `DownloadManager` is initialized after process death. They restore as `paused`; the user restarts in the foreground. Old incomplete cache data is swept.
5. No automatic partial-byte retries are enabled (`minRetryCount = 0`, OkHttp connection retries disabled). Helper preparation is bounded to 90 seconds, connections to 20 seconds, socket reads to 30 seconds, redirect chains to five hops, and download sessions to five hours. Media3 helper loading may retry within that deadline; a policy/identity error poisons the attempt instead of being bypassed by a fallback request.
6. Cancel/delete remove the record and schedule cleanup only after its writer stops. Internal `cancelAttempt(key,id)` prevents a delayed AbortSignal from canceling a replacement attempt.

Progress is native evidence. Unknown byte totals remain `null`; adaptive progress may be segment-based and is labeled `progressKind: 'segments'`. Progress does not reach 1 until completion verification. `getStorageInfo()` reports actual filesystem capacity/free space and native cache, exports, and legacy download usage. It reserves 128 MiB and checks space before transfer, during reads, and before the additional MP4 export copy.

## Native bridge

All methods return promises through Expo. The native module name is `CinetorMedia`.

```ts
getDownloads(): Promise<NativeDownload[]>;
query(key: string): Promise<NativeDownload | null>;
queue({ key, url, headers?, container?, headerOrigin? }): Promise<NativeDownload>;
restart({ key, url?, headers?, container?, headerOrigin? }): Promise<NativeDownload>;
pause(key: string): Promise<NativeDownload | null>;
cancel(key: string): Promise<void>;
cancelAttempt(key: string, id: string): Promise<void>;
delete(key: string): Promise<void>;
deleteLocalFile(uri: string): Promise<void>;
getStorageInfo(): Promise<{ freeBytes, totalBytes, usedBytes, reservedBytes }>;
getCapabilities(): Promise<{ available, platform, maxParallelDownloads, perHostLimit, notificationsAllowed }>;
setDownloadPolicy({ wifiOnly: boolean }): Promise<void>;
```

`onDownloadUpdate` emits the full entry directly, not a `nativeEvent` envelope:

```ts
{
  key, id, status: 'queued' | 'downloading' | 'paused' | 'downloaded' | 'failed',
  container, bytesDownloaded, totalBytes: number | null, progress: number | null,
  progressKind: 'bytes' | 'segments' | 'indeterminate',
  localUri?, sizeMB?, error?, errorCode?, updatedAt, restartRequired, removed
}
```

Native maps may contain `null` for absent optional values. Events/snapshots never expose source URLs, headers, titles, or credentials. `removed: true` is a deletion event, not a downloadable item. `updatedAt` uses Unix milliseconds.

The TypeScript service preserves the existing API and adds native reconciliation helpers:

```ts
downloadKey(titleId, episodeId?, profileId = 'default'); // profile:content

downloadVideo(key, url, onProgress, headers?, signal?, container?, headerOrigin?)
  // Promise<{ localUri, sizeMB, savedToDevice: false }>

getDownloads(); queryDownload(key); subscribeDownloadUpdates(callback); // unsubscribe function
pauseDownload(key); restartDownload(key, url?, headers?, container?, headerOrigin?);
cancelDownload(key); deleteDownload(key); deleteLocalFile(uri?); isActive(key);
getStorageInfo(); getDownloadCapabilities(); setDownloadPolicy({ wifiOnly });
```

The seventh argument preserves the credential origin when a provider probe returns a final redirected media URL. A supplied replacement URL does not inherit previous credentials. `downloadVideo` waits for verified native completion, subscribes before queueing, handles fast completion across the acknowledgement race, rejects pause/failure/cancel, and forwards only real progress. Native queue reconciliation remains necessary when the app restarts.

## Player contract

`src/components/OfflineVideo.tsx` exports named/default `OfflineVideo`, `PlaybackContainer`, `MediaTrack`, `MediaTracks`, `MediaState`, and `MediaTimeUpdate`. It uses SDK 58's actual `requireNativeViewManager` export from `expo-modules-core`; that SDK does not export `requireNativeView`.

```ts
interface OfflineVideoProps extends ViewProps {
  uri: string;
  headers?: Record<string, string>;
  headerOrigin?: string;
  container?: 'mp4' | 'hls' | 'dash' | 'mkv' | 'webm';
  subtitleTracks?: { url: string; language?: string; label?: string; mimeType?: string }[];
  paused?: boolean;                         // default true
  position?: number;                        // seek command, seconds
  rate?: number;                            // 0.25–3
  audioTrackId?: string;
  subtitleTrackId?: string | null;          // null/'off' disable subtitles
  videoTrackId?: string;                    // 'auto' clears quality override
  onFirstFrame?: () => void;
  onTimeUpdate?: ({ currentTime, duration }) => void;
  onState?: ({ state, error? }) => void;
  onEnd?: () => void;
  onTracks?: ({ audio, subtitles, video }) => void;
}
```

The wrapper unwraps view `nativeEvent` payloads. `onFirstFrame` is Media3 `Player.Listener.onRenderedFirstFrame`, never a timer/current-time heuristic. `onTracks` contains only actual supported tracks. IDs are `groupIndex:trackIndex`, scoped to the current media attempt. Track props use Media3 track-group overrides; there are no invented quality choices. Tracks may change with the presentation, so callers must use the most recently emitted list.

External online captions support VTT, SRT, and TTML. Each caption request passes the same URL/header rules. Offline and legacy-file playback rejects external network captions. Set `position` only for an intentional seek, not on every playback clock update. Key/remount the view for a new source attempt to reject stale events. Resources release on view destruction/detachment and network sessions cancel; foreground loss pauses playback.

## HTTP and private data boundary

- Only public HTTPS is allowed, except an exact registered native loopback capability. URL credentials, arbitrary file/content URLs, private literal addresses, private DNS answers, proxies, and HTTPS-to-HTTP fallback are rejected. DNS is checked on the network used for the actual socket.
- Redirects are manual. Provider headers, including authorization/cookies/referrer/origin, remain bound to the original header origin for every redirect, segment, key, and caption. The system cookie jar is not used. Source-controlled Host, Range, If-Range, encoding, proxy, and framing headers are rejected.
- Byte ranges require a correct 206 `Content-Range`, requested start/end, consistent length/total, and a strong ETag. Repeated partial requests use `If-Range`. A 200 range response fails. A 416 is accepted only as exact EOF with matching previously known total, strong validator, and offset. Representation or redirect identity changes fail the attempt.
- Full finite download manifests are validated and frozen for the entire attempt, including redirect aliases. HLS/DASH helper preparation and packaging therefore cannot silently use different versions of an unversioned manifest. Online full manifest refreshes alone are exempt from immutable-manifest matching; offline data and byte ranges are not.
- Request URLs, headers, and metadata are AES-GCM sealed with an Android Keystore key in `noBackupFilesDir/cinetor-media/records.sealed`. Media3's ordinary index sees only opaque request IDs. Cache keys hash resource URLs within an attempt namespace. Cached manifests/keys necessarily contain private media data and remain within the no-backup app-private directory. Media3 diagnostic URL logging is disabled; UI errors are sanitized.
- The default persisted download policy is Wi-Fi only. Native Wi-Fi checks continue during transfers, with sockets and DNS pinned to that Wi-Fi network. Policy or connection loss ends the current attempt rather than silently continuing on cellular or appending a new representation.

The separate trusted BDIX server calls only these Kotlin static methods, optionally through reflection:

```text
expo.modules.cinetormedia.TrustedLoopbackSources.register(uri: String)
expo.modules.cinetormedia.TrustedLoopbackSources.revoke(uri: String)
expo.modules.cinetormedia.TrustedLoopbackSources.allows(uri: String): Boolean
```

They are not exported to JS. Registration accepts exactly `http://127.0.0.1:<ephemeral-port>/media/<32–128-character-base64url-token>/video.(mp4|mkv|webm)`, without query/fragment, credentials, alternate paths, or inherited children. The BDIX owner must revoke capabilities on shutdown, consent withdrawal, or network/source changes. Registered local URLs cannot redirect. Tokens are not restored across process death; reselect the local source before restart.

## Expo/application integration

Autolink the local module under `modules/cinetor-media` through the project's Expo native-module search path. All persistent Android source, service declarations, consumer ProGuard rules, and dependencies are inside this module; generated application Android files are not edited here.

The module manifest merges `INTERNET`, `ACCESS_NETWORK_STATE`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, and `POST_NOTIFICATIONS`, plus the non-exported `CinetorDownloadService` with `dataSync` type. The application owner must handle Android notification permission UX and enable cleartext only for the trusted 127.0.0.1 proxy in network security configuration if local playback is enabled. Never enable general cleartext provider access.

Foreground notification content is generic, secret on the lock screen, and has no title, key, URL, or profile. Android may still show foreground work in its task manager when notification permission is denied. Android 12+ background start restrictions and Android 15+ data-sync time limits are honored: a blocked start is paused, and timeout pauses native work. There is no boot receiver or background restart loop. Force-stop/reboot recovery requires opening the app and explicitly restarting.

## CI and device validation

These commands are **for GitHub Actions only**, not this workstation:

```sh
npm ci
npm run typecheck
npm test
npx expo prebuild --platform android --no-install
./android/gradlew -p android :cinetor-media:testReleaseUnitTest
```

Expected owned native JUnit class: `expo.modules.cinetormedia.MediaSafetyTest` (five test methods). Require a nonempty XML report named `TEST-expo.modules.cinetormedia.MediaSafetyTest.xml`; do not accept a `NO-SOURCE` task as a passing test run. Its default module-relative report directory is `modules/cinetor-media/android/build/test-results/testReleaseUnitTest/`; Expo may redirect the build root, so CI can locate this exact filename after running the exact task.

The JS test file is `test/providers/downloads-native.test.ts`. It tests the injected native adapter, header-origin forwarding, unknown lengths, early completion, verified-result requirements, AbortSignal acknowledgement races, old attempts, pause/restart, snapshots, policy/deletion forwarding, and native wiring invariants. These are not a substitute for instrumented transport/playback tests. Native unit fixtures cover URL/header policy, trusted exact capabilities, private/transition addresses, finite HLS/DRM policy, and online-manifest-refresh isolation. No provider traffic is used.

Before release, use owned legal MP4/HLS/DASH fixtures and verify on Android:

1. Two simultaneous downloads, one connection per host, generic foreground notification, denial of notification permission, and real free-space exhaustion.
2. Pause/cancel while queue acknowledgement, helper preparation, segment reads, and MP4 export are active; no resurrected entry or surviving partial media after cleanup.
3. Kill the process and reboot during transfer; snapshots restore paused state. Restart with a different URL/ETag/size; zero bytes are inherited.
4. HLS alternate default audio, fMP4 initialization segments, AES-128 keys, DASH multiple periods, and supported quality selection. Airplane-mode playback must work and removal of a required cache span must fail without network fallback.
5. Malformed 206/416, range-ignored 200, changed ETag/redirect target, premature EOF, unknown total, private DNS/redirect targets, cross-origin authorization/cookies, revoked BDIX token, and Wi-Fi-to-cellular transition.
6. Online first decoded frame, time updates, seeking, rate, genuine audio/subtitle/video switches, external captions, evolving live manifests, MKV/WebM truthfulness, and private legacy files.

Do not describe these device checks as passed until CI/device evidence exists.
