
const fs = require('fs');

// ── PATCH cleaning.html ──────────────────────────────────────────
let c = fs.readFileSync('public/cleaning.html', 'utf8');
let cOrig = c;

// Patch 1: camera scan - pass raw text directly
c = c.replace(
  /const raw=result\.getText\(\)\.startsWith\('OASIS:'\)\?result\.getText\(\)\.split\(':'\)\[1\]:result\.getText\(\);\s*handleScan\(raw,'camera'\);/g,
  "handleScan(result.getText(),'camera');"
);

// Patch 2: image upload scan
c = c.replace(
  /const raw=result\.getText\(\)\.startsWith\('OASIS:'\)\?result\.getText\(\)\.split\(':'\)\[1\]:result\.getText\(\);\s*handleScan\(raw,'image-upload'\);/g,
  "handleScan(result.getText(),'image-upload');"
);

// Patch 3: handleScan normalization + robust matching
c = c.replace(
  /async function handleScan\(raw, source='manual'\)\{\s*const order=D\.orders\.find\(o=>/,
  `async function handleScan(raw, source='manual'){
  raw=(raw||'').trim();
  if(/^OASIS:/i.test(raw))raw=raw.split(':')[1]||raw;
  raw=raw.toLowerCase();
  const order=D.orders.find(o=>`
);

// Fix the find conditions too
c = c.replace(
  /o\.id\.slice\(0,8\)===raw\|\|o\.id===raw\|\|\s*\(o\.qr_code\|\|''\)\.includes\(raw\)\|\|\s*\(o\.customers\?\.name\|\|''\)\.toLowerCase\(\)===raw\.toLowerCase\(\)/,
  `o.id.toLowerCase()===raw||
    o.id.toLowerCase().slice(0,8)===raw||
    raw.startsWith(o.id.toLowerCase())||
    (o.qr_code||'').toLowerCase().includes(raw)||
    (o.customers?.name||'').toLowerCase()===raw`
);

if(c !== cOrig) {
  fs.writeFileSync('public/cleaning.html', c);
  console.log('✓ cleaning.html patched');
} else {
  console.log('⚠ cleaning.html - no changes made (check regex)');
}

// ── PATCH counter.html ───────────────────────────────────────────
let t = fs.readFileSync('public/counter.html', 'utf8');
let tOrig = t;

// Patch 1: store plain UUID in qr_code
t = t.replace(
  "await patch('orders','id=eq.'+order.id,{qr_code:qrData});",
  "await patch('orders','id=eq.'+order.id,{qr_code:order.id});"
);

// Patch 2: normalize in counter handleScan
t = t.replace(
  /function handleScan\(raw\)\{\s*\/\/ raw is the order ID.*?\n\s*const order=D\.orders\.find\(o=>o\.id===raw\|\|o\.id\.slice\(0,8\)===raw\|\|\(o\.qr_code\|\|''\)\.includes\(raw\)\);/s,
  `function handleScan(raw){
  raw=(raw||'').trim();
  if(/^OASIS:/i.test(raw))raw=raw.split(':')[1]||raw;
  raw=raw.toLowerCase();
  const order=D.orders.find(o=>
    o.id.toLowerCase()===raw||
    o.id.toLowerCase().slice(0,8)===raw||
    raw.startsWith(o.id.toLowerCase())||
    (o.qr_code||'').toLowerCase().includes(raw)
  );`
);

if(t !== tOrig) {
  fs.writeFileSync('public/counter.html', t);
  console.log('✓ counter.html patched');
} else {
  console.log('⚠ counter.html - no changes made (check regex)');
}
