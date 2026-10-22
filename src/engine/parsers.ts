import { Parser } from "htmlparser2";
import {
  CandidateSchema,
  EngineError,
  type Candidate,
  type ParsedPage,
  type Source,
} from "./model";
import { authorizedUrl } from "./security";
export interface CatalogParser {
  parse(body: string, source: Source, base: string): ParsedPage;
}
function append(
  out: ParsedPage,
  input: unknown,
  source: Source,
  base: string,
): void {
  const parsed = CandidateSchema.safeParse(input);
  if (!parsed.success) {
    out.rejected++;
    return;
  }
  try {
    out.candidates.push({
      ...parsed.data,
      url: authorizedUrl(parsed.data.url, source, base),
    });
  } catch {
    out.rejected++;
  }
}
const empty = (): ParsedPage => ({
  candidates: [],
  directories: [],
  rejected: 0,
});
export class JsonCatalogParser implements CatalogParser {
  parse(body: string, source: Source, base: string): ParsedPage {
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      throw new EngineError("malformed");
    }
    const rows = Array.isArray(input)
      ? input
      : typeof input === "object" && input !== null && "items" in input
        ? input.items
        : null;
    if (!Array.isArray(rows)) throw new EngineError("malformed");
    const out = empty();
    for (const row of rows.slice(0, 500)) append(out, row, source, base);
    out.rejected += Math.max(0, rows.length - 500);
    return out;
  }
}
export class HtmlDirectoryParser implements CatalogParser {
  parse(body: string, source: Source, base: string): ParsedPage {
    if (!/<(?:html|body|a|!doctype)\b/i.test(body))
      throw new EngineError("malformed");
    const out = empty();
    let href: string | undefined;
    let text = "";
    let links = 0;
    let ignored = 0;
    const parser = new Parser(
      {
        onopentag(name, attrs) {
          if (name === "script" || name === "style") ignored++;
          if (name === "a") {
            href = attrs.href;
            text = "";
          }
        },
        ontext(value) {
          if (href && !ignored) text += value.slice(0, 300 - text.length);
        },
        onclosetag(name) {
          if (name === "script" || name === "style")
            ignored = Math.max(0, ignored - 1);
          if (name !== "a" || !href) return;
          const target = href;
          href = undefined;
          if (
            ++links > 1000 ||
            target.startsWith("?") ||
            target.startsWith("#")
          )
            return;
          try {
            const url = authorizedUrl(target, source, base);
            const path = new URL(url).pathname;
            if (path.endsWith("/")) {
              // Downward-only directory traversal; cycles, parents and host changes are rejected.
              const root = new URL(base);
              if (
                new URL(url).origin === root.origin &&
                path.startsWith(root.pathname) &&
                path !== root.pathname
              )
                out.directories.push(url);
            } else if (/\.(mp4|m3u8)$/i.test(path)) {
              const filename = decodeURIComponent(path.split("/").pop() ?? "");
              append(
                out,
                { title: text.trim() || filename, url },
                source,
                base,
              );
            }
          } catch {
            out.rejected++;
          }
        },
      },
      { decodeEntities: true },
    );
    parser.write(body);
    parser.end();
    return out;
  }
}
export class M3uParser implements CatalogParser {
  parse(body: string, source: Source, base: string): ParsedPage {
    if (
      !body
        .replace(/^\uFEFF/, "")
        .trimStart()
        .startsWith("#EXTM3U") ||
      body.includes("#EXT-X-")
    )
      throw new EngineError("malformed");
    const out = empty();
    let meta: { title: string; attrs: Record<string, string> } | undefined;
    for (const line of body.split(/\r?\n/).slice(0, 3000)) {
      const value = line.trim();
      if (value.startsWith("#EXTINF:")) {
        const attrs: Record<string, string> = {};
        for (const m of value.matchAll(/([\w-]+)="([^"]*)"/g))
          attrs[m[1]] = m[2];
        const comma = value.match(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)?.index;
        meta = {
          title: comma === undefined ? "" : value.slice(comma + 1),
          attrs,
        };
      } else if (value && !value.startsWith("#") && meta) {
        const restricted =
          /\b(adult|xxx|porn|erotic|18\+)\b/i.test(
            meta.attrs["group-title"] ?? "",
          ) || /\(18\+\)/.test(meta.title);
        append(
          out,
          {
            title: meta.title,
            url: value,
            kind: "channel",
            category: restricted ? "adult" : "live",
            adult: restricted,
            canonicalId: meta.attrs["tvg-id"] || undefined,
            identityNamespace: meta.attrs["tvg-id"] ? "tvg" : undefined,
            poster: meta.attrs["tvg-logo"] || undefined,
            country: meta.attrs["tvg-country"] || undefined,
            genres: meta.attrs["group-title"]
              ? [meta.attrs["group-title"]]
              : [],
          },
          source,
          base,
        );
        meta = undefined;
      }
      if (out.candidates.length >= 500) break;
    }
    if (meta) out.rejected++;
    return out;
  }
}
export class ParserRegistry {
  private parsers: Record<"json" | "html-directory" | "m3u", CatalogParser> = {
    json: new JsonCatalogParser(),
    "html-directory": new HtmlDirectoryParser(),
    m3u: new M3uParser(),
  };
  parse(
    format: Source["adapter"],
    body: string,
    source: Source,
    base: string,
  ): ParsedPage {
    if (format === "direct") {
      const out = empty();
      append(
        out,
        { ...source.directMetadata, url: source.endpoint },
        source,
        base,
      );
      return out;
    }
    return this.parsers[format].parse(body, source, base);
  }
}
