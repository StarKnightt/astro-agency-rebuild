// Captures documentation screenshots with Playwright's bundled Chromium.
// Usage: BASE_URL=https://example.com node scripts/screenshots.mjs [outDir]
import { chromium, devices } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.BASE_URL ?? 'http://localhost:4321';
const outDir = path.resolve(process.argv[2] ?? 'docs');

const shots = [
  { name: 'home-desktop', url: '/', device: 'desktop', fullPage: true },
  { name: 'home-mobile', url: '/', device: 'mobile', fullPage: true },
  { name: 'service-desktop', url: '/services/homes-and-cabins', device: 'desktop', fullPage: false },
  { name: 'contact-desktop', url: '/contact', device: 'desktop', fullPage: false },
  { name: 'menu-mobile', url: '/', device: 'mobile', fullPage: false, action: 'menu' },
  { name: 'form-errors-mobile', url: '/contact', device: 'mobile', fullPage: false, action: 'invalid-submit' },
];

const contexts = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: { ...devices['iPhone 14'], defaultBrowserType: undefined },
};

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();

for (const shot of shots) {
  const context = await browser.newContext({ ...contexts[shot.device], reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(new URL(shot.url, base).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  if (shot.fullPage) {
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight / 2) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForLoadState('networkidle');
  }

  if (shot.action === 'menu') {
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.waitForTimeout(400);
  }

  if (shot.action === 'invalid-submit') {
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByRole('button', { name: 'Send message' }).click();
    await page.waitForTimeout(200);
    await page.evaluate(() => window.scrollTo(0, document.querySelector('#contact-form').getBoundingClientRect().top + window.scrollY - 80));
    await page.waitForTimeout(200);
  }

  const file = path.join(outDir, `${shot.name}.jpg`);
  await page.screenshot({ path: file, fullPage: shot.fullPage, type: 'jpeg', quality: 82 });
  console.log(`saved ${path.relative(process.cwd(), file)}`);
  await context.close();
}

await browser.close();
