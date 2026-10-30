import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

// Synchronizer-token CSRF protection: one random token per session, sent back by forms
// (hidden field "_csrf") and by fetch calls (header "X-CSRF-Token").

export function getCsrfToken(req: Request): string {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString("base64url");
  return req.session.csrfToken;
}

function tokensMatch(expected: string | undefined, provided: unknown): boolean {
  if (!expected || typeof provided !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function verifyCsrf(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  const provided = req.get("x-csrf-token") ?? (req.body as Record<string, unknown> | undefined)?._csrf;
  if (tokensMatch(req.session.csrfToken, provided)) return next();
  if (req.accepts(["json", "html"]) === "json" || req.path.startsWith("/api/")) {
    res.status(403).json({ error: "Your session expired. Reload the page and try again." });
  } else {
    res.status(403).send("Your session expired. Go back, reload the page and try again.");
  }
}
