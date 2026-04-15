import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const connectionString = process.env.NEON_DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "NEON_DATABASE_URL must be set. Did you forget to configure the Neon database secret?",
  );
}

export const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

// Garante search_path correto em cada nova conexão (necessário para Neon pooler)
// Sem setImmediate: o SET search_path é enfileirado antes de qualquer query do cliente
pool.on("connect", (client) => {
  client.query("SET search_path TO public").catch(() => {});
});

export const db = drizzle(pool, { schema });

export * from "./schema";
