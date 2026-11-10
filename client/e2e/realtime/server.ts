import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../..");

// afterAll does not run when the worker exits early: kill what is still up so no stray server holds the port.
const live = new Set<ChildProcess>();
process.once("exit", () => {
  for (const p of live) p.kill("SIGKILL");
});

async function answers(url: string): Promise<boolean> {
  try {
    return (await fetch(`${url}/api/ping`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

export interface TestServer {
  url: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** SIGSTOP / SIGCONT: sockets stay open but nothing answers (a dead network that never sends a close). */
  pause(): void;
  resume(): void;
}

/** Extra Node server on its own port; `start` after `stop` reuses the same port (AC14). */
export function testServer(port: number, env: Record<string, string>): TestServer {
  let child: ChildProcess | null = null;
  const url = `http://localhost:${port}`;

  async function waitReady(): Promise<void> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (await answers(url)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`server on ${port} did not start`);
  }

  return {
    url,
    async start() {
      if (child) return;
      // Otherwise our server dies on EADDRINUSE unseen and the spec talks to the old one (wrong env, `stop` kills nothing).
      if (await answers(url)) throw new Error(`port ${port} already has a server (an earlier run?): lsof -ti:${port} | xargs kill`);
      const proc = spawn("node", ["server/src/main.ts"], {
        cwd: ROOT,
        env: { ...process.env, STATIC_DIR: "client/dist", PORT: String(port), ...env },
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      proc.stderr?.on("data", (d: Buffer) => {
        stderr = (stderr + String(d)).slice(-4000);
      });
      child = proc;
      live.add(proc);
      const died = new Promise<never>((_, fail) => {
        proc.once("exit", (code, signal) => {
          live.delete(proc);
          if (child === proc) child = null;
          fail(new Error(`server on ${port} exited (${code ?? signal}) before it was ready:\n${stderr}`));
        });
      });
      // Rejects again when `stop` kills it later; nobody waits on it then.
      died.catch(() => {});
      await Promise.race([waitReady(), died]);
    },
    pause() {
      child?.kill("SIGSTOP");
    },
    resume() {
      child?.kill("SIGCONT");
    },
    async stop() {
      const proc = child;
      if (!proc) return;
      proc.kill("SIGCONT");
      child = null;
      const exited = new Promise<void>((ok) => proc.once("exit", () => ok()));
      proc.kill("SIGKILL");
      await exited;
    },
  };
}
