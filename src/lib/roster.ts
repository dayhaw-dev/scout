export type RosterLookup =
  | {
    kind: "channel_id";
    value: string;
    resolveInput: string;
  }
  | {
    kind: "handle";
    value: string;
    resolveInput: string;
  }
  | {
    kind: "url";
    value: string;
    resolveInput: string;
  };

export class RosterInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RosterInputError";
  }
}

const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{20,}$/;
const HANDLE_PATTERN = /^[A-Za-z0-9_.-]{3,30}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
]);

export function normalizeRosterInput(rawInput: string): RosterLookup {
  const input = rawInput.trim();
  if (!input) {
    throw new RosterInputError("Paste a YouTube channel URL or @handle.");
  }

  if (input.startsWith("@")) {
    const handle = input.slice(1);
    if (!HANDLE_PATTERN.test(handle)) {
      throw new RosterInputError("That @handle is not valid.");
    }
    return {
      kind: "handle",
      value: handle.toLowerCase(),
      resolveInput: `@${handle}`,
    };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new RosterInputError("Use a full YouTube channel URL or an @handle.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new RosterInputError("Use an http or https YouTube channel URL.");
  }
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new RosterInputError("Only youtube.com channel URLs are supported.");
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 1 && segments[0].startsWith("@")) {
    const handle = segments[0].slice(1);
    if (!HANDLE_PATTERN.test(handle)) {
      throw new RosterInputError("That @handle URL is not valid.");
    }
    return {
      kind: "handle",
      value: handle.toLowerCase(),
      resolveInput: `@${handle}`,
    };
  }

  if (segments.length !== 2) {
    throw new RosterInputError("That is not a YouTube channel URL.");
  }

  const [route, identifier] = segments;
  if (route === "channel" && CHANNEL_ID_PATTERN.test(identifier)) {
    return {
      kind: "channel_id",
      value: identifier,
      resolveInput: identifier,
    };
  }

  if ((route === "c" || route === "user") && identifier.length > 0) {
    const normalizedUrl = `https://www.youtube.com/${route}/${encodeURIComponent(identifier)}`;
    return {
      kind: "url",
      value: normalizedUrl,
      resolveInput: normalizedUrl,
    };
  }

  throw new RosterInputError("That is not a supported YouTube channel URL.");
}
