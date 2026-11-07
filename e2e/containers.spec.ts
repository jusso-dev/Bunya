import { expect, test } from "@playwright/test";

type SavedNode = { id: string; type: string; parentId?: string | null };

test("a service added over a Resource Group is placed inside it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add Resource Group", exact: true }).click();
  await page.getByRole("button", { name: "Add Storage Account", exact: true }).click();

  await expect(page.locator(".react-flow__node-container")).toHaveCount(1);
  await expect(page.locator(".react-flow__node-service")).toHaveCount(1);

  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("bunya.document.v1") ?? "{\"nodes\":[]}").nodes as SavedNode[]);
  await expect.poll(async () => (await saved()).length).toBe(2);
  const nodes = await saved();
  const group = nodes.find((node) => node.type === "resourceGroup")!;
  const storage = nodes.find((node) => node.type === "storageAccount")!;
  expect(storage.parentId).toBe(group.id);
});
