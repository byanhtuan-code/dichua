import { params } from "../debug/params.ts";
import { HttpAccountApi, MockAccountApi, type AccountApi } from "./account-api.ts";
import { readNear } from "./invite.ts";
import { MockNetDriver, parseMock } from "./mock-driver.ts";
import type { NetDriver } from "./net-driver.ts";
import { WebSocketNetDriver } from "./ws-driver.ts";

/** `?mock` (dev / `?e2e=1` only) → offline mock; otherwise the real server (P-D4). */
export function createDriver(): NetDriver {
  const mock = params().mock;
  return mock !== null ? new MockNetDriver(parseMock(mock)) : new WebSocketNetDriver({ near: readNear(location.search) });
}

let accountApi: AccountApi | null = null;

/**
 * Same switch as createDriver: `?mock` keeps accounts in memory, otherwise the server's HTTP API (P4-D5).
 * One instance per page: separate mock instances would not see each other's accounts.
 */
export function createAccountApi(): AccountApi {
  accountApi ??= params().mock !== null ? new MockAccountApi() : new HttpAccountApi();
  return accountApi;
}
