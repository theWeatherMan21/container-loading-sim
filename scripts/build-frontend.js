const fs = require('fs');
const path = require('path');
const https = require('https');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

function copy(src, dest) {
  const srcPath = path.join(root, src);
  const destPath = path.join(dist, dest || src);
  if (!fs.existsSync(srcPath)) return;
  if (fs.statSync(srcPath).isDirectory()) {
    fs.mkdirSync(destPath, { recursive: true });
    for (const entry of fs.readdirSync(srcPath)) {
      copy(path.join(src, entry), path.join(dest || src, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', reject);
  });
}

(async () => {
  // Ensure vendor/html2canvas.min.js exists (needed for PDF export)
  const html2canvasPath = path.join(root, 'vendor', 'html2canvas.min.js');
  const html2canvasUrl = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  if (!fs.existsSync(html2canvasPath)) {
    console.log('Downloading html2canvas.min.js...');
    try {
      await downloadFile(html2canvasUrl, html2canvasPath);
      console.log('html2canvas.min.js downloaded.');
    } catch (e) {
      console.error('Failed to download html2canvas.min.js. PDF export may not work.', e.message);
    }
  }

  // Clean and recreate dist
  if (fs.existsSync(dist)) {
    fs.rmSync(dist, { recursive: true, force: true });
  }
  fs.mkdirSync(dist, { recursive: true });

  // Copy root frontend files
  [
    'index.html',
    'styles.css',
    'app.js',
    'field-parser.js',
    'container-db.js',
    'packing-engine.js',
    'three-viewer.js',
    'pdf-exporter.js',
    'tauri-plugin-bridge.js'
  ].forEach(f => copy(f));

  // Copy vendor directory
  if (fs.existsSync(path.join(root, 'vendor'))) {
    copy('vendor');
  }

  console.log(`Frontend copied to ${dist}`);
})();