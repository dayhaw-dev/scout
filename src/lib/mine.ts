export type ChannelRefType = "handle" | "channelId" | "customUrl";

export interface ChannelRef {
  type: ChannelRefType;
  ref: string;
  collab: boolean;
}

export interface MineOptions {
  seedHandle?: string | null;
  seedChannelId?: string | null;
}

interface CandidateRef {
  type: ChannelRefType;
  ref: string;
  index: number;
}

const HANDLE_PATTERN = /^[A-Za-z0-9_.-]{3,30}$/;
const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{20,}$/;
const COLLAB_PATTERN = /\b(feat(?:uring)?|collab|ft\.)\b|with\s+@/i;

export function mineChannelRefs(
  description: string | null | undefined,
  options: MineOptions = {},
): ChannelRef[] {
  if (!description) return [];

  const candidates = [
    ...extractUrlRefs(description),
    ...extractMentionRefs(description),
  ].filter((candidate) => !isSelfRef(candidate, options));

  const refs = new Map<string, ChannelRef>();

  for (const candidate of candidates) {
    const key = `${candidate.type}:${candidate.ref.toLowerCase()}`;
    const collab = hasCollabLanguageNear(description, candidate.index);
    const existing = refs.get(key);

    if (existing) {
      existing.collab = existing.collab || collab;
      continue;
    }

    refs.set(key, {
      type: candidate.type,
      ref: candidate.ref,
      collab,
    });
  }

  return [...refs.values()];
}

function extractMentionRefs(description: string): CandidateRef[] {
  const refs: CandidateRef[] = [];
  const mentionPattern = /(^|[^A-Za-z0-9_.%+-])@([A-Za-z0-9_.-]{3,30})/g;
  let match: RegExpExecArray | null;

  while ((match = mentionPattern.exec(description)) !== null) {
    const handle = normalizeHandle(match[2]);
    if (!handle || !HANDLE_PATTERN.test(handle)) continue;

    refs.push({
      type: "handle",
      ref: handle,
      index: match.index + match[1].length,
    });
  }

  return refs;
}

function extractUrlRefs(description: string): CandidateRef[] {
  const refs: CandidateRef[] = [];
  const urlPattern =
    /(?:https?:\/\/)?(?:www\.)?(?:m\.)?youtube\.com\/(?:@([A-Za-z0-9_.-]{3,30})|channel\/(UC[A-Za-z0-9_-]{20,})|c\/([A-Za-z0-9_.-]{3,80}))(?:[/?#][^\s)]*)?/gi;
  let match: RegExpExecArray | null;

  while ((match = urlPattern.exec(description)) !== null) {
    if (match[1]) {
      const handle = normalizeHandle(match[1]);
      if (handle && HANDLE_PATTERN.test(handle)) {
        refs.push({ type: "handle", ref: handle, index: match.index });
      }
      continue;
    }

    if (match[2] && CHANNEL_ID_PATTERN.test(match[2])) {
      refs.push({ type: "channelId", ref: match[2], index: match.index });
      continue;
    }

    if (match[3]) {
      const name = match[3].replace(/[.,;:!?]+$/g, "");
      refs.push({
        type: "customUrl",
        ref: `https://www.youtube.com/c/${name}`,
        index: match.index,
      });
    }
  }

  return refs;
}

function normalizeHandle(value: string): string | null {
  const normalized = value.replace(/^@/, "").replace(/[.,;:!?]+$/g, "");
  return normalized.length > 0 ? normalized : null;
}

function hasCollabLanguageNear(description: string, index: number): boolean {
  const lineStart = description.lastIndexOf("\n", index) + 1;
  const nextLineBreak = description.indexOf("\n", index);
  const lineEnd = nextLineBreak === -1 ? description.length : nextLineBreak;
  const start = Math.max(lineStart, index - 80);
  const end = Math.min(lineEnd, index + 80);
  return COLLAB_PATTERN.test(description.slice(start, end));
}

function isSelfRef(candidate: CandidateRef, options: MineOptions): boolean {
  if (
    candidate.type === "handle" &&
    options.seedHandle &&
    candidate.ref.toLowerCase() ===
      options.seedHandle.replace(/^@/, "").toLowerCase()
  ) {
    return true;
  }

  if (
    candidate.type === "channelId" &&
    options.seedChannelId &&
    candidate.ref === options.seedChannelId
  ) {
    return true;
  }

  if (
    candidate.type === "customUrl" &&
    options.seedHandle &&
    candidate.ref
      .toLowerCase()
      .endsWith(`/c/${options.seedHandle.replace(/^@/, "").toLowerCase()}`)
  ) {
    return true;
  }

  return false;
}
