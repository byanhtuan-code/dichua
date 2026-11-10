import { DEFAULT_ROOM_NAMES, parseRoomNames } from "@santinh/shared";
import { JsonStore } from "./json-store.ts";

/** The ten room names (D26); the file holds `{ "names": [...] }` like the admin PUT body. */
export class RoomNamesStore extends JsonStore<readonly string[]> {
  constructor(dataDir: string) {
    super(dataDir, "room-names.json", (raw) => parseRoomNames(raw), DEFAULT_ROOM_NAMES, (names) => ({ names }));
  }
}
