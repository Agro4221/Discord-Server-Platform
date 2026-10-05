import { createServer, type Server } from "node:http";

export type HealthState = {
  status: "starting" | "ready" | "degraded";
  startedAt: string;
  discord: "connecting" | "ready" | "down";
  database: "connecting" | "ready" | "down";
  modules: Record<string, "starting" | "ready" | "degraded" | "down">;
  lastError?: string;
};

export function healthStatusCode(path: string, state: HealthState): number {
  if (path !== "/health" && path !== "/ready") return 404;
  if (path === "/health") return state.database === "ready" ? 200 : 503;
  return state.status === "ready" ? 200 : 503;
}

export class HealthServer {
  private server?: Server;
  private state: HealthState = {
    status: "starting",
    startedAt: new Date().toISOString(),
    discord: "connecting",
    database: "connecting",
    modules: {}
  };

  set(partial: Partial<HealthState>): void {
    this.state = { ...this.state, ...partial };
  }

  setModule(name: string, status: HealthState["modules"][string]): void {
    this.state.modules[name] = status;
  }

  get(): HealthState {
    return structuredClone(this.state);
  }

  start(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        if (req.url === "/health" || req.url === "/ready") {
          const payload = JSON.stringify(this.state);
          res.writeHead(healthStatusCode(req.url, this.state), {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store"
          });
          res.end(payload);
          return;
        }

        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found");
      });

      this.server.once("error", reject);
      this.server.listen(port, host, () => resolve());
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
