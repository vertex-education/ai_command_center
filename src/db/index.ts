/// <reference path="../../worker-configuration.d.ts" />

import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";

export type AppDrizzleDb = ReturnType<typeof createDrizzleDb>;

export type DbContext = {
  db: AppDrizzleDb;
  d1: D1Database;
};

type CloudflareRequestContext = {
  cloudflare?: {
    env?: Partial<Env>;
  };
};

export function getD1Binding(context?: CloudflareRequestContext) {
  const db = context?.cloudflare?.env?.DB ?? (env as Env).DB;
  if (!db) throw new Error("D1 binding DB is required.");
  return db;
}

export function createDrizzleDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export function createDbContext(context?: CloudflareRequestContext): DbContext {
  const d1 = getD1Binding(context);
  return {
    d1,
    db: createDrizzleDb(d1),
  };
}
