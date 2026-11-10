import { BufferGeometry, Float32BufferAttribute } from "three";

/**
 * Korean hip roof (as on the source's hall): eaves sag, slopes are concave (flat near the eaves, steep near the ridge)
 * and the four corners sweep up. Ridge runs along x.
 */
export interface RoofParams {
  /** Footprint centre and half-sizes, including the overhang. */
  cx: number;
  cz: number;
  halfX: number;
  halfZ: number;
  /** Half-length of the flat ridge. */
  ridgeHalf: number;
  /** Top of the eave at the middle of each side. */
  eaveY: number;
  /** Eave → ridge height. */
  rise: number;
  /** Slope profile exponent: > 1 makes the slope concave. */
  sag: number;
  /** Extra height at the four corners. */
  cornerLift: number;
  thickness: number;
}

/** Top-surface height at (x, z); outside the footprint is clamped to the edge. */
export function roofHeightAt(p: RoofParams, x: number, z: number): number {
  const dx = Math.min(Math.abs(x - p.cx), p.halfX);
  const dz = Math.min(Math.abs(z - p.cz), p.halfZ);
  const ex = (p.halfX - dx) / (p.halfX - p.ridgeHalf);
  const ez = (p.halfZ - dz) / p.halfZ;
  const t = Math.min(1, ex, ez);
  const slope = p.rise * Math.pow(t, p.sag);
  // Corner sweep: zero mid-side, full at the corners, fading away from the eave.
  const lift = p.cornerLift * Math.pow(dx / p.halfX, 3) * Math.pow(dz / p.halfZ, 3) * (1 - t) * (1 - t);
  return p.eaveY + slope + lift;
}

export interface RoofGeometry {
  top: BufferGeometry;
  /** Underside (soffit), facing down. */
  bottom: BufferGeometry;
  /** Edge band joining top and bottom all round. */
  fascia: BufferGeometry;
}

/** Builds the three roof parts on a grid of `seg` cells per metre. UVs are in metres. */
export function createRoofGeometry(p: RoofParams, segPerMetre = 1.6): RoofGeometry {
  const nx = Math.max(8, Math.round(p.halfX * 2 * segPerMetre));
  const nz = Math.max(8, Math.round(p.halfZ * 2 * segPerMetre));
  const xs: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i <= nx; i++) xs.push(p.cx - p.halfX + (2 * p.halfX * i) / nx);
  for (let j = 0; j <= nz; j++) zs.push(p.cz - p.halfZ + (2 * p.halfZ * j) / nz);

  const surface = (dy: number, flip: boolean): BufferGeometry => {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (const z of zs) for (const x of xs) {
      pos.push(x, roofHeightAt(p, x, z) + dy, z);
      uv.push(x, z);
    }
    const row = nx + 1;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      if (flip) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };

  // Perimeter in order (clockwise seen from above) for the fascia band.
  const ring: [number, number][] = [];
  for (const x of xs) ring.push([x, zs[0] ?? 0]);
  for (const z of zs.slice(1)) ring.push([xs[nx] ?? 0, z]);
  for (const x of xs.slice(0, -1).reverse()) ring.push([x, zs[nz] ?? 0]);
  for (const z of zs.slice(1, -1).reverse()) ring.push([xs[0] ?? 0, z]);

  const fPos: number[] = [];
  const fUv: number[] = [];
  const fIdx: number[] = [];
  let run = 0;
  ring.forEach(([x, z], k) => {
    const y = roofHeightAt(p, x, z);
    if (k > 0) {
      const [px, pz] = ring[k - 1] ?? [x, z];
      run += Math.hypot(x - px, z - pz);
    }
    fPos.push(x, y, z, x, y - p.thickness, z);
    fUv.push(run, 0, run, p.thickness);
  });
  for (let k = 0; k < ring.length; k++) {
    const a = k * 2, b = a + 1, c = ((k + 1) % ring.length) * 2, d = c + 1;
    fIdx.push(a, c, b, b, c, d);
  }
  const fascia = new BufferGeometry();
  fascia.setAttribute("position", new Float32BufferAttribute(fPos, 3));
  fascia.setAttribute("uv", new Float32BufferAttribute(fUv, 2));
  fascia.setIndex(fIdx);
  fascia.computeVertexNormals();

  return { top: surface(0, false), bottom: surface(-p.thickness, true), fascia };
}
