import { describe, expect, it, vi as vitest } from "vitest";
import type { CopyResult } from "../net/invite.ts";
import { NetEmitter } from "../net/net-driver.ts";
import { InviteAction } from "./invite-action.ts";

function setup(copy: (text: string) => Promise<CopyResult> = async () => "copied") {
  const net = new NetEmitter();
  const action = new InviteAction({ net, currentRoom: () => "san-01", copy, origin: () => "https://santinh.com" });
  const join = (selfId = "v:abc"): void => {
    net.emit("status", "connected");
    net.emit("snapshot", { selfId, room: "san-03", visitors: [], serverTime: 0, reserved: null, roomName: "Thanh Tịnh" });
  };
  return { net, action, join };
}

const LINK = "https://santinh.com/?room=san-03&near=v:abc";

describe("InviteAction", () => {
  it("has no link before we are connected with an id", async () => {
    const copy = vitest.fn(async (): Promise<CopyResult> => "copied");
    const { net, action } = setup(copy);
    expect(action.link()).toBeNull();
    net.emit("status", "connected");
    expect(action.link()).toBeNull();
    expect(await action.copy()).toBeNull();
    expect(copy).not.toHaveBeenCalled();
  });

  it("forgets the id when the link drops, and tells listeners", () => {
    const { net, action, join } = setup();
    const changed = vitest.fn();
    action.onChange(changed);
    join();
    expect(action.link()).toBe(LINK);
    net.emit("status", "reconnecting");
    expect(action.link()).toBeNull();
    join("v:new");
    expect(action.link()).toBe("https://santinh.com/?room=san-03&near=v:new");
    expect(changed).toHaveBeenCalled();
  });

  it("copies the current link and passes the result on", async () => {
    let result: CopyResult = "copied";
    const copy = vitest.fn(async (): Promise<CopyResult> => result);
    const { action, join } = setup(copy);
    join();
    expect(await action.copy()).toBe("copied");
    expect(copy).toHaveBeenCalledWith(LINK);
    result = "failed";
    expect(await action.copy()).toBe("failed");
  });
});
