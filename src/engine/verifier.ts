import {
  EngineError,
  type Candidate,
  type Playback,
  type Source,
} from "./model";
import type { Network } from "./network";
import { authorizedUrl } from "./security";
const manifestTypes = [
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
];
const mediaTypes = ["video/mp4", "application/octet-stream", "video/mp2t"];
export class PlayableVerifier {
  constructor(
    private network: Network,
    private now = Date.now,
  ) {}
  async verify(
    candidate: Candidate,
    source: Source,
    signal: AbortSignal,
  ): Promise<Playback> {
    const url = authorizedUrl(candidate.url, source);
    const path = new URL(url).pathname.toLowerCase();
    let method: Playback["method"];
    if (path.endsWith(".mp4")) {
      const result = await this.network.request(source, url, signal, {
        limit: 4096,
        prefix: true,
        headers: { Range: "bytes=0-4095" },
        expectedTypes: mediaTypes,
      });
      const b = result.bytes;
      const brand = String.fromCharCode(...b.slice(8, 12));
      if (
        b.length < 16 ||
        String.fromCharCode(...b.slice(4, 8)) !== "ftyp" ||
        !/^(isom|iso[2-9]|mp4[12]|avc1|M4V |dash)$/.test(brand)
      )
        throw new EngineError("unsupported");
      method = "mp4-range";
    } else if (path.endsWith(".m3u8")) {
      await this.verifyHls(url, source, signal, new Set(), 0);
      method = "hls-segment";
    } else throw new EngineError("unsupported");
    return {
      sourceId: source.id,
      url,
      verification: "transport-verified",
      decoder: "unverified",
      method,
      verifiedAt: this.now(),
      failedUntil: 0,
      season: candidate.season,
      episode: candidate.episode,
    };
  }
  private async verifyHls(
    url: string,
    source: Source,
    signal: AbortSignal,
    visited: Set<string>,
    depth: number,
  ): Promise<void> {
    if (depth > 2 || visited.has(url)) throw new EngineError("malformed");
    visited.add(url);
    const response = await this.network.request(source, url, signal, {
      limit: 131072,
      expectedTypes: manifestTypes,
    });
    const text = new TextDecoder("utf-8", { fatal: true })
      .decode(response.bytes)
      .trim();
    if (
      !text.startsWith("#EXTM3U") ||
      text.includes("#EXT-X-KEY") ||
      text.includes("#EXT-X-SESSION-KEY")
    )
      throw new EngineError("unsupported");
    const lines = text.split(/\r?\n/).map((l) => l.trim());
    const variant = lines.findIndex((l) => l.startsWith("#EXT-X-STREAM-INF:"));
    if (variant >= 0) {
      const child = lines
        .slice(variant + 1)
        .find((l) => l && !l.startsWith("#"));
      if (!child) throw new EngineError("malformed");
      await this.verifyHls(
        authorizedUrl(child, source, response.url),
        source,
        signal,
        visited,
        depth + 1,
      );
      return;
    }
    const extinf = lines.findIndex((l) => l.startsWith("#EXTINF:"));
    const segment =
      extinf >= 0
        ? lines.slice(extinf + 1).find((l) => l && !l.startsWith("#"))
        : undefined;
    if (!segment || !text.includes("#EXT-X-TARGETDURATION:"))
      throw new EngineError("malformed");
    const segmentUrl = authorizedUrl(segment, source, response.url);
    const probe = await this.network.request(source, segmentUrl, signal, {
      limit: 4096,
      prefix: true,
      headers: { Range: "bytes=0-4095" },
      expectedTypes: mediaTypes,
    });
    const b = probe.bytes;
    const ts =
      b.length >= 377 && b[0] === 0x47 && b[188] === 0x47 && b[376] === 0x47;
    const map = lines
      .find((l) => l.startsWith("#EXT-X-MAP:"))
      ?.match(/URI="([^"]+)"/)?.[1];
    const fragment =
      b.length >= 16 &&
      ["styp", "moof", "ftyp"].includes(String.fromCharCode(...b.slice(4, 8)));
    if (fragment && map) {
      const init = await this.network.request(
        source,
        authorizedUrl(map, source, response.url),
        signal,
        {
          limit: 4096,
          prefix: true,
          headers: { Range: "bytes=0-4095" },
          expectedTypes: mediaTypes,
        },
      );
      if (String.fromCharCode(...init.bytes.slice(4, 8)) === "ftyp") return;
    }
    if (!ts) throw new EngineError("unsupported");
  }
}
