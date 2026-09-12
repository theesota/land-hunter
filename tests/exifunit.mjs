import { readFileSync } from 'fs';
import { readGps } from '../js/exif.js';
const g = await readGps(new Blob([readFileSync(new URL('./fixtures/gps.jpg', import.meta.url))]));
const n = await readGps(new Blob([readFileSync(new URL('./fixtures/nogps.jpg', import.meta.url))]));
const p = await readGps(new Blob([readFileSync(new URL('./fixtures/test.png', import.meta.url))]));
console.log('gps:', g, '/ nogps:', n, '/ png:', p);
const ok = g && Math.abs(g.lat - 36.297) < 1e-4 && Math.abs(g.lng - 139.208) < 1e-4 && n === null && p === null;
console.log(ok ? 'UNIT OK' : 'UNIT NG');
process.exit(ok ? 0 : 1);
