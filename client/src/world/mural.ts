import { CanvasTexture, SRGBColorSpace } from "three";

/**
 * Procedural devotional mural (no public-domain 2:1 painting fit, see CREDITS): warm red ground, a large golden
 * halo + flame mandorla where the Buddha's head sits, rows of small attendant halos, cloud scrolls, patterned border.
 * `halo` is in 0..1 canvas coordinates (y down).
 */
export function drawMural(width: number, height: number, halo: { x: number; y: number; r: number }): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  const W = width;
  const H = height;
  const hx = halo.x * W;
  const hy = halo.y * H;
  const hr = halo.r * H;

  // Deterministic jitter so every visitor sees the same painting.
  let seed = 7;
  const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  const ground = ctx.createRadialGradient(hx, hy, hr * 0.5, W / 2, H / 2, W * 0.6);
  ground.addColorStop(0, "#b5502a");
  ground.addColorStop(0.55, "#8a3018");
  ground.addColorStop(1, "#4e1a0e");
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, W, H);

  // Cloud scrolls in the background.
  ctx.lineCap = "round";
  for (let i = 0; i < 70; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const r = 14 + rand() * 34;
    ctx.strokeStyle = `rgba(${200 + rand() * 40}, ${120 + rand() * 50}, 70, ${0.18 + rand() * 0.2})`;
    ctx.lineWidth = 3 + rand() * 4;
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 3.2; a += 0.2) {
      const rr = r * (1 - a / (Math.PI * 4));
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr * 0.7;
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // Attendant figures: small halos with a dark face disc, in tiers either side of the centre.
  const tiers = 4;
  for (let t = 0; t < tiers; t++) {
    const y = H * (0.2 + t * 0.19);
    const count = 4 + t;
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < count; k++) {
        const x = hx + side * (hr * 1.55 + k * (W * 0.42 - hr * 1.2) / count + rand() * 10);
        if (x < W * 0.05 || x > W * 0.95) continue;
        const r = H * (0.045 - t * 0.004);
        ctx.fillStyle = "rgba(240, 196, 92, 0.85)";
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#3a1a10";
        ctx.beginPath();
        ctx.arc(x, y + r * 0.08, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${90 + rand() * 60}, ${40 + rand() * 30}, 30, 0.9)`;
        ctx.beginPath();
        ctx.ellipse(x, y + r * 2.1, r * 0.9, r * 1.3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Flame mandorla behind the body.
  const mandorla = ctx.createRadialGradient(hx, hy + hr * 0.9, hr * 0.3, hx, hy + hr * 0.9, hr * 2.1);
  mandorla.addColorStop(0, "rgba(255, 196, 96, 0.95)");
  mandorla.addColorStop(0.6, "rgba(214, 112, 40, 0.85)");
  mandorla.addColorStop(1, "rgba(120, 40, 18, 0)");
  ctx.fillStyle = mandorla;
  ctx.beginPath();
  ctx.ellipse(hx, hy + hr * 0.9, hr * 1.55, hr * 2.15, 0, 0, Math.PI * 2);
  ctx.fill();

  // Rays.
  ctx.save();
  ctx.translate(hx, hy);
  for (let i = 0; i < 72; i++) {
    ctx.rotate((Math.PI * 2) / 72);
    ctx.fillStyle = i % 2 ? "rgba(255, 220, 140, 0.35)" : "rgba(255, 180, 90, 0.2)";
    ctx.beginPath();
    ctx.moveTo(0, -hr * 0.2);
    ctx.lineTo(hr * 0.05, -hr * 1.35);
    ctx.lineTo(-hr * 0.05, -hr * 1.35);
    ctx.fill();
  }
  ctx.restore();

  // Concentric halo rings.
  const rings: [number, string][] = [
    [1.0, "#f6d27a"],
    [0.9, "#c96a2a"],
    [0.84, "#f2c464"],
    [0.66, "#e9a24a"],
    [0.6, "#fbe2a0"],
  ];
  for (const [k, color] of rings) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(hx, hy, hr * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(160, 70, 20, 0.6)";
  ctx.lineWidth = 3;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(hx + Math.cos(a) * hr * 0.75, hy + Math.sin(a) * hr * 0.75, hr * 0.06, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Border band of lotus petals.
  const band = H * 0.045;
  ctx.fillStyle = "#2c1a12";
  ctx.fillRect(0, 0, W, band);
  ctx.fillRect(0, H - band, W, band);
  ctx.fillRect(0, 0, band, H);
  ctx.fillRect(W - band, 0, band, H);
  ctx.fillStyle = "#d9a54e";
  for (let x = band; x < W - band; x += band * 0.9) {
    for (const y of [band / 2, H - band / 2]) {
      ctx.beginPath();
      ctx.ellipse(x, y, band * 0.32, band * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
