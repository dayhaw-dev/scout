export function parseCountText(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value) : null;
  }

  const normalized = value.replace(/,/g, "").trim();
  const compact = normalized.match(/([\d.]+)\s*([KMB])\b/i);
  if (compact) {
    const number = Number(compact[1]);
    const suffix = compact[2].toUpperCase();
    const multiplier =
      suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : 1_000_000_000;
    return Math.round(number * multiplier);
  }

  const digits = normalized.match(/\d+/);
  return digits ? Math.round(Number(digits[0])) : null;
}

export function parseJoinedDate(value: string | undefined): string | null {
  if (!value) return null;

  const parsed = new Date(value.replace(/^Joined\s+/i, ""));
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString();
}

const CP1252_SPECIALS = new Map<string, number>([
  ["€", 0x80],
  ["‚", 0x82],
  ["ƒ", 0x83],
  ["„", 0x84],
  ["…", 0x85],
  ["†", 0x86],
  ["‡", 0x87],
  ["ˆ", 0x88],
  ["‰", 0x89],
  ["Š", 0x8a],
  ["‹", 0x8b],
  ["Œ", 0x8c],
  ["Ž", 0x8e],
  ["‘", 0x91],
  ["’", 0x92],
  ["“", 0x93],
  ["”", 0x94],
  ["•", 0x95],
  ["–", 0x96],
  ["—", 0x97],
  ["˜", 0x98],
  ["™", 0x99],
  ["š", 0x9a],
  ["›", 0x9b],
  ["œ", 0x9c],
  ["ž", 0x9e],
  ["Ÿ", 0x9f],
]);

export function normalizeUnicodeText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  let normalized = value.normalize("NFC");
  normalized = normalized
    .replaceAll("â„¢", "™")
    .replaceAll("â¢", "™")
    .replaceAll("â€™", "'")
    .replaceAll("â€œ", "\"")
    .replaceAll("â€", "\"")
    .replaceAll("â€“", "-")
    .replaceAll("â€”", "-");

  if (!/[ÂÃâ][\u0080-\u017f]/.test(normalized)) {
    return normalized;
  }

  const bytes: number[] = [];
  for (const char of normalized) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) continue;
    const mapped = CP1252_SPECIALS.get(char);
    if (mapped !== undefined) {
      bytes.push(mapped);
    } else if (codePoint <= 0xff) {
      bytes.push(codePoint);
    } else {
      return normalized;
    }
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return normalized;
  }
}
