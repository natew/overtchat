import { expect, test, type Page } from "@playwright/test";
import { setupAgentAttention } from "./helpers/agent-attention";
import { resetE2eDatabase, setupUrl } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

function sidebarView(page: Page) {
  return page.getByRole("group", { name: "Sidebar view" }).filter({ visible: true });
}

function section(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

test("agents mode shows what each agent needs and tracks what was seen", async ({
  page,
}) => {
  const { reads } = await setupAgentAttention(page);

  // Chat mode keeps agents out of the chat list, but flags what needs you.
  await expect(sidebarView(page).getByRole("button", { name: "Chat" })).toHaveAttribute("aria-pressed", "true");
  const agentsToggle = sidebarView(page).getByRole("button", { name: "Agents, 2 need you" });
  await expect(agentsToggle).toBeVisible();
  await expect(page.getByRole("list", { name: "Agent workspaces", exact: true })).toHaveCount(0);

  // The Agents home starts a session with the most recently used setup.
  await agentsToggle.click();
  await page.waitForURL("**/agents/new?workspaceId=codex-app&provider=codex");
  await expect(sidebarView(page).getByRole("button", { name: "Agents" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "New Codex session" })).toBeVisible();
  const recent = page.getByRole("navigation", { name: "Recent setups" });
  await expect(recent.getByRole("link")).toHaveCount(1);
  await expect(recent.getByRole("link", { name: /api Claude Code · home-server/ })).toBeVisible();

  const needsYou = section(page, "Needs you");
  await expect(needsYou.getByRole("link")).toHaveCount(2);
  await expect(needsYou.getByRole("link").nth(0)).toContainText("Upgrade the parser");
  await expect(needsYou.getByRole("link").nth(0)).toContainText("Allow Bash · npm ci");
  await expect(needsYou.getByRole("link").nth(1)).toContainText("Fix the flaky test");
  await expect(needsYou.getByRole("link").nth(1)).toContainText("Rate limit reached");
  await expect(section(page, "Working").getByRole("link")).toHaveCount(1);
  await expect(section(page, "Working").getByRole("link")).toHaveAccessibleName(
    /^Working: Write the docs \d+m app · This machine$/,
  );
  const ready = section(page, "Ready to review");
  await expect(ready.getByRole("link")).toHaveCount(1);
  await expect(ready.getByRole("link")).toContainText("Added cursor pagination to /items.");

  // The workspace tree shows each session's state at the end of its row.
  await page.getByRole("button", { name: "Expand api" }).click();
  const tree = page.getByRole("list", { name: "Agent workspaces", exact: true });
  await expect(tree.getByRole("status", { name: "Add pagination finished" })).toBeAttached();
  await expect(tree.getByRole("status", { name: /^Old refactor/ })).toHaveCount(0);

  // Marking a finished session read files it away; unread brings it back.
  await ready.getByRole("link").hover();
  await ready.getByRole("button", { name: "Mark Add pagination as read" }).click();
  await expect(ready).toHaveCount(0);
  expect(reads).toEqual([{ sessionId: "ready", read: true }]);
  await tree.getByRole("link", { name: "Old refactor", exact: true }).hover();
  await tree.getByRole("button", { name: "Mark Old refactor as unread" }).click();
  await expect(section(page, "Ready to review").getByRole("link")).toContainText("Old refactor");
  expect(reads.at(-1)).toEqual({ sessionId: "seen", read: false });

  // Opening a session with an unseen result marks it read.
  await needsYou.getByRole("link", { name: /Fix the flaky test/ }).click();
  await page.waitForURL("**/agents/failed");
  await expect.poll(() => reads.at(-1)).toEqual({ sessionId: "failed", read: true });
  await expect(section(page, "Needs you").getByRole("link")).toHaveCount(1);

  // Settings keep the current mode, and each mode returns to where it was left.
  await page.goto("/settings/general");
  await expect(sidebarView(page).getByRole("button", { name: "Agents" })).toHaveAttribute("aria-pressed", "true");
  await sidebarView(page).getByRole("button", { name: "Chat" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(sidebarView(page).getByRole("button", { name: "Agents, 1 needs you" })).toBeVisible();
  await sidebarView(page).getByRole("button", { name: "Agents, 1 needs you" }).click();
  await page.waitForURL("**/agents/failed");
});

test("the Agents home explains how to start when no folder is connected", async ({
  page,
}) => {
  await page.context().route("**/api/agent-connections", (route) =>
    route.fulfill({ json: { connections: [] } }),
  );
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Empty Agents Admin");
  await page.locator("#email").fill("empty-agents@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");

  await sidebarView(page).getByRole("button", { name: "Agents" }).click();
  await page.waitForURL((url) => url.pathname === "/agents");
  await expect(page.getByRole("heading", { name: "Start an agent in a folder" })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Add workspace" }).click();
  await page.waitForURL("**/settings/connections?add=1");
});
