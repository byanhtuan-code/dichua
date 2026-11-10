// Runs the realtime server (4663, restarts on change) and Vite (4664) together; either dying stops both.
import { spawn } from "node:child_process";

// Dev-only admin password so /admin works locally; override with ADMIN_PASSWORD. Never a server default (prod keeps /admin off unless set).
const env = { ...process.env, ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "abcd1234" };

const procs = [
  spawn("node", ["--watch", "--disable-warning=ExperimentalWarning", "server/src/main.ts"], { stdio: "inherit", env }),
  spawn("npx", ["vite", "--config", "client/vite.config.ts", "client"], { stdio: "inherit" }),
];

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500).unref();
}
for (const p of procs) p.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
