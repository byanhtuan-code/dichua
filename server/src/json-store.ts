import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One admin-edited setting kept in `<dataDir>/<file>`: loaded once at startup, saved atomically; `dataDir` "" = memory only. */
export class JsonStore<T> {
  private readonly dataDir: string;
  private readonly file: string;
  private readonly parse: (raw: unknown) => T | null;
  private readonly defaults: T;
  private readonly toFile: (value: T) => unknown;
  private value: T;
  /** Saves run one at a time: two writers on the same `.tmp` could rename a mix of both. */
  private queue: Promise<unknown> = Promise.resolve();

  /** `toFile`: what goes in the file; `parse` must accept it back. */
  constructor(dataDir: string, file: string, parse: (raw: unknown) => T | null, defaults: T, toFile: (value: T) => unknown = (v) => v) {
    this.dataDir = dataDir;
    this.file = file;
    this.parse = parse;
    this.defaults = defaults;
    this.toFile = toFile;
    this.value = dataDir === "" ? defaults : this.load();
  }

  get current(): T {
    return this.value;
  }

  /** Invalid → null, nothing changes. A failed write rejects and keeps the old value (memory matches disk). */
  save(raw: unknown): Promise<T | null> {
    const run = this.queue.then(async () => {
      const next = this.parse(raw);
      if (next === null) return null;
      if (this.dataDir !== "") {
        await mkdir(this.dataDir, { recursive: true });
        const path = join(this.dataDir, this.file);
        const tmp = `${path}.tmp`;
        try {
          await writeFile(tmp, JSON.stringify(this.toFile(next), null, 2) + "\n");
          await rename(tmp, path);
        } catch (err) {
          await rm(tmp, { force: true });
          throw err;
        }
      }
      this.value = next;
      return next;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private load(): T {
    const path = join(this.dataDir, this.file);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (err) {
      const missing = err instanceof Error && "code" in err && err.code === "ENOENT";
      console.warn(`${this.file}: ${missing ? `no ${path}` : `cannot read ${path}`}, using defaults`);
      return this.defaults;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = undefined;
    }
    const value = this.parse(raw);
    if (value === null) console.warn(`${this.file}: ${path} is invalid, using defaults`);
    return value ?? this.defaults;
  }
}
