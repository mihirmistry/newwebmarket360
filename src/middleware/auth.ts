import type { NextFunction, Request, Response } from "express";
import type pg from "pg";
import { findAdminById, type AdminUser } from "../services/admins.js";

declare module "express-serve-static-core" {
  interface Request {
    admin?: AdminUser;
  }
}

/**
 * Server-side authorization for every admin page and admin API call. The session only stores the
 * admin id; the account is re-checked on each request so deleted admins lose access immediately.
 */
export function requireAdmin(pool: pg.Pool, mode: "page" | "api") {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const admin = req.session.adminId ? await findAdminById(pool, req.session.adminId) : null;
      if (admin) {
        req.admin = admin;
        res.set("Cache-Control", "no-store");
        return next();
      }
      if (req.session.adminId) delete req.session.adminId;
      if (mode === "api") {
        res.status(401).json({ error: "Please sign in again." });
      } else {
        res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
      }
    } catch (err) {
      next(err);
    }
  };
}
