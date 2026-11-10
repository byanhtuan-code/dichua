import { showBootError } from "./ui/boot.ts";

// Keep the entry tiny: the boot screen is already painted, the game chunk loads lazily.
import("./game/start.ts")
  .then((game) => game.start())
  .catch((err: unknown) => {
    console.error(err);
    showBootError("load");
  });
