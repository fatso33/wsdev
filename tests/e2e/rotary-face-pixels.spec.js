import { test, expect } from '@playwright/test';

/**
 * What the generated Face actually paints, sampled from real pixels. The generator's
 * markup can be read directly, but whether stacked translucent shapes add up to the
 * alpha the Author asked for is a question only a rasteriser can answer.
 */

const SIZE = 200;
const PER_UNIT = SIZE / 100;

/** Rasterises buildRotaryFace(config) on a transparent canvas and returns alpha at each viewBox point. */
async function alphaAt(page, config, points) {
  await page.goto('/');
  return page.evaluate(async ({ config: faceConfig, points: samples, size, perUnit }) => {
    const { buildRotaryFace } = await import('/widgets/components/rotaryFace.js');
    const markup = buildRotaryFace(faceConfig)
      .replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" `);
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    return samples.map(([x, y]) => context.getImageData(Math.round(x * perUnit), Math.round(y * perUnit), 1, 1).data[3]);
  }, { config, points, size: SIZE, perUnit: PER_UNIT });
}

test('a Drop Shadow with no Face Color leaves the knob interior clear', async ({ page }) => {
  // Below the centre, clear of the indicator, and well inside the rim (inner edge at 34).
  const interior = [[50, 50], [50, 62], [40, 60], [60, 60], [50, 75]];
  const alpha = await alphaAt(page, { angle: 0, dropShadow: 10 }, interior);
  expect(alpha).toEqual([0, 0, 0, 0, 0]);
});

test('a Drop Shadow is still drawn beyond the knob, below it', async ({ page }) => {
  // Knob r 40 with the shadow offset 4 down and reaching r 44..46, so the band under the knob's foot is shadow.
  const [foot] = await alphaAt(page, { angle: 0, dropShadow: 10 }, [[50, 92]]);
  expect(foot).toBeGreaterThan(40);
});

for (const fillStyle of ['linear', 'radial', 'conic']) {
  test(`a translucent ${fillStyle} fill is as translucent across the disc as the colour the Author chose`, async ({ page }) => {
    const authored = 0.3;
    // A grid of points inside the rim, skipping the indicator's column above the centre.
    const points = [];
    for (let x = 14; x <= 86; x += 6) {
      for (let y = 14; y <= 86; y += 6) {
        const inside = Math.hypot(x - 50, y - 50) <= 38;
        const onIndicator = Math.abs(x - 50) < 6 && y < 50;
        if (inside && !onIndicator) points.push([x, y]);
      }
    }
    const alpha = await alphaAt(page, {
      angle: 0, fillStyle, faceColor: `rgba(255, 0, 0, ${authored})`, faceColor2: `rgba(0, 0, 255, ${authored})`
    }, points);
    const expected = authored * 255;
    expect(Math.max(...alpha)).toBeLessThanOrEqual(expected + 8);
    // A shared edge between two bands is anti-aliased on both sides and may read a little light.
    const lightSeams = alpha.filter((a) => a < expected - 8).length;
    expect(lightSeams / alpha.length).toBeLessThan(0.1);
  });
}
