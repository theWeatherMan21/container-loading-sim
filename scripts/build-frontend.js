const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

// Keep this list explicit so a stale or missing frontend asset cannot reach packaging.
const FRONTEND_FILES = [
  'index.html',
  'styles.css',
  'app.js',
  'field-parser.js',
  'container-db.js',
  'planner.js',
  'packing-engine.js',
  'three-viewer.js',
  'pdf-exporter.js',
  'tauri-plugin-bridge.js',
  'recommendation-worker.js'
];

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function assertDistMatchesSource() {
  const expected = new Set(FRONTEND_FILES);
  const actual = fs.readdirSync(dist, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name);

  const missing = FRONTEND_FILES.filter(file => !fs.existsSync(path.join(dist, file)));
  const unexpected = actual.filter(file => !expected.has(file));
  if (missing.length || unexpected.length) {
    throw new Error([
      missing.length ? `missing: ${missing.join(', ')}` : '',
      unexpected.length ? `unexpected: ${unexpected.join(', ')}` : ''
    ].filter(Boolean).join('; '));
  }

  const mismatched = FRONTEND_FILES.filter(file =>
    sha256(path.join(root, file)) !== sha256(path.join(dist, file))
  );
  if (mismatched.length) {
    throw new Error(`SHA-256 mismatch: ${mismatched.join(', ')}`);
  }
}

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
    const request = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close(() => fs.rmSync(dest, { force: true }));
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    });
    request.on('error', (error) => {
      file.close(() => fs.rmSync(dest, { force: true }));
      reject(error);
    });
  });
}

(async () => {
  // Ensure vendor/html2canvas.min.js exists (needed for PDF export)
  const html2canvasPath = path.join(root, 'vendor', 'html2canvas.min.js');
  const html2canvasUrl = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  if (!fs.existsSync(html2canvasPath)) {
    console.log('Downloading html2canvas.min.js...');
    fs.mkdirSync(path.dirname(html2canvasPath), { recursive: true });
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

  FRONTEND_FILES.forEach(file => copy(file));

  // Copy vendor directory
  if (fs.existsSync(path.join(root, 'vendor'))) {
    copy('vendor');
  }

  assertDistMatchesSource();
  console.log(`Frontend copied to ${dist}`);
  console.log(`Verified ${FRONTEND_FILES.length} frontend files by SHA-256.`);
})().catch((error) => {
  console.error(`Frontend build verification failed: ${error.message}`);
  process.exitCode = 1;
});
