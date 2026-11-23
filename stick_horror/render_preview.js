// Render selected frames to PNG for checking: node render_preview.js out_dir t1 t2 ...
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [out, ...ts] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.text()); });
  await p.goto('http://127.0.0.1:8766/scene/index.html');
  await p.evaluate(() => window.ready);
  for (const t of ts) {
    const t0 = Date.now();
    await p.evaluate(tt => window.renderFrame(tt), parseFloat(t));
    const t1 = Date.now();
    await p.screenshot({ path: `${out}/t${String(t).padStart(5, '0')}.png` });
    console.log(`t=${t} render ${t1 - t0} ms, shot ${Date.now() - t1} ms`);
  }
  await b.close();
})();
