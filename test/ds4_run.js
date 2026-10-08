// Drives the deployed app on DS4 (client 410) with Playwright: loads a template file, dry run, optionally Execute in SAP.
// Credentials: DS4_TEST_USER / DS4_TEST_PASSWORD (test user in client 410 with authorization for service group
// API_PRODUCT), falling back to FIORI_TOOLS_USER / FIORI_TOOLS_PASSWORD (the deploy user), from the environment or the
// .env file in the project root. Run: node ds4_run.js "<file.xml>" [--run] [--client 410]
'use strict';
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs'), path = require('path');
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) for (const l of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ''); }
const user = process.env.DS4_TEST_USER || process.env.FIORI_TOOLS_USER, pass = process.env.DS4_TEST_PASSWORD || process.env.FIORI_TOOLS_PASSWORD;
if (!user || !pass) { console.error('DS4_TEST_USER / DS4_TEST_PASSWORD (or FIORI_TOOLS_USER / FIORI_TOOLS_PASSWORD) not set (.env in the project root)'); process.exit(2); }
console.log('SAP user', user);
const args = process.argv.slice(2); const file = args.find(a => !a.startsWith('--'));
const run = args.includes('--run'); const client = args.includes('--client') ? args[args.indexOf('--client') + 1] : '410';
if (!file) { console.error('usage: node ds4_run.js "<file.xml>" [--run] [--client 410]'); process.exit(2); }
const HOST = 'https://vhlruds4ci.sap.allseas.global:44300';
const URL = `${HOST}/sap/bc/ui5_ui5/sap/zmm_matmass_mdg/tool.html?sap-client=${client}`;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ httpCredentials: { username: user, password: pass }, ignoreHTTPSErrors: true, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const logText = () => page.evaluate(() => fullLog.join('\n'));
  const waitIdle = () => page.waitForFunction(() => !document.getElementById('btnRun').disabled && document.getElementById('btnStop').disabled, null, { timeout: 600000 });
  console.log('open', URL);
  const resp = await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
  console.log('HTTP', resp && resp.status(), (await page.title()) || '');
  if (!(await page.$('#btnRun'))) { console.log((await page.content()).substring(0, 800)); throw new Error('tool.html not loaded (logon page?)'); }
  await page.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true));
  await page.fill('#client', client);
  await page.uncheck('#autoDl');
  await page.waitForFunction(() => !/testing|not tested/.test(document.getElementById('connState').textContent), null, { timeout: 120000 });
  console.log('connection:', await page.textContent('#connState'));
  await page.setInputFiles('#file', path.resolve(file));
  await page.waitForFunction(() => /File loaded/.test(fullLog.join('\n')), null, { timeout: 120000 });
  await page.check('input[name=mode][value=change]');
  await page.click('#btnDry'); await page.waitForFunction(() => /Validation against/.test(fullLog.join('\n')), null, { timeout: 120000 });
  console.log('--- dry run log ---\n' + await logText());
  if (run) {
    await page.click('#btnRun'); await waitIdle();
    console.log('--- run log ---\n' + await logText());
    const status = await page.$$eval('#grid td.st', t => t.map(x => x.textContent));
    console.log('status column:', status.join(' | '));
  }
  const out = path.join(__dirname, `ds4_run_${new Date().toISOString().replace(/[:T]/g, '-').substring(0, 19)}.log`);
  fs.writeFileSync(out, await logText()); console.log('log saved', out);
  if (errors.length) console.log('page errors:', errors.join('\n'));
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
