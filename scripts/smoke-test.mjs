import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { toJalaali, toGregorian, isValidJalaaliDate, jalaaliMonthLength } from 'jalaali-js';
import {
  calculateInvoice,
  jalaliDateToIso,
  gregorianIsoToJalali,
  jalaliMonthKey,
  shiftJalaliMonth
} from '../www/js/domain.js';

const html = fs.readFileSync('www/index.html', 'utf8');
const app = fs.readFileSync('www/app.js', 'utf8');
const css = fs.readFileSync('www/styles.css', 'utf8');
const debugWorkflow = fs.readFileSync('.github/workflows/android-debug.yml', 'utf8');
const releaseWorkflow = fs.readFileSync('.github/workflows/android-market-release.yml', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('www/manifest.webmanifest', 'utf8'));

for (const id of [
  'statsGrid','statsChart','chartDetails','unsettledPreview','invoiceList',
  'invoiceFilter','settingsForm','logoFile','stampFile','closeModalBtn','privacyBtn'
]) {
  assert.ok(html.includes(`id="${id}"`), `Missing UI element: ${id}`);
}
assert.ok(html.includes('assets/farnava-logo.png'), 'Farnava logo is not wired into the app UI');
assert.ok(fs.existsSync('www/assets/farnava-logo.png'), 'Farnava logo asset missing');
assert.ok(fs.existsSync('www/assets/app-icon.png'), 'App icon asset missing');
assert.ok(fs.existsSync('www/privacy.html'), 'Public privacy page missing');
assert.ok(html.includes('app.bundle.js'), 'Bundled app entry is missing');
assert.ok(app.includes('createPdfBlob'), 'PDF export pipeline missing');
assert.ok(app.includes('createDocxBlob'), 'DOCX export pipeline missing');
assert.ok(app.includes('shareBlob'), 'File sharing pipeline missing');
assert.ok(app.includes('paidAmount') && app.includes('remaining'), 'Unsettled balance calculation missing');
assert.ok(app.includes('parseJalali') && app.includes('toJalaali'), 'Jalali date handling missing');
assert.ok(app.includes('previewTemplate') && app.includes('previewFont'), 'Live template/font preview missing');
assert.ok(app.includes('openPrivacyPolicy'), 'In-app privacy policy action missing');
assert.ok(css.includes('@font-face') && css.includes('template-luxury'), 'Invoice font/template styling missing');
assert.equal(pkg.name, 'farnava', 'Package should use the public app name');
assert.equal(pkg.version, '1.0.0', 'Package version should be 1.0.0');
assert.ok(!pkg.dependencies?.['@capacitor-community/in-app-review'], 'Unexpected review plugin');
assert.ok(!Object.keys(pkg.dependencies || {}).some(x => /billing|purchase|payment/i.test(x)), 'This free app must not include billing dependencies');
assert.equal(manifest.short_name, 'فرنوا');
assert.ok(!/پرمیوم|لایت|Premium|Lite/.test(html), 'Paid tier wording must not appear in the user interface');
assert.ok(debugWorkflow.includes('assembleDebug') && debugWorkflow.includes('farnava-debug-apk'), 'Debug workflow is incomplete');
assert.ok(releaseWorkflow.includes('assembleRelease') && releaseWorkflow.includes('FARNAVA_KEYSTORE_BASE64'), 'Signed release workflow is incomplete');

for (const file of [
  'www/app.js',
  'www/js/domain.js',
  'scripts/prepare-android.mjs',
  'scripts/configure-release-signing.mjs'
]) {
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr || `${file} syntax check failed`);
}

assert.equal(isValidJalaaliDate(1405, 8, 15), true, 'Jalali date validation failed');
const g = toGregorian(1405, 8, 15);
const j = toJalaali(g.gy, g.gm, g.gd);
assert.deepEqual(j, { jy: 1405, jm: 8, jd: 15 }, 'Jalali/Gregorian round-trip failed');
assert.equal(jalaaliMonthLength(1405, 8), 30, 'Jalali month length check failed');
const iso = jalaliDateToIso('۱۴۰۵/۰۸/۱۵');
assert.ok(iso, 'Persian digit Jalali date parsing failed');
assert.equal(gregorianIsoToJalali(iso), '1405/08/15', 'Jalali display conversion failed');
assert.equal(jalaliMonthKey(iso), '1405-08', 'Jalali month grouping failed');
assert.deepEqual(shiftJalaliMonth(1405, 1, -1), { jy: 1404, jm: 12 }, 'Jalali month shifting failed');

const calc = calculateInvoice({
  items: [{ qty: 2, price: 1000 }, { qty: 1, price: 500 }],
  discount: 100,
  taxPercent: 10,
  paidAmount: 1000
});
assert.equal(calc.subtotal, 2500, 'Invoice subtotal failed');
assert.equal(calc.total, 2640, 'Invoice tax/discount calculation failed');
assert.equal(calc.paid, 1000, 'Invoice paid amount failed');
assert.equal(calc.remaining, 1640, 'Unsettled balance calculation failed');
assert.equal(calc.paymentStatus, 'partial', 'Partial payment status failed');

console.log('Farnava 1.0.0 release candidate smoke tests passed.');
