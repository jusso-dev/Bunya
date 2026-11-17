import { expect, test, type Page } from "@playwright/test";

type SavedNode = { id: string; type: string; position: { x: number; y: number }; parentId?: string | null };

// Wide enough that both side panels can be collapsed, leaving room to drag.
test.use({ viewport: { width: 1600, height: 1000 } });

async function saved(page: Page): Promise<SavedNode[]> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("bunya.document.v1") ?? "{\"nodes\":[]}").nodes as SavedNode[]);
}

async function savedNode(page: Page, type: string): Promise<SavedNode> {
  const node = (await saved(page)).find((candidate) => candidate.type === type);
  if (!node) throw new Error(`No saved ${type}`);
  return node;
}

// Autosave is debounced, so wait for the saved copy to catch up with the canvas.
async function settleSaved(page: Page, type: string, expected: { x: number; y: number; parentId: string | null }) {
  await expect.poll(async () => {
    const node = await savedNode(page, type);
    return { x: node.position.x, y: node.position.y, parentId: node.parentId ?? null };
  }).toEqual(expected);
}

async function current(page: Page, type: string) {
  const node = await savedNode(page, type);
  return { x: node.position.x, y: node.position.y, parentId: node.parentId ?? null };
}

// A real pointer gesture: press, many small moves, release.
async function dragBy(page: Page, locator: ReturnType<Page["locator"]>, dx: number, dy: number, grab = { x: 10, y: 10 }) {
  const box = (await locator.boundingBox())!;
  const startX = box.x + grab.x;
  const startY = box.y + grab.y;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 25 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("bunya-canvas")).toBeVisible();
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  await page.getByRole("button", { name: "Output", exact: true }).click();
});

// Autosave is debounced; wait until the saved copy matches what was added.
async function addAndSettle(page: Page, label: string, count: number) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(count);
  await expect.poll(async () => (await saved(page)).length).toBe(count);
}

// A Storage Account added over a Resource Group lands inside it.
async function addStorageInGroup(page: Page) {
  await addAndSettle(page, "Add Resource Group", 1);
  await addAndSettle(page, "Add Storage Account", 2);
  await expect.poll(async () => {
    const nodes = await saved(page);
    const group = nodes.find((node) => node.type === "resourceGroup");
    const storage = nodes.find((node) => node.type === "storageAccount");
    return !!group && !!storage && storage.parentId === group.id;
  }).toBe(true);
}

const undo = (page: Page) => page.getByRole("button", { name: "Undo", exact: true });
const redo = (page: Page) => page.getByRole("button", { name: "Redo", exact: true });

test("one drag within its Resource Group is one undo step", async ({ page }) => {
  await addStorageInGroup(page);
  const storage = page.locator(".react-flow__node-service");
  const before = await current(page, "storageAccount");
  await dragBy(page, storage, 112, 64);
  await expect.poll(async () => (await current(page, "storageAccount")).x).toBeGreaterThan(before.x);
  const after = await current(page, "storageAccount");
  expect(after.parentId).toBe(before.parentId);
  await settleSaved(page, "storageAccount", after);

  await undo(page).click();
  await settleSaved(page, "storageAccount", before);
  await redo(page).click();
  await settleSaved(page, "storageAccount", after);
  await undo(page).click();
  await settleSaved(page, "storageAccount", before);

  // The one step above was the whole drag: the next Undo reverts adding the Storage Account.
  await undo(page).click();
  await expect(page.locator(".react-flow__node-service")).toHaveCount(0);
});

test("dragging a service into a Resource Group and undoing puts it back outside", async ({ page }) => {
  await addAndSettle(page, "Add Storage Account", 1);
  await addAndSettle(page, "Add Resource Group", 2);
  const storage = page.locator(".react-flow__node-service");
  const group = page.locator(".react-flow__node-container");
  const before = await current(page, "storageAccount");
  expect(before.parentId).toBeNull();
  const groupBox = (await group.boundingBox())!;
  const storageBox = (await storage.boundingBox())!;
  // Drop it well inside the group.
  await dragBy(page, storage, groupBox.x + groupBox.width / 2 - storageBox.x, groupBox.y + groupBox.height / 2 - storageBox.y);
  const groupId = (await savedNode(page, "resourceGroup")).id;
  await expect.poll(async () => (await current(page, "storageAccount")).parentId).toBe(groupId);
  const after = await current(page, "storageAccount");
  await settleSaved(page, "storageAccount", after);

  await undo(page).click();
  await settleSaved(page, "storageAccount", before);
  await redo(page).click();
  await settleSaved(page, "storageAccount", after);
  await undo(page).click();
  await settleSaved(page, "storageAccount", before);
  // The drag, including the reparent, was a single step; the next Undo removes the Resource Group.
  await undo(page).click();
  await expect(page.locator(".react-flow__node-container")).toHaveCount(0);
});

test("dragging a Resource Group is undoable", async ({ page }) => {
  await addStorageInGroup(page);
  const group = page.locator(".react-flow__node-container");
  const before = await current(page, "resourceGroup");
  await dragBy(page, group, 48, 80, { x: 6, y: 6 });
  await expect.poll(async () => (await current(page, "resourceGroup")).y).toBeGreaterThan(before.y);
  const after = await current(page, "resourceGroup");
  await settleSaved(page, "resourceGroup", after);

  await undo(page).click();
  await settleSaved(page, "resourceGroup", before);
  // Undo reverted the drag only; the Storage Account added earlier is still there.
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await redo(page).click();
  await settleSaved(page, "resourceGroup", after);
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
});

test("a click that does not move the node adds no undo step and keeps redo", async ({ page }) => {
  await addStorageInGroup(page);
  const storage = page.locator(".react-flow__node-service");
  const before = await current(page, "storageAccount");
  await dragBy(page, storage, 96, 48);
  await expect.poll(async () => (await current(page, "storageAccount")).x).toBeGreaterThan(before.x);
  await undo(page).click();
  await settleSaved(page, "storageAccount", before);
  await expect(redo(page)).toBeEnabled();

  await storage.click({ position: { x: 10, y: 10 } });
  await expect(redo(page)).toBeEnabled();
  await redo(page).click();
  await expect.poll(async () => (await current(page, "storageAccount")).x).toBeGreaterThan(before.x);
});

test("an arrow-key nudge can be undone", async ({ page }) => {
  await addStorageInGroup(page);
  const storage = page.locator(".react-flow__node-service");
  await storage.click({ position: { x: 10, y: 10 } });
  const before = await current(page, "storageAccount");
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await current(page, "storageAccount")).x).toBeGreaterThan(before.x);
  await undo(page).click();
  await settleSaved(page, "storageAccount", before);
});
