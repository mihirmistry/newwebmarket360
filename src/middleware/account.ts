import type { NextFunction, Request, RequestHandler, Response } from "express";
import type pg from "pg";
import { findCustomerById, type Customer } from "../services/customers.js";
import { getCsrfToken } from "./csrf.js";

/** What the header's profile menu needs. */
export interface HeaderAccount {
  name: string;
  firstName: string;
  initials: string;
  email: string;
  csrfToken: string;
}

export function headerAccount(customer: Customer, csrfToken: string): HeaderAccount {
  const words = customer.name.trim().split(/\s+/);
  const first = words[0] ?? customer.name;
  const last = words.length > 1 ? words[words.length - 1]! : "";
  return {
    name: customer.name,
    firstName: first.length > 14 ? `${first.slice(0, 13)}…` : first,
    initials: (first.charAt(0) + last.charAt(0)).toUpperCase(),
    email: customer.email,
    csrfToken,
  };
}

/**
 * Looks up the signed-in customer (if any) for every page so the header can show the profile menu.
 * Visitors who never signed in have no session cookie, so this costs nothing for them.
 * Sets res.locals.customer (full record) and res.locals.account (header data), both null when signed out.
 */
export function loadAccount(pool: pg.Pool): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    res.locals.customer = null;
    res.locals.account = null;
    const id = req.session?.customerId;
    if (!id || req.path.startsWith("/api/")) return next();
    try {
      const customer = await findCustomerById(pool, id);
      if (customer) {
        res.locals.customer = customer;
        res.locals.account = headerAccount(customer, getCsrfToken(req));
      } else {
        delete req.session.customerId; // account was deleted
      }
    } catch (err) {
      // Show the page signed-out rather than failing it.
      console.error("account lookup failed:", (err as Error).message);
    }
    next();
  };
}

/** For /account pages: signed-out visitors get the log in popup and come back here afterwards. */
export function requireCustomer(req: Request, res: Response, next: NextFunction): void {
  if (res.locals.customer) return next();
  // req.path is relative to where this middleware is mounted, so rebuild the full path.
  const path = `${req.baseUrl}${req.path}`.replace(/\/+$/, "") || "/";
  res.redirect(303, `/?auth=login&next=${encodeURIComponent(path)}`);
}
