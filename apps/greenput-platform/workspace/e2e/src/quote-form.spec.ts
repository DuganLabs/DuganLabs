import { expect, test, type Page } from '@playwright/test';

/**
 * A homeowner getting a price, in a real browser, from a real Worker.
 *
 * The quote form is server-rendered POST-redirect-GET on the contractor's own
 * origin and works with JavaScript turned off — which is the point, because
 * the person filling it in is standing in a garage on one bar. Nothing here is
 * mocked: `scripts/e2e/tenant-dev.sh` stands up `wrangler dev` over a local D1
 * carrying the real schema and the real seeded machines, and Chromium arrives
 * as `demo.greenput.site` so the Worker resolves the tenant the way it does in
 * production.
 *
 * What it proves, end to end:
 *
 *   1. the Level 2 EV charger flow asks its questions and reaches a price;
 *   2. a panel photo uploads, is stored, and answers that screen;
 *   3. the outcome is the SPANNING band, because nobody has read the photo —
 *      the "widen until a human confirms" branch, on screen, in words;
 *   4. the range is the design's: the cheap outcome's low end to the
 *      expensive one's high end, not a padded guess.
 */

/** A tiny but structurally valid JPEG — enough for a content-type check. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

/**
 * Wait for a specific screen, answer it, and continue.
 *
 * Keyed on the hidden `stateId` the form posts back, not on a heading: the
 * client re-renders on every navigation and matching on prose would race it.
 */
async function screen(
  page: Page,
  stateId: string,
  answer: (page: Page) => Promise<void>,
): Promise<void> {
  await expect(
    page.locator(`input[name="stateId"][value="${stateId}"]`),
  ).toHaveCount(1);
  await answer(page);
  await page.getByRole('button', { name: 'Continue' }).click();
}

const choose = (value: string) => async (page: Page) => {
  await page.locator(`input[type="radio"][value="${value}"]`).first().check();
};

test.describe('the quote form', () => {
  test('prices a Level 2 EV charger install from a panel photo nobody has read yet', async ({
    page,
  }) => {
    await page.goto('/quote');
    await expect(
      page.getByRole('heading', { name: 'Get a real price' }),
    ).toBeVisible();

    // Start the flow from its own card, not from a URL we made up.
    await page
      .locator('article', { hasText: 'Level 2 EV charger install' })
      .getByRole('button', { name: 'Get a price' })
      .click();

    await screen(page, 'charger_location', choose('attached_garage_inside'));
    await screen(page, 'charge_speed', choose('32a'));
    await screen(page, 'charger_supply', choose('have_it'));
    await screen(page, 'charger_connection', choose('hardwired'));
    await screen(
      page,
      'panel_check__include__panel_location',
      choose('garage'),
    );

    // The panel photo. This is the screen the whole slice exists for.
    await screen(page, 'panel_check__include__panel_photo', async () => {
      await expect(page.getByText('Add your photos')).toBeVisible();
      await page.locator('input[type="file"]').setInputFiles({
        name: 'panel.jpg',
        mimeType: 'image/jpeg',
        buffer: JPEG,
      });
    });

    await screen(
      page,
      'panel_check__include__service_size_stated',
      choose('200'),
    );
    await screen(page, 'panel_check__include__major_loads', async () => {
      await page
        .locator('input[type="checkbox"][value="electric_dryer"]')
        .check();
      await page.locator('input[type="checkbox"][value="central_ac"]').check();
    });
    await screen(page, 'wire_run__include__run_distance_ft', async () => {
      await page.locator('input[name="run_distance_ft"]').fill('25');
    });
    await screen(page, 'wire_run__include__route_crosses', choose('same_room'));
    await screen(
      page,
      'wire_run__include__wall_finish',
      choose('open_framing'),
    );

    await screen(
      page,
      'property_and_contact__include__property_basics',
      async () => {
        await page
          .locator('input[type="radio"][value="single_family"]')
          .check();
        await page.locator('input[type="radio"][value="owner"]').check();
      },
    );

    await screen(
      page,
      'property_and_contact__include__contact_details',
      async () => {
        await page.locator('input[name="service_zip"]').fill('78704');
        await page.locator('input[type="radio"][value="asap"]').first().check();
        await page.locator('input[name="first_name"]').fill('Dana');
        await page.locator('input[name="last_name"]').fill('Ortiz');
        await page.locator('input[name="phone"]').fill('512-555-0134');
        await page.locator('input[name="email"]').fill('dana@example.com');
      },
    );

    // The price. A spanning band, because the photo is with us and unread.
    const range = page.locator('[data-bn="quote-range"]');
    await expect(range).toBeVisible();
    const text = (await range.textContent()) ?? '';
    expect(text).toContain('$925');
    expect(text).toContain('$2,450');

    // And it says so, in the terminal's own words rather than a number.
    await expect(
      page.getByRole('heading', { name: /narrow it today/i }),
    ).toBeVisible();
    await expect(
      page.getByText("Your photo's with us. Nothing more needed from you."),
    ).toBeVisible();

    // Both ends of the span, named the way a homeowner can read them — not
    // as the terminal ids they are inside the machine.
    const spans = page.locator('[data-bn="quote-spans"] li');
    await expect(spans).toHaveCount(2);
    await expect(spans.first()).toContainText(
      'A new charger circuit from your existing panel',
    );
    await expect(spans.last()).toContainText(
      'A small extra panel, then your charger',
    );
    await expect(page.getByText('T_subpanel_required')).toHaveCount(0);
  });

  test('still gives a price, wider, when the photo is skipped', async ({
    page,
  }) => {
    await page.goto('/quote');
    await page
      .locator('article', { hasText: 'Level 2 EV charger install' })
      .getByRole('button', { name: 'Get a price' })
      .click();

    await screen(page, 'charger_location', choose('attached_garage_inside'));
    await screen(page, 'charge_speed', choose('32a'));
    await screen(page, 'charger_supply', choose('have_it'));
    await screen(page, 'charger_connection', choose('hardwired'));
    await screen(
      page,
      'panel_check__include__panel_location',
      choose('garage'),
    );

    // "I'll send this later" is a real answer, not an escape hatch: the
    // traversal never waits for a photo.
    await expect(
      page.locator(
        'input[name="stateId"][value="panel_check__include__panel_photo"]',
      ),
    ).toHaveCount(1);
    await page.getByRole('button', { name: /send this later/i }).click();

    await screen(
      page,
      'panel_check__include__service_size_stated',
      choose('200'),
    );
    await screen(page, 'panel_check__include__major_loads', async () => {
      await page
        .locator('input[type="checkbox"][value="electric_dryer"]')
        .check();
      await page.locator('input[type="checkbox"][value="central_ac"]').check();
    });
    await screen(page, 'wire_run__include__run_distance_ft', async () => {
      await page.locator('input[name="run_distance_ft"]').fill('25');
    });
    await screen(page, 'wire_run__include__route_crosses', choose('same_room'));
    await screen(
      page,
      'wire_run__include__wall_finish',
      choose('open_framing'),
    );
    await screen(
      page,
      'property_and_contact__include__property_basics',
      async () => {
        await page
          .locator('input[type="radio"][value="single_family"]')
          .check();
        await page.locator('input[type="radio"][value="owner"]').check();
      },
    );
    await screen(
      page,
      'property_and_contact__include__contact_details',
      async () => {
        await page.locator('input[name="service_zip"]').fill('78704');
        await page.locator('input[type="radio"][value="asap"]').first().check();
        await page.locator('input[name="first_name"]').fill('Sam');
        await page.locator('input[name="last_name"]').fill('Reyes');
        await page.locator('input[name="phone"]').fill('512-555-0199');
        await page.locator('input[name="email"]').fill('sam@example.com');
      },
    );

    const text =
      (await page.locator('[data-bn="quote-range"]').textContent()) ?? '';
    // Wider at the top than the uploaded-photo run: $2,500 against $2,450.
    expect(text).toContain('$925');
    expect(text).toContain('$2,500');
    await expect(page.getByText(/cut this range in half/i)).toBeVisible();
  });

  test('resumes a form from its own address after the tab is closed', async ({
    page,
  }) => {
    await page.goto('/quote');
    await page
      .locator('article', { hasText: 'Level 2 EV charger install' })
      .getByRole('button', { name: 'Get a price' })
      .click();
    await screen(page, 'charger_location', choose('detached_garage'));

    // The session id is the capability — that is what lets a homeowner in a
    // garage close the tab and come back.
    const url = page.url();
    expect(url).toMatch(/\/quote\/s\/[0-9a-f-]{36}$/);

    await page.goto('/quote');
    await page.goto(url);
    await expect(
      page.locator('input[name="stateId"][value="charge_speed"]'),
    ).toHaveCount(1);
  });
});
