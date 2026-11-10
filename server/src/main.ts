import { Accounts } from "./accounts.ts";
import { loadConfig } from "./config.ts";
import { createAppServer } from "./http.ts";
import { RoomHub } from "./hub.ts";
import { PopulationStore } from "./population-store.ts";
import { RoomNamesStore } from "./room-names-store.ts";

const SHUTDOWN_MS = 5000;

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(`config: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

const population = new PopulationStore(config.dataDir, config.capacity);
const roomNames = new RoomNamesStore(config.dataDir);
const accounts = new Accounts(config.dataDir);
const hub = new RoomHub(
  config.capacity,
  Date.now,
  config.fakePopulation,
  () => population.current,
  () => roomNames.current,
  accounts,
);
const server = createAppServer(config, hub, Date.now, population, roomNames, accounts);

// A bug must not leave a half-broken process holding ten rooms: log, exit, let Docker restart it.
process.on("uncaughtException", (err) => {
  console.error("uncaughtException", err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection", err);
  process.exit(1);
});

function shutdown(signal: string): void {
  console.log(`${signal}: shutting down`);
  hub.closeAll(1001);
  server.close(() => {
    accounts.close();
    process.exit(0);
  });
  server.closeAllConnections();
  setTimeout(() => process.exit(0), SHUTDOWN_MS).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

server.listen(config.port, () => {
  const addr = server.address();
  console.log(`santinh server on :${typeof addr === "object" && addr ? addr.port : config.port}`);
});
