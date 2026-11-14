// Kane's delete step, action for action: a click on keep-a's delete button, then a key press on the same focused
// button. Usage: node check/kane-actions-2312.cjs <url-of-the-app-folder>   (needs playwright and Google Chrome)
// On the app as it was: the click deletes done-one, keep-a and its focused button stay, the key press deletes keep-a,
// and All shows only keep-b. On the fixed app: the click deletes keep-a, the key press finds nothing, and All shows
// done-one and keep-b.
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require('playwright-core'); } })();
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext()).newPage();
  await page.goto(process.argv[2]); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForSelector('.new-todo');
  for (const t of ['done-one', 'keep-a', 'keep-b']) { await page.fill('.new-todo', t); await page.press('.new-todo', 'Enter'); }
  await page.locator('.todo-list li', { hasText: 'done-one' }).locator('.toggle').click();
  await page.getByRole('link', { name: 'Active', exact: true }).click(); await page.waitForTimeout(300);
  const row = page.locator('.todo-list li', { hasText: 'keep-a' });
  await row.hover(); await row.locator('.destroy').click(); await page.waitForTimeout(200);
  const afterClick = await page.locator('.todo-list li label').allInnerTexts();
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.className);
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  const afterEnter = await page.locator('.todo-list li label').allInnerTexts();
  await page.getByRole('link', { name: 'All', exact: true }).click(); await page.waitForTimeout(300);
  console.log(JSON.stringify({ afterClick, focusedAfterClick: focused, afterEnter, all: await page.locator('.todo-list li label').allInnerTexts() }));
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
