import { Parser } from 'htmlparser2';
import { BDIX_LIMITS, BdixError, checkAbort, containedUrl, pathName, utf8Length } from './paths';

export interface BdixListingEntry {
  url: string;
  name: string;
  kind: 'file' | 'directory';
  sizeBytes?: number;
}
export interface BdixListing {
  entries: BdixListingEntry[];
  next: string[];
  rejected: number;
  observed: number;
  ambiguous: string[];
}
export interface ParseListingOptions {
  root: string;
  url: string;
  contentType: string;
  maxBytes?: number;
  maxItems?: number;
  signal?: AbortSignal;
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Bounded parsing only: no scripts, base URLs, form actions, frames, or guessed API routes. */
export function parseBdixListing(text: string, options: ParseListingOptions): BdixListing {
  checkAbort(options.signal);
  const maxBytes = Math.min(options.maxBytes ?? BDIX_LIMITS.pageBytes, BDIX_LIMITS.pageBytes);
  const maxItems = Math.min(options.maxItems ?? BDIX_LIMITS.items, BDIX_LIMITS.items);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxItems) || maxItems < 1)
    throw new BdixError('configuration', 'invalid-parser-limits');
  if (text.length > maxBytes || utf8Length(text) > maxBytes) throw new BdixError('size', 'listing-byte-limit');
  const current = containedUrl(options.root, options.url, options.root, true);
  const entries = new Map<string, BdixListingEntry>();
  const ambiguous = new Set<string>(), next = new Set<string>();
  let rejected = 0, observed = 0;
  const count = () => {
    checkAbort(options.signal);
    // Count raw entries, including duplicates and rejected paths, not only accepted rows.
    if (++observed > maxItems) throw new BdixError('size', 'listing-item-limit');
  };
  const add = (href: string, name: string, kind?: 'file' | 'directory', sizeBytes?: number) => {
    count();
    let url: string;
    try { url = containedUrl(options.root, href, current); } catch { rejected++; return; }
    if (url === current || ambiguous.has(url)) { rejected++; return; }
    const inferredKind = new URL(url).pathname.endsWith('/') ? 'directory' : 'file';
    if (kind && kind !== inferredKind) { rejected++; return; }
    const entry: BdixListingEntry = { url, name: (name.trim() || pathName(url)).slice(0, 512), kind: kind ?? inferredKind };
    if (sizeBytes !== undefined) {
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) { rejected++; return; }
      entry.sizeBytes = sizeBytes;
    }
    const old = entries.get(url);
    if (old && (old.kind !== entry.kind || (old.sizeBytes !== undefined && entry.sizeBytes !== undefined && old.sizeBytes !== entry.sizeBytes))) {
      entries.delete(url); ambiguous.add(url); rejected++; return;
    }
    if (!old) entries.set(url, entry);
  };
  const addNext = (href: string) => {
    count();
    try {
      const url = containedUrl(options.root, href, current, true);
      if (url !== current) next.add(url);
    } catch { rejected++; }
    if (next.size > 4) throw new BdixError('size', 'pagination-limit');
  };
  const type = options.contentType.split(';')[0].trim().toLowerCase();
  if (type === 'application/json' || type === 'application/vnd.cinetor.directory+json') {
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new BdixError('malformed', 'invalid-listing-json'); }
    const nginx = Array.isArray(data);
    const rows = nginx ? data : record(data) ? data.entries : undefined;
    if (!Array.isArray(rows)) throw new BdixError('malformed', 'unsupported-listing-schema');
    if (rows.length > maxItems) throw new BdixError('size', 'listing-item-limit');
    for (const row of rows) {
      if (!record(row) || typeof row.name !== 'string' || !['file', 'directory'].includes(String(row.type))) {
        count(); rejected++; continue;
      }
      let href: string;
      if (nginx) {
        if (!row.name || /[\/\\\u0000-\u001f\u007f]/.test(row.name) || row.name === '.' || row.name === '..') { count(); rejected++; continue; }
        href = encodeURIComponent(row.name) + (row.type === 'directory' ? '/' : '');
      } else if (typeof row.href === 'string') href = row.href;
      else { count(); rejected++; continue; }
      const size = nginx ? row.size : row.sizeBytes;
      if (size !== undefined && typeof size !== 'number') { count(); rejected++; continue; }
      add(href, row.name, row.type as 'file' | 'directory', size as number | undefined);
    }
    if (!nginx && record(data) && data.next !== undefined && data.next !== null) {
      if (typeof data.next !== 'string') throw new BdixError('malformed', 'invalid-pagination');
      addNext(data.next);
    }
  } else if (type === 'text/html' || type === 'application/xhtml+xml') {
    let anchor: { href: string; text: string; next: boolean } | undefined;
    let ignored = 0, tags = 0;
    const flush = () => {
      if (!anchor) return;
      if (anchor.next) addNext(anchor.href);
      else add(anchor.href, anchor.text);
      anchor = undefined;
    };
    const parser = new Parser({
      onopentag(name, attributes) {
        checkAbort(options.signal);
        if (++tags > maxItems * 24 + 256) throw new BdixError('size', 'listing-node-limit');
        if (['script', 'style', 'template', 'iframe', 'object'].includes(name)) { ignored++; return; }
        if (ignored) return;
        if (name === 'a') {
          flush();
          if (typeof attributes.href === 'string' && attributes.href && !attributes.href.startsWith('#'))
            anchor = { href: attributes.href, text: '', next: (attributes.rel ?? '').toLowerCase().split(/\s+/).includes('next') };
        } else if (name === 'link' && (attributes.rel ?? '').toLowerCase().split(/\s+/).includes('next') && attributes.href) addNext(attributes.href);
      },
      ontext(value) { if (anchor && !ignored && anchor.text.length < 512) anchor.text += value.slice(0, 512 - anchor.text.length); },
      onclosetag(name) {
        if (['script', 'style', 'template', 'iframe', 'object'].includes(name)) { ignored = Math.max(0, ignored - 1); return; }
        if (!ignored && name === 'a') flush();
      },
    }, { decodeEntities: true, lowerCaseAttributeNames: true, lowerCaseTags: true });
    // Chunking bounds each synchronous parser pass and checks cancellation between chunks.
    for (let offset = 0; offset < text.length; offset += 8192) { checkAbort(options.signal); parser.write(text.slice(offset, offset + 8192)); }
    parser.end(); flush();
  } else throw new BdixError('unsupported', 'listing-content-type');
  checkAbort(options.signal);
  return { entries: [...entries.values()], next: [...next], rejected, observed, ambiguous: [...ambiguous] };
}
