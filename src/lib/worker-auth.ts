import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export function hasWorkerAuthorization(request: NextRequest) {
  const expected = process.env.WORKER_TOKEN;
  const presented = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !presented) return false;
  const expectedHash = createHash("sha256").update(expected).digest();
  const presentedHash = createHash("sha256").update(presented).digest();
  return timingSafeEqual(expectedHash, presentedHash);
}
