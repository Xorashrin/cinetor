import { EngineError, type Source } from "./model";
const sensitive =
  /token|key|signature|sig$|secret|password|credential|authorization|auth$|x-amz|x-goog/i;
export function cleanUrl(input: string, base?: string): URL {
  let url: URL;
  try {
    url = new URL(input, base);
  } catch {
    throw new EngineError("scope");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    [...url.searchParams.keys()].some((k) => sensitive.test(k))
  )
    throw new EngineError("scope");
  url.hash = "";
  return url;
}
function privateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    !h.includes(".") ||
    /\.(local|internal|localhost)$/.test(h) ||
    /^(0|10|127)\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h) ||
    /^198\.(18|19)\./.test(h) ||
    /^(22[4-9]|23\d|24\d|25[0-5])\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h.includes(":")
  );
}
export function authorizedUrl(
  input: string,
  source: Source,
  base = source.endpoint,
): string {
  const url = cleanUrl(input, base);
  if (privateHost(url.hostname) && !source.allowPrivateNetwork)
    throw new EngineError("scope");
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    throw new EngineError("scope");
  }
  if (
    /%[0-9a-f]{2}/i.test(path) ||
    path.includes("\\") ||
    /[\x00-\x1f]/.test(path) ||
    path.split("/").includes("..")
  )
    throw new EngineError("scope");
  const allowed = source.scopes.some((scope) => {
    const prefix = decodeURIComponent(scope.pathPrefix);
    return (
      url.origin === cleanUrl(scope.origin).origin &&
      (prefix === "/" ||
        path === prefix.replace(/\/$/, "") ||
        path.startsWith(prefix.replace(/\/$/, "") + "/"))
    );
  });
  if (!allowed) throw new EngineError("scope");
  return url.toString();
}
export function artwork(
  input: string | undefined,
  source: Source,
): string | undefined {
  if (!input) return undefined;
  try {
    return authorizedUrl(input, source);
  } catch {
    return undefined;
  }
}
/** Diagnostics contain codes and IDs, never arbitrary exception messages or URLs. */
export function errorCode(error: unknown): import("./model").ErrorCode {
  return error instanceof EngineError ? error.code : "network";
}
export function redact(input: string): string {
  return input
    .replace(/https?:\/\/[^\s"']+/gi, "[endpoint]")
    .replace(
      /(authorization|password|token|secret|api[-_]?key)\s*[:=]\s*[^\s,]+/gi,
      "$1=[redacted]",
    );
}
