#!/usr/bin/env node
/*
 * Packages the extension for the Chrome Web Store (Chrome, Edge, Brave, Opera…)
 * and Firefox Add-ons: writes dist/<target>/ (unpacked) and dist/*.zip.
 * No dependencies — includes a tiny, reproducible ZIP writer.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SOURCES = ['icons', 'src'];
const GECKO_ID = 'speed-booster@brodietv';

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) out.push(...listFiles(rel));
    else out.push(rel);
  }
  return out.sort();
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Minimal ZIP (deflate) writer with fixed timestamps, so builds are reproducible. */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const DOS_TIME = 0;
  const DOS_DATE = (1 << 5) | 1; // 1980-01-01
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function manifestFor(target) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  if (target === 'firefox') {
    // Firefox runs MV3 backgrounds as event pages and needs an add-on id.
    manifest.background = { scripts: [manifest.background.service_worker] };
    delete manifest.minimum_chrome_version;
    manifest.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        strict_min_version: '128.0', // content scripts in the page's MAIN world
        data_collection_permissions: { required: ['none'] },
      },
    };
  }
  return manifest;
}

function build(target) {
  const manifest = manifestFor(target);
  const entries = [{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') }];
  for (const file of SOURCES.flatMap(listFiles)) entries.push({ name: file, data: fs.readFileSync(path.join(ROOT, file)) });

  const dir = path.join(DIST, target);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const { name, data } of entries) {
    const out = path.join(dir, name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, data);
  }
  const zipPath = path.join(DIST, `speed-booster-${target}-v${manifest.version}.zip`);
  fs.writeFileSync(zipPath, zip(entries));
  const kb = (fs.statSync(zipPath).size / 1024).toFixed(1);
  console.log(`${target.padEnd(8)} ${entries.length} files → ${path.relative(ROOT, zipPath)} (${kb} KB)`);
}

fs.mkdirSync(DIST, { recursive: true });
build('chrome');
build('firefox');
