import { Pool, type PoolClient, type QueryResult } from "pg";
import { logger } from "./logger.js";

export class Database {
  readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    });

    this.pool.on("error", (error) => {
      logger.error("Unexpected PostgreSQL pool error", { error: error.message });
    });
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch((rollbackError) => {
        logger.error("PostgreSQL transaction rollback failed", {
          error: String(error),
          rollbackError: String(rollbackError)
        });
      });
      logger.warn("PostgreSQL transaction rolled back", { error: String(error) });
      throw error;
    } finally {
      client.release();
    }
  }

  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: unknown[] = []
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
