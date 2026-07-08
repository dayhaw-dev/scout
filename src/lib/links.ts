const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/u;
const ALLOWED_LINK_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

export interface ContactLink {
  type: string;
  label: string;
  url: string;
}

export function sanitizeContactUrl(value: string, field: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || CONTROL_CHAR_PATTERN.test(trimmed)) return null;

  const candidate = field === "email" && !/^mailto:/i.test(trimmed)
    ? `mailto:${trimmed}`
    : trimmed;

  try {
    const url = new URL(candidate);
    if (!ALLOWED_LINK_PROTOCOLS.has(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function sanitizedContactLinks(raw: unknown): ContactLink[] {
  if (!raw || typeof raw !== "object") return [];
  const record = raw as Record<string, unknown>;
  const fields: Array<[string, string]> = [
    ["email", "Email"],
    ["instagram", "Instagram"],
    ["tiktok", "TikTok"],
    ["twitter", "X"],
    ["facebook", "Facebook"],
    ["website", "Website"],
  ];
  const links: ContactLink[] = [];

  for (const [field, label] of fields) {
    const values = Array.isArray(record[field]) ? record[field] : [record[field]];
    for (const value of values) {
      if (typeof value !== "string" || !value.trim()) continue;
      const url = sanitizeContactUrl(value, field);
      if (!url) continue;
      links.push({ type: field, label, url });
    }
  }

  return links;
}
