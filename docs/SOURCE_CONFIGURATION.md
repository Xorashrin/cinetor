# Cinetor Source Configuration

Version 2.0.0 uses separate metadata discovery, native engines, and repository-intake boundaries. Old CineHD/AWSIND code and evidence are historical compatibility material, not the active movie/episode resolver.

## Metadata and live channels

- Metadata without a project key uses the existing external proxy `https://autoembed.app/aproxy/proxy.php?url=` for TMDB requests.
- An optional build-time `EXPO_PUBLIC_TMDB_API_KEY` selects direct `https://api.themoviedb.org/3` access. It is embedded public configuration, not a secret vault.
- Artwork uses restricted `https://image.tmdb.org/t/p` paths.
- The separate Live TV directory uses `https://iptv-org.github.io/api`. Listings are unverified candidates; media transport is checked when requested.

These external services can change or fail. No third-party credential is copied. Cached metadata is not playback evidence.

## Reviewed native plugins

Open **Profiles > Engines & Providers**. The native inventory lists reviewed build entries, artifact hashes, installation status, and errors. Explicitly enable either owned fixture to request Big Buck Bunny, TMDB movie 810.

- `cinetor-bbb-nuvio`: native QuickJS/Nuvio fixture.
- `cinetor-bbb-cloudstream`: native compiled Cloudstream fixture with resources and a settings dialog.

No other plugin ID can be installed. Nuvio settings are encrypted native plugin/profile preferences. Reviewed plugin code can read its own settings; do not enter unrelated credentials. Cloudstream's own settings dialog is plugin-global and is not profile-isolated.

## BDIX endpoints

1. Save only a server you are authorized to access.
2. Select an available Android Wi-Fi path explicitly.
3. Enter an HTTP/HTTPS or FTP/FTPS base URL without embedded credentials.
4. Explicitly approve anonymous FTP/FTPS and any cleartext HTTP/plain FTP use.
5. Add exact mappings, one per line:

```text
tmdb:movie:810 = BigBuckBunny.mp4
tmdb:tv:123:s0e1 = specials/01.mp4
```

The server must actually provide that exact content. “Check listing” counts file entries; it never maps a title from a filename. Revoking an endpoint stops engine sessions and removes its saved consent/mappings. Nothing scans a subnet or guesses an ISP server.

## Extension repository intake

Open **Engines & Providers > Extension repository intake**. Save a named explicit public HTTPS JSON address and choose Nuvio or Cloudstream. Saving does not contact the server. Manual refresh requires confirmation because repository/index servers see the network request.

Cloudstream supports a descriptor with `pluginLists` or a plugin index array. Nuvio accepts provider/plugin arrays with explicit artifact locations. Intake does not guess missing paths. A root can reference at most four indexes; nested descriptors are rejected. Requests use public DNS-filtered native transport, default HTTPS port, no supplied headers/auth/cookies, and bounded bodies/deadlines.

All declared entries remain quarantined, invalid, or publisher-disabled. Publisher hashes and status flags are unverified claims. The metadata hash identifies the observed JSON bytes, not an artifact or decoded media. Updates never replace the reviewed executable allowlist. Repository URLs with credentials, queries, fragments, private addresses, or nonstandard ports are rejected rather than persisted.

Original historical repository manifests and review receipts were not supplied. No default catalog of hundreds of working plugins is invented from historical counts.

## Downloads

Only MP4, finite non-DRM HLS (including AES-128 identity keys), and finite clear DASH may be downloaded. Native planning validates child playlists and exact 16-byte AES keys. DRM is rejected. MKV and WebM are online-only. Wi-Fi-only policy is the default. Paused/interrupted transfers restart at zero, and automatic retry is disabled. Offline files are native-owned capabilities; import/export cannot trust paths from another device. External storage/media export is not claimed as a verified feature of this redesign.
