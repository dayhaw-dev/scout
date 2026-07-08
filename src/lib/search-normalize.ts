export interface SearchChannelRef {
  type: "channelId" | "handle" | "url";
  ref: string;
  title?: string;
  hitCount: number;
  sources: string[];
}

interface SearchChannelShape {
  id?: unknown;
  channelId?: unknown;
  title?: unknown;
  name?: unknown;
  handle?: unknown;
  url?: unknown;
  channel?: unknown;
}

interface SearchItemShape {
  type?: unknown;
  channel?: unknown;
  owner?: unknown;
  author?: unknown;
  id?: unknown;
  channelId?: unknown;
  handle?: unknown;
  title?: unknown;
}

export interface SearchResultsShape {
  videos?: unknown;
  channels?: unknown;
  playlists?: unknown;
  shorts?: unknown;
  lives?: unknown;
  shelves?: unknown;
}

export function normalizeSearchChannelRefs(results: SearchResultsShape): SearchChannelRef[] {
  const refs = new Map<string, SearchChannelRef>();

  addRefs(refs, "channel", arrayOf(results.channels).map(channelRefFromChannelResult));
  addRefs(refs, "video", arrayOf(results.videos).map(channelRefFromMediaResult));
  addRefs(refs, "short", arrayOf(results.shorts).map(channelRefFromMediaResult));
  addRefs(refs, "live", arrayOf(results.lives).map(channelRefFromMediaResult));
  addRefs(refs, "playlist", arrayOf(results.playlists).map(channelRefFromPlaylistResult));

  for (const shelf of arrayOf(results.shelves)) {
    const record = asRecord(shelf);
    for (const item of arrayOf(record?.items)) {
      addRefs(refs, "shelf", [channelRefFromMediaResult(item)]);
    }
  }

  return [...refs.values()].sort(
    (a, b) => b.hitCount - a.hitCount || a.ref.localeCompare(b.ref),
  );
}

function addRefs(
  refs: Map<string, SearchChannelRef>,
  source: string,
  candidates: Array<Omit<SearchChannelRef, "hitCount" | "sources"> | null>,
): void {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = `${candidate.type}:${candidate.ref.toLowerCase()}`;
    const existing = refs.get(key);
    if (existing) {
      existing.hitCount += 1;
      existing.sources.push(source);
      continue;
    }

    refs.set(key, {
      ...candidate,
      hitCount: 1,
      sources: [source],
    });
  }
}

function channelRefFromChannelResult(
  input: unknown,
): Omit<SearchChannelRef, "hitCount" | "sources"> | null {
  const channel = asRecord(input) as SearchChannelShape | null;
  if (!channel) return null;
  return channelRefFromShape(channel);
}

function channelRefFromMediaResult(
  input: unknown,
): Omit<SearchChannelRef, "hitCount" | "sources"> | null {
  const item = asRecord(input) as SearchItemShape | null;
  if (!item) return null;
  const channel = asRecord(item.channel) ?? asRecord(item.owner) ?? asRecord(item.author);
  return channelRefFromShape(channel ?? item);
}

function channelRefFromPlaylistResult(
  input: unknown,
): Omit<SearchChannelRef, "hitCount" | "sources"> | null {
  const playlist = asRecord(input) as SearchItemShape | null;
  if (!playlist) return null;
  const channel = asRecord(playlist.channel) ?? asRecord(playlist.owner) ?? asRecord(playlist.author);
  return channel ? channelRefFromShape(channel) : null;
}

function channelRefFromShape(
  input: SearchChannelShape | Record<string, unknown> | null,
): Omit<SearchChannelRef, "hitCount" | "sources"> | null {
  if (!input) return null;
  const id = stringValue(input.id) ?? stringValue(input.channelId);
  const handle = normalizeHandle(stringValue(input.handle));
  const url = stringValue(input.url) ?? stringValue(input.channel);
  const title = stringValue(input.title) ?? stringValue(input.name) ?? undefined;

  if (id && id.startsWith("UC")) {
    return { type: "channelId", ref: id, title };
  }

  if (handle) {
    const channelIdFromHandle = handle.match(/^channel\/(UC[A-Za-z0-9_-]{20,})$/);
    if (channelIdFromHandle) {
      return { type: "channelId", ref: channelIdFromHandle[1], title };
    }
    return { type: "handle", ref: handle.replace(/^@/, ""), title };
  }

  if (url) {
    const channelIdFromUrl = url.match(/\/channel\/(UC[A-Za-z0-9_-]{20,})/);
    if (channelIdFromUrl) {
      return { type: "channelId", ref: channelIdFromUrl[1], title };
    }

    const handleFromUrl = url.match(/\/@([A-Za-z0-9_.-]{3,30})/);
    if (handleFromUrl) {
      return { type: "handle", ref: handleFromUrl[1], title };
    }

    if (/^https?:\/\/(?:www\.)?youtube\.com\/c\/[^/?#]{3,}$/i.test(url)) {
      return { type: "url", ref: url, title };
    }
  }

  return null;
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeHandle(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/^https?:\/\/(?:www\.)?youtube\.com\//i, "").replace(/^@/, "");
}
