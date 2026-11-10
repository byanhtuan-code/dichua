import { expect, type Page } from "@playwright/test";

/**
 * Holds W from the spawn until we are inside the hall: Lạy from the gate is refused (too far a walk for AC8).
 * The stone path runs straight from the spawn to the door, so W alone gets there (~13 s at walking pace).
 */
export async function enterHall(page: Page, insideZ = 11): Promise<void> {
  await page.keyboard.down("KeyW");
  try {
    await expect
      .poll(async () => (await page.evaluate(() => window.__santinh?.self?.position.z ?? Infinity)), { timeout: 30_000 })
      .toBeLessThan(insideZ);
  } finally {
    await page.keyboard.up("KeyW");
  }
}
