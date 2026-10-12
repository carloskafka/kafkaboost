'use strict';
// Generates every icon size from the single source app/renderer/icon.svg.
//   cd app && npx electron ../tools/make-icons.js
// Outputs: app/build/icon.png (512, electron-builder makes the .ico from it), docs/favicon.svg, docs/favicon-dark.svg,
//          docs/favicon-32.png, docs/apple-touch-icon.png (180)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcSvg = fs.readFileSync(path.join(root, 'app', 'renderer', 'icon.svg'), 'utf8');
// The dark-scheme tab icon needs lighter gradient stops, otherwise it vanishes against a dark tab strip.
const darkSvg = srcSvg.replace('#5b7cff', '#8aa4ff').replace('#b05cff', '#c99bff');

// Renders at 512 px (a window cannot be 32 px wide on Windows), smaller sizes are resized from that image.
function render512(svg) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, useContentSize: true });
    const html = `<!doctype html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="512" height="512" style="display:block"></body>`;
    win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      try { const img = await win.webContents.capturePage(); win.destroy(); resolve(img); } catch (e) { reject(e); }
    }, 400));
  });
}

const write = (file, img, size) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, (size ? img.resize({ width: size, height: size, quality: 'best' }) : img).toPNG()); };

// Several windows are rendered one after another: do not let Electron quit when the first one closes.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'favicon.svg'), srcSvg);
    fs.writeFileSync(path.join(root, 'docs', 'favicon-dark.svg'), darkSvg);
    fs.mkdirSync(path.join(root, 'app', 'build'), { recursive: true });
    fs.copyFileSync(path.join(root, 'app', 'renderer', 'icon.svg'), path.join(root, 'app', 'build', 'icon.svg'));
    const img = await render512(srcSvg);
    write(path.join(root, 'app', 'build', 'icon.png'), img);
    // Windows .ico (for shortcuts and the installer): one 256x256 PNG-compressed image (supported since Windows Vista).
    const png256 = img.resize({ width: 256, height: 256, quality: 'best' }).toPNG();
    const head = Buffer.alloc(22);
    head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);          // reserved, type=icon, count=1
    head[6] = 0; head[7] = 0; head[8] = 0; head[9] = 0;                                     // 256x256 is stored as 0, no palette
    head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);                                  // planes, bits per pixel
    head.writeUInt32LE(png256.length, 14); head.writeUInt32LE(22, 18);                      // image size, offset
    fs.writeFileSync(path.join(root, 'app', 'build', 'icon.ico'), Buffer.concat([head, png256]));
    write(path.join(root, 'docs', 'favicon-32.png'), img, 32);
    write(path.join(root, 'docs', 'apple-touch-icon.png'), img, 180);
    // Tray icons: the app icon with a status dot in the corner (green = optimized, amber = needs a look, red = broken, grey = unknown).
    const dots = { ok: '#2fd39a', warn: '#f5b93e', fail: '#ff6b81', unknown: '#8d98b3' };
    for (const [name, color] of Object.entries(dots)) {
      const svg = srcSvg.replace('</svg>', `<circle cx="194" cy="194" r="58" fill="${color}" stroke="#ffffff" stroke-width="12"/></svg>`);
      write(path.join(root, 'app', 'build', `tray-${name}.png`), await render512(svg), 64);
    }
    console.log('icons written');
  } catch (e) { console.error(e); process.exitCode = 1; }
  app.quit();
});
