#!/usr/bin/env node
/**
 * Pulls the CC0 furniture for The Room from Poly Haven and packs each asset
 * into a single self-contained .glb in client/public/models/room/.
 *
 *   node scripts/fetch-room-assets.mjs
 *
 * Poly Haven models are CC0 (public domain) — no attribution required, though
 * polyhaven.com is worth crediting anyway. We take the 1k textures: each piece
 * lands around 0.5-1 MB, and the whole room tab is lazy-loaded.
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const RES = '1k';

// A council chamber, not a corporate meeting room: wood, leather, books.
const ASSETS = [
  'WoodenTable_03',              // the table they meet at
  'ArmChair_01',                 // six of these around it
  'wooden_bookshelf_worn',       // wall of books
  'book_encyclopedia_set_01',    // shelf dressing
  'Sofa_01',                     // lounge corner
  'CoffeeTable_01',
  'calathea_orbifolia_01',       // greenery
  'classic_laptop',              // on the table
  'vintage_grandfather_clock_01',
];

const OUT = path.resolve('client/public/models/room');
const TMP = path.resolve('.room-assets-tmp');

const fetchJSON = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

const download = async (url, dest) => {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
};

async function grab(id) {
  const files = await fetchJSON(`https://api.polyhaven.com/files/${id}`);
  const res = files.gltf?.[RES] ? RES : Object.keys(files.gltf || {})[0];
  const entry = files.gltf?.[res]?.gltf;
  if (!entry) throw new Error(`no gltf for ${id}`);

  const dir = path.join(TMP, id);
  const gltf = path.join(dir, path.basename(entry.url));
  await download(entry.url, gltf);
  for (const [rel, info] of Object.entries(entry.include || {})) {
    await download(info.url, path.join(dir, rel));
  }

  const out = path.join(OUT, `${id}.glb`);
  // `copy` inlines the .bin and textures into one binary file
  await run('npx', ['--yes', '@gltf-transform/cli@latest', 'copy', gltf, out], { shell: true });
  return out;
}

const main = async () => {
  await mkdir(OUT, { recursive: true });
  for (const id of ASSETS) {
    if (existsSync(path.join(OUT, `${id}.glb`))) {
      console.log(`· ${id} already present`);
      continue;
    }
    try {
      await grab(id);
      console.log(`✓ ${id}`);
    } catch (err) {
      console.error(`✗ ${id}: ${err.message}`);
    }
  }
  await rm(TMP, { recursive: true, force: true });
};

main();
