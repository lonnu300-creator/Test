import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';

const window = new Window({ url: 'https://localhost/' });
window.document.write(fs.readFileSync('www/index.html', 'utf8'));
window.localStorage.setItem('farnava-free-v100', JSON.stringify({ settings: { soundEnabled: false }, invoices: [], expenses: [] }));
for (const key of ['window', 'document', 'navigator', 'localStorage', 'File', 'FileReader', 'Image', 'HTMLElement']) {
  Object.defineProperty(globalThis, key, { value: window[key], configurable: true });
}
globalThis.confirm = () => true;
await import(pathToFileURL(`${process.cwd()}/www/app.bundle.js`).href);

const click = selector => {
  const element = window.document.querySelector(selector);
  assert.ok(element, `Missing element ${selector}`);
  element.click();
};
click('#newInvoiceBtn');
assert.ok(!window.document.querySelector('#modalBackdrop').classList.contains('hidden'), 'Invoice modal did not open');
const form = window.document.querySelector('#invoiceForm');
assert.ok(form);
form.querySelector('[name="customerName"]').value = 'آزمایش';
form.querySelector('[name="date"]').value = '۱۴۰۵/۰۸/۱۵';
form.querySelector('[name="number"]').value = 'FN-00001';
form.querySelector('[name="paidAmount"]').value = '1000';
const row = form.querySelector('.item-row');
row.querySelector('[name="title"]').value = 'قلم آزمایشی';
row.querySelector('[name="qty"]').value = '2';
row.querySelector('[name="price"]').value = '1000';
click('#saveInvoiceBtn');
const data = JSON.parse(window.localStorage.getItem('farnava-free-v100'));
assert.equal(data.invoices.length, 1, 'Invoice did not persist');
assert.equal(data.invoices[0].customerName, 'آزمایش');
assert.ok(window.document.querySelector('[data-action="preview-invoice"]'));
click('[data-action="preview-invoice"]');
assert.ok(window.document.querySelector('#invoicePreviewPage'), 'Preview did not open');
click('#closePreviewBtn');
assert.ok(window.document.querySelector('#modalBackdrop').classList.contains('hidden'));
const realStorage = globalThis.localStorage;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: key => realStorage.getItem(key),
  setItem: () => { throw new Error('quota exceeded'); }
} });
const originalConsoleError = console.error;
let storageErrorLogged = false;
console.error = () => { storageErrorLogged = true; };
click('[data-action="delete-invoice"]');
console.error = originalConsoleError;
assert.ok(storageErrorLogged, 'Storage failure was not detected');
assert.ok(window.document.querySelector('[data-action="preview-invoice"]'), 'Failed persistence must restore the invoice');
assert.equal(JSON.parse(window.localStorage.getItem('farnava-free-v100')).invoices.length, 1);
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: realStorage });
click('#newExpenseBtn');
assert.ok(window.document.querySelector('#expenseForm'), 'Expense modal did not open');
console.log('Farnava UI flow passed: invoice save, preview, storage rollback, expense modal.');
window.happyDOM.abort();
