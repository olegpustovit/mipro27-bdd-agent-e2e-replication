import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const observations = [];
  for (const javaScriptEnabled of [false, true]) {
    const page = await browser.newPage({ baseURL: 'http://webserver', javaScriptEnabled });
    page.setDefaultTimeout(12_000);
    await page.goto('/login/index.php');
    await page.locator('#username').fill('teacher1');
    await page.locator('#password').fill('teacher1');
    await page.locator('#loginbtn').click();
    await page.locator('.usermenu').waitFor();
    const path = new URL(page.url()).pathname;
    observations.push({ javaScriptEnabled, path });
    await page.context().close();
  }
  console.log(JSON.stringify({
    status: observations.every(({ path }) => ['/my/', '/my/index.php'].includes(path)) ? 'pass' : 'fail',
    observations,
  }));
} finally {
  await browser.close();
}
