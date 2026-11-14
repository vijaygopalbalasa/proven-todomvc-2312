// Deterministic check for tastejs/todomvc#2312 (mithril): deleting a todo in the Active view must delete that todo.
// Usage: node check-2312.cjs <url-of-the-app-folder>   (needs playwright and Google Chrome). Exit 0 = fixed, 1 = bug present.
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require('playwright-core'); } })();
(async () => {
  const base = process.argv[2];
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext()).newPage();
  await page.goto(base); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForSelector('.new-todo');
  for (const t of ['done-one', 'keep-a', 'keep-b']) { await page.fill('.new-todo', t); await page.press('.new-todo', 'Enter'); }
  await page.locator('.todo-list li', { hasText: 'done-one' }).locator('.toggle').click();
  await page.getByRole('link', { name: 'Active', exact: true }).click(); await page.waitForTimeout(300);
  const row = page.locator('.todo-list li', { hasText: 'keep-a' });
  await row.hover(); await row.locator('.destroy').click();
  await page.getByRole('link', { name: 'All', exact: true }).click(); await page.waitForTimeout(300);
  const left = await page.locator('.todo-list li label').allInnerTexts();
  const ok = JSON.stringify(left) === JSON.stringify(['done-one', 'keep-b']);
  console.log(JSON.stringify({ remaining: left, expected: ['done-one', 'keep-b'], result: ok ? 'PASS (fixed)' : 'FAIL (bug present)' }));
  await browser.close(); process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
