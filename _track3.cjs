const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
const wbStart = src.indexOf('<div className="spice-workbench"');
const sub = src.substring(wbStart);
const re = /<div\b[^>]*>|<\/div>/g;
let depth = 1; // spice-workbench open
let m;
let underflowAt = -1;
while ((m = re.exec(sub))) {
  const isOpen = m[0].startsWith('<div');
  if (isOpen) depth++;
  else { depth--; }
  if (depth === 0) {
    console.log('close at pos', wbStart + m.index, 'byte', m.index);
    console.log('snippet:', sub.substring(Math.max(0, m.index - 80), m.index + 80));
    break;
  }
}
console.log('final depth from start of wb:', depth);