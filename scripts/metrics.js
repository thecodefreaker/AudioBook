import fs from 'fs';

const s = fs.readFileSync('src/main.js', 'utf8');
const fns = [...s.matchAll(/^(?:async )?function (\w+)/gm)].map((m) => m[1]);

console.log('main.js metrics');
console.log('  lines:                ', s.split('\n').length);
console.log('  top-level functions:  ', fns.length);
console.log('  innerHTML assignments:', (s.match(/innerHTML\s*=/g) || []).length);
console.log('  inline style="...":   ', (s.match(/style="/g) || []).length);
console.log('  addEventListener:     ', (s.match(/addEventListener/g) || []).length);
console.log('  api. calls:           ', (s.match(/\bapi\.\w+/g) || []).length);
