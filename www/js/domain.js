import { toJalaali, toGregorian, isValidJalaaliDate } from 'jalaali-js';

export function normalizeDigits(value) {
  return String(value ?? '')
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[٬،]/g, ',')
    .replace(/[٫]/g, '.');
}

export function numberValue(value) {
  const normalized = normalizeDigits(value).replace(/,/g, '').replace(/[^\d.-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

export function calculateInvoice(inv) {
  const items = Array.isArray(inv?.items) ? inv.items : [];
  const subtotal = items.reduce((sum, item) => sum + numberValue(item.qty) * numberValue(item.price), 0);
  const discount = Math.min(Math.max(0, numberValue(inv?.discount)), subtotal);
  const taxable = Math.max(0, subtotal - discount);
  const tax = taxable * Math.max(0, numberValue(inv?.taxPercent)) / 100;
  const total = Math.max(0, taxable + tax);
  const paid = Math.min(total, Math.max(0, numberValue(inv?.paidAmount ?? inv?.paid)));
  const remaining = Math.max(0, total - paid);
  const paymentStatus = remaining <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  return { subtotal, discount, tax, total, paid, remaining, paymentStatus };
}

export function jalaliDateToIso(value) {
  const cleaned = normalizeDigits(value).trim().replace(/[.-]/g, '/').replace(/\s/g, '');
  const parts = cleaned.split('/');
  if (parts.length !== 3 || parts.some(x => !/^\d+$/.test(x))) return null;
  const [jy, jm, jd] = parts.map(Number);
  if (!isValidJalaaliDate(jy, jm, jd)) return null;
  const g = toGregorian(jy, jm, jd);
  return `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
}

export function gregorianIsoToJalali(iso) {
  if (!iso) return '';
  try {
    const [gy, gm, gd] = String(iso).slice(0, 10).split('-').map(Number);
    if (!gy || !gm || !gd) return '';
    const j = toJalaali(gy, gm, gd);
    return `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

export function jalaliMonthKey(iso) {
  if (!iso) return '';
  const [gy, gm, gd] = String(iso).slice(0, 10).split('-').map(Number);
  if (!gy || !gm || !gd) return '';
  const j = toJalaali(gy, gm, gd);
  return `${j.jy}-${String(j.jm).padStart(2, '0')}`;
}

export function shiftJalaliMonth(jy, jm, offset) {
  const serial = jy * 12 + (jm - 1) + offset;
  const year = Math.floor(serial / 12);
  const month = serial - year * 12 + 1;
  return { jy: year, jm: month };
}
