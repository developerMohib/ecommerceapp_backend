import dotenv from "dotenv";
dotenv.config();
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 20),
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});
export const db = drizzle(pool, { schema });
