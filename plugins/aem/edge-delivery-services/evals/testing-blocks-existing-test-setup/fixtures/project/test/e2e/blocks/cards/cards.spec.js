import { test, expect } from '@playwright/test';

test.describe('cards block', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/docs/library/blocks/cards');
    await page.locator('.cards[data-block-status="loaded"]').waitFor();
  });

  test('renders each card as a list item', async ({ page }) => {
    await expect(page.locator('.cards').getByRole('listitem')).not.toHaveCount(0);
  });
});
