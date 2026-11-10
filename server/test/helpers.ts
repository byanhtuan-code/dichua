import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { WebSocket } from "ws";
import { decodeDelta, type DeltaFrame, type ServerMsg } from "@santinh/shared";
import { loadConfig, type Config } from "../src/config.ts";
import { createAppServer } from "../src/http.ts";
import { RoomHub } from "../src/hub.ts";

export interface TestServer {
  port: number;
  hub: RoomHub;
  server: Server;
  clients: TestClient[];
  connect(room: string, headers?: Record<string, string>): TestClient;
  stop(): Promise<void>;
}

export async function startServer(env: Record<string, string> = {}): Promise<TestServer> {
  const config: Config = loadConfig({ PORT: "0", FAKE_POPULATION: "off", MAX_CONN_PER_IP_ROOM: "0", ...env });
  const hub = new RoomHub(config.capacity, Date.now, config.fakePopulation);
  const server = createAppServer(config, hub);
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  const clients: TestClient[] = [];
  return {
    port,
    hub,
    server,
    clients,
    connect(room, headers) {
      const c = new TestClient(`ws://127.0.0.1:${port}/ws?room=${room}`, headers);
      clients.push(c);
      return c;
    },
    async stop() {
      for (const c of clients) c.ws.terminate();
      hub.closeAll(1001);
      server.closeAllConnections();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}

/** A `ws` client that records every JSON message and binary frame. */
export class TestClient {
  readonly ws: WebSocket;
  readonly json: ServerMsg[] = [];
  readonly frames: DeltaFrame[] = [];
  closeCode: number | null = null;
  private waiters: (() => void)[] = [];

  constructor(url: string, headers?: Record<string, string>) {
    this.ws = new WebSocket(url, { headers });
    this.ws.on("message", (data, isBinary) => {
      if (isBinary) {
        const frame = decodeDelta(data as Buffer);
        if (frame) this.frames.push(frame);
      } else {
        this.json.push(JSON.parse(String(data)) as ServerMsg);
      }
      this.wake();
    });
    this.ws.on("close", (code) => {
      this.closeCode = code;
      this.wake();
    });
    this.ws.on("error", () => this.wake());
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  async until(cond: () => boolean, ms = 3000): Promise<void> {
    const end = Date.now() + ms;
    while (!cond()) {
      const left = end - Date.now();
      if (left <= 0) throw new Error("timeout waiting for condition");
      await new Promise<void>((ok) => {
        this.waiters.push(ok);
        setTimeout(ok, Math.min(left, 50));
      });
    }
  }

  snapshot(): Extract<ServerMsg, { type: "snapshot" }> | undefined {
    return this.json.find((m): m is Extract<ServerMsg, { type: "snapshot" }> => m.type === "snapshot");
  }
}

/** Raw HTTP upgrade attempt: resolves with the status line's code. */
export function upgradeStatus(port: number, path: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((ok) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
    ws.on("unexpected-response", (_req, res) => {
      ok(res.statusCode ?? 0);
      res.resume();
    });
    ws.on("open", () => {
      ok(101);
      ws.terminate();
    });
    ws.on("error", () => undefined);
  });
}
