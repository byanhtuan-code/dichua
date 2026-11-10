import { DEFAULT_POPULATION, parsePopulation, type PopulationConfig } from "@santinh/shared";
import { JsonStore } from "./json-store.ts";

/** The bot population config in use (P3-D8). */
export class PopulationStore extends JsonStore<PopulationConfig> {
  constructor(dataDir: string, capacity: number) {
    super(dataDir, "population.json", (raw) => parsePopulation(raw, capacity), DEFAULT_POPULATION);
  }
}
