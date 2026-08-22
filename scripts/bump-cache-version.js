const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const version = process.argv[2] || [
  now.getFullYear(),
  pad(now.getMonth() + 1),
  pad(now.getDate()),
  '-',
  pad(now.getHours()),
  pad(now.getMinutes()),
  pad(now.getSeconds()),
].join('');

const files = ['public/index.html', 'public/admin.html'];
const assetRe = /((?:href|src)=['"](?:\.\/)?(?:style|admin|api|data|script|admin)\.(?:css|js))(?:\?v=[^'"]*)?(['"])/g;

for (const file of files) {
  const abs = path.join(process.cwd(), file);
  let html = fs.readFileSync(abs, 'utf8');
  html = html.replace(assetRe, `$1?v=${version}$2`);
  fs.writeFileSync(abs, html, 'utf8');
}

console.log('Cache version:', version);
