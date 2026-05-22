// Playwright test for the restaurant popup stickiness on gemini.html
// Run: node popup_test.js
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

function startStaticServer(root, port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let url = req.url.split('?')[0];
      if (url === '/') url = '/gemini.html';
      const file = path.join(root, url);
      fs.readFile(file, (err, data) => {
        if (err) { res.statusCode = 404; res.end('not found'); return; }
        const ext = path.extname(file).toLowerCase();
        const types = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css' };
        res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
        res.end(data);
      });
    });
    server.listen(port, () => resolve(server));
  });
}

(async () => {
  const server = await startStaticServer(__dirname, 8765);
  const URL = 'http://localhost:8765/gemini.html';
  let pass = true;
  const fails = [];

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[BROWSER ERR]', msg.text());
  });

  try {
    console.log('1. Navigating to', URL);
    await page.goto(URL, { waitUntil: 'networkidle' });

    console.log('2. Waiting for map markers...');
    await page.waitForSelector('.leaflet-marker-icon', { timeout: 10000 });
    await page.waitForTimeout(1500);

    const count = await page.locator('.leaflet-marker-icon').count();
    console.log(`   Found ${count} marker icons`);

    console.log('3. Opening popup on a restaurant via map API (deterministic)...');
    // Use a deterministic restaurant: pick one that's a single non-clustered marker
    // by clicking the sidebar entry, which calls focusRest() → opens its popup.
    const firstSidebarItem = page.locator('.rest-item').first();
    await firstSidebarItem.click();
    await page.waitForTimeout(1200);

    console.log('4. Verify popup visible immediately...');
    await page.waitForSelector('.leaflet-popup', { timeout: 5000 });
    let popupVisible = await page.locator('.leaflet-popup').first().isVisible();
    console.log('   popup visible immediately:', popupVisible);
    if (!popupVisible) { pass = false; fails.push('popup not visible immediately'); }

    console.log('5. Waiting 3 seconds...');
    await page.waitForTimeout(3000);
    popupVisible = await page.locator('.leaflet-popup').count() > 0
                && await page.locator('.leaflet-popup').first().isVisible();
    console.log('   popup visible after 3s:', popupVisible);
    if (!popupVisible) { pass = false; fails.push('popup disappeared after 3s'); }

    console.log('6. Clicking inside popup content...');
    if (popupVisible) {
      await page.locator('.leaflet-popup-content').first().click();
      await page.waitForTimeout(500);
      popupVisible = await page.locator('.leaflet-popup').count() > 0
                  && await page.locator('.leaflet-popup').first().isVisible();
      console.log('   popup visible after content click:', popupVisible);
      if (!popupVisible) { pass = false; fails.push('popup closed on content click'); }
    }

    console.log('7. Clicking MAP background (should NOT close)...');
    if (popupVisible) {
      const mapBox = await page.locator('#map').boundingBox();
      await page.mouse.click(mapBox.x + mapBox.width - 50, mapBox.y + mapBox.height - 50);
      await page.waitForTimeout(500);
      popupVisible = await page.locator('.leaflet-popup').count() > 0
                  && await page.locator('.leaflet-popup').first().isVisible();
      console.log('   popup visible after map click:', popupVisible);
      if (!popupVisible) { pass = false; fails.push('popup closed on map background click'); }
    }

    console.log('7b. Panning the map...');
    if (popupVisible) {
      const mapBox = await page.locator('#map').boundingBox();
      const sx = mapBox.x + mapBox.width - 100, sy = mapBox.y + mapBox.height/2;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(sx - 150, sy - 100, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(500);
      popupVisible = await page.locator('.leaflet-popup').count() > 0
                  && await page.locator('.leaflet-popup').first().isVisible();
      console.log('   popup visible after pan:', popupVisible);
      if (!popupVisible) { pass = false; fails.push('popup closed on pan'); }
    }

    console.log('7c. Zooming the map...');
    if (popupVisible) {
      const mapBox = await page.locator('#map').boundingBox();
      await page.mouse.move(mapBox.x + mapBox.width/2, mapBox.y + mapBox.height/2);
      await page.mouse.wheel(0, -300);
      await page.waitForTimeout(800);
      popupVisible = await page.locator('.leaflet-popup').count() > 0
                  && await page.locator('.leaflet-popup').first().isVisible();
      console.log('   popup visible after zoom:', popupVisible);
      if (!popupVisible) { pass = false; fails.push('popup closed on zoom'); }
    }

    console.log('7d. Typing in sidebar search box (triggers renderSidebar/syncMarkers)...');
    if (popupVisible) {
      await page.locator('#search-box').fill('tap');
      await page.waitForTimeout(800);
      popupVisible = await page.locator('.leaflet-popup').count() > 0
                  && await page.locator('.leaflet-popup').first().isVisible();
      console.log('   popup visible after sidebar filter:', popupVisible);
      if (!popupVisible) { pass = false; fails.push('popup closed when sidebar filter ran (syncMarkers)'); }
      await page.locator('#search-box').fill('');
      await page.waitForTimeout(500);
    }

    console.log('8. Clicking X close button (SHOULD close)...');
    const closeBtn = page.locator('.leaflet-popup-close-button').first();
    if (await closeBtn.count() > 0 && popupVisible) {
      await closeBtn.click();
      await page.waitForTimeout(500);
      const stillVisible = await page.locator('.leaflet-popup').count() > 0;
      console.log('   popup still visible after X:', stillVisible);
      if (stillVisible) { pass = false; fails.push('popup did not close on X button'); }
    }

  } catch (err) {
    console.error('ERROR:', err.message);
    pass = false;
    fails.push('exception: ' + err.message);
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n========================');
  console.log(pass ? 'RESULT: PASS' : 'RESULT: FAIL');
  if (!pass) fails.forEach(f => console.log(' - ' + f));
  console.log('========================');
  process.exit(pass ? 0 : 1);
})();
