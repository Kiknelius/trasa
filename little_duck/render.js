// Render all frames of the scene headlessly: node render.js <out_dir> [workers]
// Each worker is its own Chromium (SwiftShader WebGL) rendering a contiguous chunk of frames.
const { chromium } = require('playwright');
const fs = require('fs');
const URL = process.env.SCENE_URL || 'http://127.0.0.1:8765/scene/index.html';
const FPS = 30, DURATION = 22.8, N = Math.round(FPS * DURATION);
(async () => {
  const out = process.argv[2] || 'build/frames';
  const workers = parseInt(process.argv[3] || '3', 10);
  fs.mkdirSync(out, { recursive: true });
  const t0 = Date.now(); let done = 0;
  const chunk = Math.ceil(N / workers);
  await Promise.all([...Array(workers).keys()].map(async w => {
    const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    p.on('pageerror', e => console.log(`[w${w}] PAGEERROR`, e.message));
    await p.goto(URL); await p.evaluate(() => window.ready);
    for (let i = w * chunk; i < Math.min(N, (w + 1) * chunk); i++) {
      const f = `${out}/f${String(i).padStart(5, '0')}.png`;
      if (fs.existsSync(f) && fs.statSync(f).size > 0 && !process.env.FORCE) { done++; continue; }
      await p.evaluate(t => window.renderFrame(t), i / FPS);
      await p.screenshot({ path: f + '.tmp.png' }); fs.renameSync(f + '.tmp.png', f);
      if (++done % 50 === 0) console.log(`${done}/${N} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
    await b.close();
  }));
  console.log(`done: ${N} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
})();
