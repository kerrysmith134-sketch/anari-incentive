import { expect, test } from "@playwright/test";

const PAGES = [
  "/console/",
  "/console/cycles",
  "/console/performance",
  "/console/institutions",
  "/console/equity",
  "/console/payroll",
  "/console/policy",
  "/console/ai",
  "/console/settlements",
  "/console/rewards",
  "/console/commission",
  "/console/award-batches",
  "/console/task-pods",
  "/console/privacy",
];

const FORBIDDEN = [
  "but the cycle still needs",
  "A formal locked calculation",
  "Formal and shadow runs",
  "This policy has no recorded applicability",
  "New publications require legal entity",
  "append-only entries",
  "NOTICE COMPLETE",
  "Notice complete",
  "Enter a person id",
  "require ack",
  "not run",
  "failed ·",
  "Batches",
];

test.describe("Chinese-first visible UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "anari.session",
        JSON.stringify({
          tenantId: "tenant-demo",
          userId: "dev-user",
          personId: "00000000-0000-4000-8000-000000000001",
          token: "",
        }),
      );
    });
  });

  for (const path of PAGES) {
    test(`has no known English UI residue on ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForTimeout(400);
      const text = await page.locator("body").innerText();
      const hits = FORBIDDEN.filter((phrase) =>
        text.toLowerCase().includes(phrase.toLowerCase()),
      );
      expect(hits, `在 ${path} 仍发现英文残留：${hits.join(" / ")}`).toEqual([]);
    });
  }

  test("no visible horizontal scrollbar on the policy centre", async ({ page }) => {
    await page.goto("/console/institutions");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
