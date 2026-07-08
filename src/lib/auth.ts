export const AUTH_FAILURE_DELAY_MS = 1000;
export const AUTH_FAILURE_LIMIT = 10;
export const AUTH_WINDOW_MS = 10 * 60 * 1000;

export interface AuthDecision {
  ok: boolean;
  status?: 401 | 429 | 500;
  message?: string;
  retryAfterSeconds?: number;
  delay?: boolean;
}

export function constantTimeEqual(presented: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const presentedBytes = encoder.encode(presented);
  const expectedBytes = encoder.encode(expected);
  const maxLength = Math.max(presentedBytes.length, expectedBytes.length);
  let diff = presentedBytes.length ^ expectedBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (presentedBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }

  return diff === 0;
}

export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip")?.trim() || "unidentifiable";
}

export async function evaluateAdminAuth(
  db: D1Database,
  request: Request,
  expectedKey: string | undefined,
  now = new Date(),
): Promise<AuthDecision> {
  if (!expectedKey) {
    return {
      ok: false,
      status: 500,
      message: "SCOUT_ADMIN_KEY is not configured",
    };
  }

  const ip = clientIp(request);
  const current = await currentFailureWindow(db, ip, now);
  if (current.blocked) {
    return {
      ok: false,
      status: 429,
      message: "Too many failed auth attempts. Try again after the cooldown.",
      retryAfterSeconds: current.retryAfterSeconds,
      delay: true,
    };
  }

  const presentedKey = request.headers.get("x-scout-key") ?? "";
  if (constantTimeEqual(presentedKey, expectedKey)) {
    await clearAuthFailures(db, ip);
    return { ok: true };
  }

  await recordAuthFailure(db, ip, now);
  return {
    ok: false,
    status: 401,
    message: "Unauthorized",
    delay: true,
  };
}

export async function currentFailureWindow(
  db: D1Database,
  ip: string,
  now = new Date(),
): Promise<{ blocked: boolean; retryAfterSeconds: number; count: number }> {
  const row = await db
    .prepare("SELECT count, window_start FROM auth_failures WHERE ip = ?")
    .bind(ip)
    .first<{ count: number; window_start: string }>();

  if (!row) return { blocked: false, retryAfterSeconds: 0, count: 0 };

  const elapsed = now.getTime() - new Date(row.window_start).getTime();
  if (elapsed >= AUTH_WINDOW_MS) {
    await clearAuthFailures(db, ip);
    return { blocked: false, retryAfterSeconds: 0, count: 0 };
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((AUTH_WINDOW_MS - elapsed) / 1000));
  return {
    blocked: row.count >= AUTH_FAILURE_LIMIT,
    retryAfterSeconds,
    count: row.count,
  };
}

export async function recordAuthFailure(
  db: D1Database,
  ip: string,
  now = new Date(),
): Promise<void> {
  const row = await db
    .prepare("SELECT count, window_start FROM auth_failures WHERE ip = ?")
    .bind(ip)
    .first<{ count: number; window_start: string }>();

  if (!row || now.getTime() - new Date(row.window_start).getTime() >= AUTH_WINDOW_MS) {
    await db
      .prepare(
        `INSERT INTO auth_failures (ip, count, window_start)
        VALUES (?, 1, ?)
        ON CONFLICT(ip) DO UPDATE SET
          count = excluded.count,
          window_start = excluded.window_start`,
      )
      .bind(ip, now.toISOString())
      .run();
    return;
  }

  await db
    .prepare("UPDATE auth_failures SET count = count + 1 WHERE ip = ?")
    .bind(ip)
    .run();
}

export async function clearAuthFailures(db: D1Database, ip: string): Promise<void> {
  await db.prepare("DELETE FROM auth_failures WHERE ip = ?").bind(ip).run();
}
