import { expect, type Page } from "@playwright/test";

// Waits until the canvas viewport stops moving (fitView animates), so a
// screenshot shows the final layout.
export async function canvasSettled(page: Page) {
  const viewport = page.locator(".react-flow__viewport");
  let previous = "";
  await expect.poll(async () => {
    const current = await viewport.evaluate((element) => getComputedStyle(element).transform);
    const stable = current === previous;
    previous = current;
    return stable;
  }, { intervals: [100] }).toBe(true);
}
