// Runs both cases in a fresh page each and prints what the page logged.
//
//   npm run dev        # in one terminal
//   npm run repro      # in another
import { chromium } from 'playwright-core';

const URL = process.env.REPRO_URL ?? 'http://localhost:5191/';

const browser = await chromium.launch();
const results = {};

for (const run of ['removeDuringLoad', 'removeDuringSync']) {
    const page = await browser.newPage({ viewport : { width : 1280, height : 760 } });
    page.on('pageerror', error => console.log(`page error: ${error.message}`));
    await page.goto(URL);
    await page.locator('.b-sch-event-wrap').first().waitFor({ timeout : 60_000 });
    await page.waitForTimeout(800);
    results[run] = await page.evaluate(name => window[name](), run);
    console.log(`\n--- ${run}\n${await page.locator('#log').textContent()}`);
    await page.close();
}

await browser.close();
const reproduced = Object.values(results).some(({ sent }) => !sent);
console.log(reproduced ? 'reproduced' : 'not reproduced');
process.exit(reproduced ? 0 : 1);
