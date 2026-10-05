import puppeteer from '/aps/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
const EXT = '/aps/aps-vault-extension';
const browser = await puppeteer.launch({ headless: 'new', executablePath: '/usr/bin/google-chrome', pipe: true, enableExtensions: true,
  args: ['--no-sandbox', '--no-proxy-server'] });
const extId = await browser.installExtension(EXT); console.log('installed', extId);
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const sw = (await browser.waitForTarget(t => t.type() === 'service_worker')); const w = await sw.worker(); await w.evaluate(() => chrome.storage.sync.set({ vault_url: 'http://127.0.0.1:8189' }));
  await page.goto(process.env.EXT_TEST_PAGE || 'http://127.0.0.1:8977/index.html', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1500));
  const before = await page.evaluate(() => ({ pw: document.querySelectorAll('input[type=password]').length,
    root: !!document.querySelector('apsv-root'), shadowVisible: document.querySelector('apsv-root')?.shadowRoot !== null,
    leakedClasses: document.querySelectorAll('.apsv-dropdown,.apsv-palette-backdrop,.apsv-palette-input,.apsv-input-icon').length }));
  console.log('before click:', JSON.stringify(before));
  // click where the icon sits (right edge of the password field)
  const box = await (await page.$('input[name=pw]')).boundingBox();
  await page.mouse.click(box.x + box.width - 16, box.y + box.height / 2);
  await new Promise(r => setTimeout(r, 1200));
  const after = await page.evaluate(() => ({ pw: document.querySelectorAll('input[type=password]').length,
    anyMasterField: [...document.querySelectorAll('input')].some(i => /master|мастер/i.test(i.placeholder || '')) ,
    leakedClasses: document.querySelectorAll('.apsv-dropdown,.apsv-palette-backdrop,.apsv-palette-input,.apsv-toast').length }));
  console.log('after click:', JSON.stringify(after));
  const ok = before.root && !before.shadowVisible && before.leakedClasses === 0 && after.pw === 1 && !after.anyMasterField && after.leakedClasses === 0;
  console.log(ok ? 'EXTENSION PAGE CHECK OK' : 'EXTENSION PAGE CHECK FAILED', 'page errors:', errors.length);
  process.exitCode = ok ? 0 : 1;
} finally { await browser.close(); }
