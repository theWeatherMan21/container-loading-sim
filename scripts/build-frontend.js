const fs = require('fs');
const path = require('path');

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
