import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { IDLE_TIMEOUT_MS, PING_EVERY_MS } from "@santinh/shared";
import { Room } from "../src/room.ts";

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  pings = 0;
  terminated = false;
  sent: unknown[] = [];
  send(data: unknown): void {
    this.sent.push(data);
  }
  ping(): void {
    this.pings++;
  }
  terminate(): void {
    this.terminated = true;
    this.readyState = 3;
    this.emit("close");
  }
  close(): void {
    this.readyState = 3;
    this.emit("close");
  }
}
const asWs = (s: FakeSocket): WebSocket => s as unknown as WebSocket;

describe("heartbeat", () => {
  let now = 0;
  beforeEach(() => {
    now = 1_000_000;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pings live sockets, drops a silent one, and stops the timer when empty", () => {
    const room = new Room("san-01", 30, () => now);
    const quiet = new FakeSocket();
    const chatty = new FakeSocket();
    room.join(asWs(quiet));
    room.join(asWs(chatty));
    expect(vi.getTimerCount()).toBe(2); // heartbeat + tick

    for (let t = 0; t < IDLE_TIMEOUT_MS + PING_EVERY_MS; t += PING_EVERY_MS) {
      now += PING_EVERY_MS;
      chatty.emit("pong");
      vi.advanceTimersByTime(PING_EVERY_MS);
    }
    expect(quiet.terminated).toBe(true);
    expect(chatty.terminated).toBe(false);
    expect(chatty.pings).toBeGreaterThan(0);
    expect(room.size).toBe(1);

    chatty.close();
    expect(room.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
