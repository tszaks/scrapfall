import assert from "node:assert/strict";
import fs from "node:fs";
export async function assertHudLayout(page, out, name) {
  const regions = await page
    .locator(
      "[data-hud-match], [data-hud-loadout], [data-hud-vitals], [data-compass], [data-ammo-hud], [data-minimap], .hud-wave-banner, .hud-boss, button:visible",
    )
    .evaluateAll((els) =>
      els
        .filter(
          (el) =>
            getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden",
        )
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            name: el.getAttribute("aria-label") || el.className,
            text: el.textContent.slice(0, 35),
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
          };
        }),
    );
  fs.writeFileSync(`${out}/${name}-layout.json`, JSON.stringify(regions, null, 2));
  await page.screenshot({ path: `${out}/${name}.png` });
  for (let i = 0; i < regions.length; i++)
    for (let j = i + 1; j < regions.length; j++) {
      const a = regions[i],
        b = regions[j];
      if (!a.w || !a.h || !b.w || !b.h) continue;
      assert.ok(
        a.x + a.w <= b.x + 0.5 ||
          b.x + b.w <= a.x + 0.5 ||
          a.y + a.h <= b.y + 0.5 ||
          b.y + b.h <= a.y + 0.5,
        `${name}: ${a.text || a.name} overlaps ${b.text || b.name}`,
      );
    }
  const strip = await page.locator("[data-hud-inventory]").boundingBox(),
    active = await page.locator('[data-active="true"]').boundingBox();
  assert.ok(
    active.x >= strip.x - 0.5 && active.x + active.width <= strip.x + strip.width + 0.5,
    `${name}: selected weapon clipped`,
  );
  return { name, regions };
}
