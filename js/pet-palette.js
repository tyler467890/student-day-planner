/**
 * Recolour Kenney Cube Pets by palette cell.
 * The shared colormap is a grid of shaded swatches. Parts that share a swatch
 * are split onto a free cell so Eyes, Main, and Second each change only their
 * own parts. Eye whites, nose, mouth, and dark markings stay on the original art.
 *
 * `paintPetColors` is the runtime hook. A colour wheel can call the same
 * `{ eyes, primary, secondary }` object this painter already accepts.
 */

import { BufferAttribute, CanvasTexture, SRGBColorSpace } from 'three';

const ROLE = { empty: 0, keep: 1, primary: 2, secondary: 3, eyes: 4 };
const COLS = 16;

function lightness(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function cellOf(u, v) {
  const col = Math.min(COLS - 1, Math.max(0, Math.floor(u * COLS)));
  const band = Math.min(3, Math.max(0, Math.floor(v * 4)));
  return col + band * COLS;
}

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h / 6, s, l };
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue = (p, q, t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)].map((v) => Math.round(v * 255));
}

function collectTriangles(pet) {
  const tris = [];
  pet.root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.uv || !obj.geometry.attributes.position) return;
    if (!obj.material?.map) return;
    const geo = obj.geometry.index ? obj.geometry : null;
    if (!geo) return;
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const index = geo.index;
    const count = index.count;
    for (let i = 0; i < count; i += 3) {
      const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      const corners = ids.map((id) => [uv.getX(id), uv.getY(id)]);
      const u = (corners[0][0] + corners[1][0] + corners[2][0]) / 3;
      const v = (corners[0][1] + corners[1][1] + corners[2][1]) / 3;
      const cy = (pos.getY(ids[0]) + pos.getY(ids[1]) + pos.getY(ids[2])) / 3;
      const cz = (pos.getZ(ids[0]) + pos.getZ(ids[1]) + pos.getZ(ids[2])) / 3;
      tris.push({
        mesh: obj,
        slot: i,
        ids,
        uv: corners,
        u,
        v,
        cy,
        cz,
        cell: cellOf(u, v),
        node: obj.name || '',
      });
    }
  });
  return tris;
}

function classify(tris, sample) {
  const body = tris.filter((tri) => tri.node === 'body');
  if (!body.length) {
    tris.forEach((tri) => { tri.role = ROLE.keep; });
    return;
  }
  let yMin = Infinity;
  let yMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const tri of body) {
    if (tri.cy < yMin) yMin = tri.cy;
    if (tri.cy > yMax) yMax = tri.cy;
    if (tri.cz < zMin) zMin = tri.cz;
    if (tri.cz > zMax) zMax = tri.cz;
  }
  const ySpan = yMax - yMin || 1;
  const zSpan = zMax - zMin || 1;
  const torso = new Map();
  for (const tri of body) {
    const yn = (tri.cy - yMin) / ySpan;
    const zn = (tri.cz - zMin) / zSpan;
    tri.light = sample(tri.u, tri.v);
    if (yn > 0.2 && yn < 0.75 && zn > 0.08 && zn < 0.62) {
      torso.set(tri.cell, (torso.get(tri.cell) || 0) + 1);
    }
  }
  let primaryCell = null;
  let best = 0;
  for (const [cell, n] of torso) {
    if (n > best) {
      best = n;
      primaryCell = cell;
    }
  }
  if (primaryCell == null) primaryCell = body[0].cell;
  const cellCount = new Map();
  for (const tri of tris) {
    if (tri.light == null) tri.light = sample(tri.u, tri.v);
    cellCount.set(tri.cell, (cellCount.get(tri.cell) || 0) + 1);
  }

  for (const tri of tris) {
    const yn = (tri.cy - yMin) / ySpan;
    const zn = (tri.cz - zMin) / zSpan;
    // Face band, below the ears. Ear tips sit higher than this.
    const eye = tri.node === 'body' && yn > 0.5 && yn < 0.84 && zn > 0.58;
    const snout = tri.node === 'body' && zn > 0.8 && yn > 0.22 && yn < 0.7;
    if (eye && tri.light > 0.9) tri.role = ROLE.keep;
    else if (eye && tri.light < 0.45) tri.role = ROLE.eyes;
    else if (eye && tri.cell !== primaryCell) tri.role = ROLE.eyes;
    else if (snout && tri.cell !== primaryCell && tri.light < 0.55) tri.role = ROLE.keep;
    else if (tri.cell === primaryCell) tri.role = ROLE.primary;
    else if (tri.light < 0.22 && (cellCount.get(tri.cell) || 0) < 36) tri.role = ROLE.keep;
    else tri.role = ROLE.secondary;
  }
}

function duplicateVertex(geo, vi) {
  const pos = geo.attributes.position;
  const next = pos.count;
  for (const name of Object.keys(geo.attributes)) {
    const attr = geo.attributes[name];
    const item = attr.itemSize;
    const bigger = new attr.array.constructor((next + 1) * item);
    bigger.set(attr.array);
    for (let k = 0; k < item; k += 1) bigger[next * item + k] = attr.array[vi * item + k];
    geo.setAttribute(name, new BufferAttribute(bigger, item, attr.normalized));
  }
  return next;
}

function remapUvs(tris) {
  const byCell = new Map();
  for (const tri of tris) {
    if (!byCell.has(tri.cell)) byCell.set(tri.cell, []);
    byCell.get(tri.cell).push(tri);
  }
  const moves = [];
  for (const group of byCell.values()) {
    const counts = new Map();
    for (const tri of group) counts.set(tri.role, (counts.get(tri.role) || 0) + 1);
    let owner = ROLE.keep;
    if (!counts.has(ROLE.keep)) {
      owner = ROLE.primary;
      let n = 0;
      for (const [role, count] of counts) {
        if (count > n) {
          n = count;
          owner = role;
        }
      }
    }
    for (const tri of group) {
      if (tri.role !== owner) moves.push(tri);
    }
  }
  const groups = new Map();
  for (const tri of moves) {
    const key = `${tri.cell}:${tri.role}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tri);
  }
  let column = 0;
  for (const group of groups.values()) {
    const destCol = column % COLS;
    column += 1;
    const srcCol = group[0].cell % COLS;
    const srcBand = Math.floor(group[0].cell / COLS);
    const du = (destCol - srcCol) / COLS;
    const dv = (0 - srcBand) / 4;
    const stamp = `${du},${dv}`;
    const assigned = new Map();
    for (const tri of group) {
      const geo = tri.mesh.geometry;
      const index = geo.index;
      for (let k = 0; k < 3; k += 1) {
        let vi = index.getX(tri.slot + k);
        const id = `${geo.uuid}:${vi}`;
        const prev = assigned.get(id);
        if (prev && prev !== stamp) {
          vi = duplicateVertex(geo, vi);
          index.setX(tri.slot + k, vi);
        }
        assigned.set(`${geo.uuid}:${vi}`, stamp);
        geo.attributes.uv.setXY(vi, tri.uv[k][0] + du, tri.uv[k][1] + dv);
      }
      tri.uv = tri.uv.map(([u, v]) => [u + du, v + dv]);
      geo.attributes.uv.needsUpdate = true;
    }
  }
}

function raster(tris, width, height) {
  const role = new Uint8Array(width * height);
  const src = new Uint32Array(width * height);
  for (const tri of tris) {
    const pts = tri.uv.map(([u, v]) => [u * (width - 1), v * (height - 1)]);
    const s = tri.src;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const x0 = Math.max(0, Math.floor(minX));
    const x1 = Math.min(width - 1, Math.ceil(maxX));
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(height - 1, Math.ceil(maxY));
    const [ax, ay] = pts[0];
    const [bx, by] = pts[1];
    const [cx, cy] = pts[2];
    const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy) || 1;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        const wa = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom;
        const wb = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom;
        const wc = 1 - wa - wb;
        if (wa < -0.02 || wb < -0.02 || wc < -0.02) continue;
        const su = wa * s[0][0] + wb * s[1][0] + wc * s[2][0];
        const sv = wa * s[0][1] + wb * s[1][1] + wc * s[2][1];
        const sx = Math.min(width - 1, Math.max(0, Math.round(su * (width - 1))));
        const sy = Math.min(height - 1, Math.max(0, Math.round(sv * (height - 1))));
        const i = y * width + x;
        role[i] = tri.role;
        src[i] = sy * width + sx;
      }
    }
  }
  // Pad one texel so a palette edge still samples the recoloured swatch.
  const copyRole = role.slice();
  const copySrc = src.slice();
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      if (copyRole[i]) continue;
      const n = i - 1;
      if (!copyRole[n]) continue;
      role[i] = copyRole[n];
      src[i] = copySrc[n];
    }
  }
  return { role, src };
}

function tintPixel(r, g, b, target, maxL) {
  const sl = lightness(r, g, b);
  const scale = maxL > 0.05 ? sl / maxL : 1;
  const nl = Math.min(1, Math.max(0, scale * target.l));
  return hslToRgb(target.h, target.s, nl);
}

function readImage(texture) {
  const image = texture.image;
  const width = image.width;
  const height = image.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const original = ctx.getImageData(0, 0, width, height);
  return { canvas, ctx, original };
}

function cloneMeshes(pet) {
  pet.root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry || !obj.material?.map) return;
    obj.geometry = obj.geometry.clone();
  });
}

/**
 * Build the per-pet mask once, then repaint when the three colours change.
 * Null colours leave that slot on Kenney's original palette.
 */
export function attachPalette(pet) {
  if (pet.palette) return pet.palette;
  const material = pet.materials.find((mat) => mat.map && mat.map.image);
  if (!material) return null;
  cloneMeshes(pet);
  const { canvas, ctx, original } = readImage(material.map);
  const { width, height, data } = original;
  const sample = (u, v) => {
    const x = Math.min(width - 1, Math.max(0, Math.round(u * (width - 1))));
    const y = Math.min(height - 1, Math.max(0, Math.round(v * (height - 1))));
    const i = (y * width + x) * 4;
    return lightness(data[i], data[i + 1], data[i + 2]);
  };
  const tris = collectTriangles(pet);
  for (const tri of tris) tri.src = tri.uv.map((pair) => pair.slice());
  classify(tris, sample);
  remapUvs(tris);
  const drawn = raster(tris, width, height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = material.map.colorSpace || SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = material.map.magFilter;
  texture.minFilter = material.map.minFilter;
  texture.wrapS = material.map.wrapS;
  texture.wrapT = material.map.wrapT;
  texture.needsUpdate = true;
  for (const mat of pet.materials) {
    if (!mat.map) continue;
    mat.map = texture;
    if (mat.color) mat.color.set('#ffffff');
    mat.needsUpdate = true;
  }
  pet.palette = { canvas, ctx, original, texture, mask: drawn, width, height };
  return pet.palette;
}

export function paintPetColors(pet, colors = {}) {
  const palette = attachPalette(pet);
  if (!palette) return;
  const { ctx, original, texture, mask, width, height } = palette;
  const image = new ImageData(new Uint8ClampedArray(original.data), width, height);
  const pixels = image.data;
  const targets = {
    [ROLE.primary]: colors.primary ? hexToHsl(colors.primary) : null,
    [ROLE.secondary]: colors.secondary ? hexToHsl(colors.secondary) : null,
    [ROLE.eyes]: colors.eyes ? hexToHsl(colors.eyes) : null,
  };
  const { role, src } = mask;
  const peak = new Map();
  for (let i = 0; i < role.length; i += 1) {
    const kind = role[i];
    if (!targets[kind]) continue;
    const from = src[i] * 4;
    const key = kind * 1000 + cellOf(
      ((src[i] % width) + 0.5) / width,
      (Math.floor(src[i] / width) + 0.5) / height,
    );
    const L = lightness(original.data[from], original.data[from + 1], original.data[from + 2]);
    if (!peak.has(key) || L > peak.get(key)) peak.set(key, L);
  }
  for (let i = 0; i < role.length; i += 1) {
    const kind = role[i];
    if (!kind) continue;
    const from = src[i] * 4;
    const to = i * 4;
    const target = targets[kind];
    if (!target) {
      pixels[to] = original.data[from];
      pixels[to + 1] = original.data[from + 1];
      pixels[to + 2] = original.data[from + 2];
      pixels[to + 3] = 255;
      continue;
    }
    const key = kind * 1000 + cellOf(
      ((src[i] % width) + 0.5) / width,
      (Math.floor(src[i] / width) + 0.5) / height,
    );
    const [r, g, b] = tintPixel(
      original.data[from], original.data[from + 1], original.data[from + 2],
      target,
      peak.get(key) || 0.7,
    );
    pixels[to] = r;
    pixels[to + 1] = g;
    pixels[to + 2] = b;
    pixels[to + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  texture.needsUpdate = true;
}
