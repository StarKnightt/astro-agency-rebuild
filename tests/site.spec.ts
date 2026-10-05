import { expect, test, type Page } from '@playwright/test';

const pages = ['/', '/about', '/services', '/services/homes-and-cabins', '/work', '/work/fjordhuset', '/journal', '/contact'];

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test.describe('pages', () => {
  for (const path of pages) {
    test(`${path} renders one h1 without console errors`, async ({ page }) => {
      const errors = collectErrors(page);
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('main')).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test('unknown routes return the 404 page', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('moved');
  });

  test('home page shows services, projects and testimonials', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Architecture for the northern light' })).toBeVisible();
    await expect(page.locator('#services .services__item')).toHaveCount(3);
    await expect(page.locator('#work .project-card')).toHaveCount(4);
    await expect(page.getByRole('region', { name: 'Testimonials' })).toBeVisible();
  });

  test('scroll reveal shows content once it enters the viewport', async ({ page }) => {
    await page.goto('/');
    const card = page.locator('#work .project-card').first();
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator('xpath=ancestor::li[@data-reveal]')).toHaveClass(/is-revealed/);
  });
});

test.describe('navigation', () => {
  test('desktop nav links to the journal and marks the current page', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop navigation is hidden on small screens');
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Journal' }).click();
    await expect(page).toHaveURL(/\/journal$/);
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Journal' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('mobile menu opens, traps focus in a dialog and closes with Escape', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the menu button only shows on small screens');
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Open menu' });
    await toggle.click();
    const menu = page.getByRole('dialog', { name: 'Site menu' });
    await expect(menu).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('link', { name: 'Services' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('a service links through to its related project', async ({ page }) => {
    await page.goto('/services/public-buildings');
    await page.getByRole('link', { name: /Bjørkly bibliotek/ }).click();
    await expect(page).toHaveURL(/\/work\/bjorkly-bibliotek$/);
    const details = page.getByRole('region', { name: 'Project details' });
    await expect(details.getByRole('link', { name: 'Public and cultural buildings' })).toBeVisible();
  });

  test('journal posts render markdown content', async ({ page }) => {
    await page.goto('/journal');
    await page.getByRole('link', { name: /Designing for the low winter sun/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Designing for the low winter sun');
    await expect(page.locator('.prose h2').first()).toHaveText('Low sun reaches deep');
  });
});

test.describe('contact form', () => {
  test('shows inline errors for an empty submission', async ({ page }) => {
    await page.goto('/contact');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#email-error')).toHaveText('Please enter your email so we can reply.');
    await expect(page.locator('#message-error')).not.toBeEmpty();
    await expect(page.getByLabel('Name')).toBeFocused();
  });

  test('a valid enquiry is accepted by the endpoint', async ({ page }) => {
    await page.goto('/contact');
    await page.getByLabel('Name').fill('Ingrid Test');
    await page.getByLabel('Email').fill('ingrid@example.com');
    await page.getByLabel('Project type').selectOption('Cabin');
    await page.getByLabel(/Site location/).fill('Hemsedal');
    await page.getByLabel('About the project').fill('A small family cabin on a steep plot facing south-west.');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByRole('heading', { name: 'Thank you. Your message is with us.' })).toBeVisible();
    await expect(page.locator('[data-contact-form]')).toBeHidden();
  });
});

test.describe('contact API', () => {
  const headers = (baseURL: string | undefined) => ({ Accept: 'application/json', Origin: new URL(baseURL ?? '').origin });

  test('rejects invalid input with field errors', async ({ request, baseURL }) => {
    const response = await request.post('/api/contact', {
      headers: headers(baseURL),
      form: { name: 'A', email: 'nope', projectType: 'Castle', message: 'short' },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(Object.keys(body.fields)).toEqual(expect.arrayContaining(['name', 'email', 'projectType', 'message']));
  });

  test('accepts honeypot submissions silently', async ({ request, baseURL }) => {
    const response = await request.post('/api/contact', {
      headers: headers(baseURL),
      form: { name: 'Bot', email: 'bot@example.com', projectType: 'Cabin', message: 'x', website: 'https://spam.example' },
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });

  test('redirects non-JavaScript form posts to the thank-you page', async ({ request, baseURL }) => {
    const response = await request.post('/api/contact', {
      headers: { Origin: new URL(baseURL ?? '').origin },
      form: { name: 'Ola Nordmann', email: 'ola@example.com', projectType: 'New home', message: 'We have a plot near Lillehammer.' },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(response.headers().location).toContain('/contact/thanks');
  });

  test('blocks cross-site form posts', async ({ request }) => {
    const response = await request.post('/api/contact', {
      headers: { Origin: 'https://evil.example' },
      form: { name: 'Ola Nordmann', email: 'ola@example.com', projectType: 'New home', message: 'We have a plot near Lillehammer.' },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(403);
  });

  test('only allows POST', async ({ request }) => {
    const response = await request.get('/api/contact');
    expect(response.status()).toBe(405);
  });
});
