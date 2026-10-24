# Cinetor Distribution Licensing

Cinetor combines original application code with third-party components. The root `LICENSE` retains the original Expo MIT notice; it does not license the complete combined native integration as MIT-only.

## Engine terms

- The selected NuvioMobile, Cloudstream, NiceHttp, and NewPipeExtractor materials carry GPL-3.0-only terms as recorded in `config/engine-lock.json` and `licenses/engines/NOTICE.txt`.
- Original Cinetor-owned fixture plugins are GPL-3.0-or-later.
- QuickJS-KT carries Apache-2.0 terms; Bellard QuickJS and c-vector retain their MIT notices.
- Preserve the exact upstream license text. Original file notices and provenance still apply; a new wrapper does not broaden an upstream GPL grant.

The combined engine distribution must satisfy the applicable GPL-3.0 requirements. Do not advertise it as MIT-only. Review the complete resolved dependency graph and its notices before distribution beyond the source/CI handoff.

## Corresponding source

A passing cloud artifact includes:

1. The APK and commit-bound package/signature verification.
2. The exact Cinetor Git source archive, including native adapters, original fixtures, build scripts, and lockfiles.
3. Immutable-revision source archives for the selected GPL engines and related runtime sources, with download receipts and archive hashes.
4. The compiled fixture's generated hash/source provenance, exact license text, and notices.

Source is packaged alongside the APK rather than promised for later. `tools/fetch_engine_sources.py` downloads source archives into fresh directories without extracting or executing them. Source-archive hashes are recorded separately from the published AAR pins. APK consumers must receive the corresponding source and notices with any onward distribution.

## Open movie fixture

Big Buck Bunny (2008) is an open movie by the Blender Foundation, licensed under Creative Commons Attribution 3.0. The two original fixture providers reference the public W3C-hosted media URL. The media is not bundled into the application.

- Attribution: https://peach.blender.org/about/
- License: https://creativecommons.org/licenses/by/3.0/

A historical HEAD response confirms only an observed HTTP response. It is not a full-media checksum or decoded playback result.

## Branding and signing

Cinetor is independent; Nuvio, Cloudstream, Expo, and other names identify component provenance or compatibility, not endorsement. Android's debug certificate signs the CI release variant. Private distribution signing has not been configured or represented as present.
