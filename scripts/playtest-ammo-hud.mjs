import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const base = process.env.BASE ?? 'http://127.0.0.1:4187';
const out = process.env.OUT ?? 'docs/evidence/ammo-hud';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal'] });
const errors = [], results = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, hasTouch: true });
page.on('pageerror', e => errors.push(e.message));
const hud = page.locator('[data-ammo-hud]');
async function capture(name) { await page.screenshot({ path: `${out}/${name}.png` }); }
async function noOverlap(selector) {
  const a = await hud.boundingBox();
  for (const other of await page.locator(selector).all()) {
    const b = await other.boundingBox();
    if (b) assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `HUD overlaps ${selector}`);
  }
}
try {
  await page.goto(`${base}/game/?map=vice&seed=11&debug=1&quality=low&tour=1`);
  await page.getByRole('button', { name: /^start$/i }).first().click({ timeout: 120000 });
  await page.getByRole('button', { name: /enter arena/i }).click({ timeout: 120000 });
  await page.waitForFunction(() => window.__rs?.playtest?.driveCars.size, null, { timeout: 120000 });
  await page.evaluate(() => { __rs.invuln.current = 1e6; __rs.giveAll(); __rs.equip('smg'); });
  await hud.waitFor();
  const before = await hud.boundingBox();
  await capture('desktop');
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(250);
  await page.keyboard.up('ArrowUp');
  assert.deepEqual(await hud.boundingBox(), before);
  await capture('desktop-look');
  results.push('HUD bounding box unchanged after yaw/pitch input');
  await noOverlap('[data-minimap]');
  await noOverlap('text=TAC SPRINT READY');
  await page.evaluate(() => { __rs.playtest.supply.loaded.smg = 0; });
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => document.querySelector('.ammo-hud-hint')?.textContent.includes('RELOADING'));
  await capture('reload');
  const progress = Number(await page.getByRole('progressbar', { name: 'Reload progress' }).getAttribute('aria-valuenow'));
  assert.ok(progress >= 0 && progress < 100);
  await page.waitForFunction(() => __rs.playtest.supply.loaded.smg === 30);
  await page.waitForFunction(() => document.querySelector('.ammo-hud-count')?.textContent === '30 / 90');
  assert.match(await hud.textContent(), /R · RELOAD/);
  results.push('Reload progress, loaded/reserve counts and keyboard label');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(150);
  assert.equal(await hud.count(), 0);
  await page.getByRole('button', { name: /resume/i }).first().click();
  await hud.waitFor();
  results.push('Pause hides ammo; resume restores it');
  await page.evaluate(() => { const c = [...__rs.playtest.driveCars.values()][0]; c.owner = __rs.playtest.driving.self; });
  await page.waitForTimeout(150);
  assert.equal(await hud.isVisible(), false);
  await page.evaluate(() => __rs.playtest.releaseVehicle(__rs.playtest.driving.self));
  await hud.waitFor();
  results.push('Driving hides ammo; exit restores it');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.dispatchEvent('canvas', 'pointerdown', { pointerType: 'touch', pointerId: 7 });
  await page.waitForFunction(() => document.querySelector('[data-ammo-hud]')?.dataset.touch === 'true');
  await capture('touch-landscape');
  await noOverlap('button:visible');
  await noOverlap('[data-minimap]');
  await noOverlap('text=/SELF REVIVE ·/');
  results.push('844x390 touch HUD clears buttons, minimap and self-revive indicator');
  for (const width of [667, 568]) {
    await page.setViewportSize({ width, height: width === 568 ? 320 : 375 });
    await page.waitForTimeout(150);
    const bounds = await hud.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.y >= 0);
    await noOverlap('button:visible');
    await noOverlap('[data-minimap]');
    await noOverlap('text=/SELF REVIVE ·/');
    await capture(`touch-${width}`);
    results.push(`${width}px landscape HUD clears controls and indicators`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await capture('touch-portrait');
  assert.ok(await page.getByText('ROTATE YOUR DEVICE', { exact: true }).isVisible());
  results.push('390x844 retains existing rotate-device screen');
  assert.deepEqual(errors, []);
} finally {
  fs.writeFileSync(`${out}/results.json`, JSON.stringify({ results, errors }, null, 2));
  await browser.close();
}
console.log(results.join('\n'));
