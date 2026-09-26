#!/usr/bin/env node
/* Rasterizes icons/icon.svg into the PNG sizes the manifest uses (needs Playwright's Chromium). */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SIZES = [16, 32, 48, 128];

(async () => {
  const svg = fs.readFileSync(path.join(ROOT, 'icons', 'icon.svg'), 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`
    );
    const file = path.join(ROOT, 'icons', `icon-${size}.png`);
    await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('wrote', path.relative(ROOT, file));
  }
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
