import { Page, Locator } from '@playwright/test';

export async function dragStoryToLane(page: Page, storyTitle: string, laneId: 'backlog' | 'active' | 'done') {
  // Find the story card by title (first match)
  const card = page.locator('div').filter({ hasText: storyTitle }).first();
  const dropArea = page.locator(`#${laneId}-stories`);

  // Try native drag API first
  try {
    await card.dragTo(dropArea, { timeout: 10_000 });
    return;
  } catch {
    // Fallback: manual mouse events
    const box = await card.boundingBox();
    const target = await dropArea.boundingBox();
    if (!box || !target) throw new Error('Could not locate card or drop area');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + 30, { steps: 8 });
    await page.mouse.up();
  }
}

