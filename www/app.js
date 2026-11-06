import { toJalaali, jalaaliMonthLength } from 'jalaali-js';
import {
  calculateInvoice,
  jalaliDateToIso,
  gregorianIsoToJalali,
  jalaliMonthKey,
  shiftJalaliMonth
} from './js/domain.js';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

(() => {
  'use strict';

  const STORAGE_KEY = 'farnava-free-v100';
  const LEGACY_KEYS = ['farnava-premium-v030', 'farnava-premium-v020', 'farnava-free-v040'];
  const FONT_LABELS = {
    Vazirmatn: 'وزیرمتن',
    Abar: 'آبار',
    Lalezar: 'لاله‌زار',
    Anjoman: 'انجمن'
  };
  const TEMPLATE_LABELS = {
    classic: 'رسمی کلاسیک',
    modern: 'مدرن',
    minimal: 'مینیمال',
    luxury: 'لوکس'
  };
  const MONTHS_FA = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];

  const defaultState = () => ({
    settings: {
      businessName: 'نام کسب‌وکار شما',
      managerName: '',
      phone: '',
      businessCode: '',
      address: '',
      defaultFont: 'Vazirmatn',
      soundEnabled: true,
      animationsEnabled: true,
      logoData: '',
      stampData: ''
    },
    invoices: [],
    expenses: []
  });

  let state = loadState();
  let currentView = 'dashboard';
  let activeChartMonth = null;
  let previewContext = null;
  let audioContext = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const els = {
    statsGrid: $('#statsGrid'),
    recentInvoices: $('#recentInvoices'),
    recentExpenses: $('#recentExpenses'),
    invoiceList: $('#invoiceList'),
    expenseList: $('#expenseList'),
    invoiceSearch: $('#invoiceSearch'),
    invoiceFilter: $('#invoiceFilter'),
    statsChart: $('#statsChart'),
    chartDetails: $('#chartDetails'),
    unsettledPreview: $('#unsettledPreview'),
    modalBackdrop: $('#modalBackdrop'),
    modalTitle: $('#modalTitle'),
    modalEyebrow: $('#modalEyebrow'),
    modalBody: $('#modalBody'),
    modalFooter: $('#modalFooter'),
    closeModalBtn: $('#closeModalBtn'),
    quickAddBtn: $('#quickAddBtn'),
    toastRegion: $('#toastRegion'),
    settingsForm: $('#settingsForm'),
    appSettingsForm: $('#appSettingsForm'),
    backupFileInput: $('#backupFileInput'),
    logoFile: $('#logoFile'),
    stampFile: $('#stampFile')
  };

  function id() {
    return (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)) + Date.now().toString(36);
  }
  function defaultSettings() { return defaultState().settings; }
  function loadState() {
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        for (const key of LEGACY_KEYS) {
          raw = localStorage.getItem(key);
          if (raw) break;
        }
      }
      const saved = raw ? JSON.parse(raw) : null;
      if (!saved) return defaultState();
      const base = defaultState();
      return {
        ...base,
        ...saved,
        settings: {
          ...base.settings,
          ...(saved.settings || {}),
          defaultFont: safeFont(saved.settings?.defaultFont),
          logoData: safeImageData(saved.settings?.logoData),
          stampData: safeImageData(saved.settings?.stampData)
        },
        invoices: Array.isArray(saved.invoices) ? saved.invoices.filter(Boolean).map(normalizeInvoice) : [],
        expenses: Array.isArray(saved.expenses) ? saved.expenses.filter(Boolean).map(normalizeExpense) : []
      };
    } catch {
      return defaultState();
    }
  }
  function safeTemplate(value) {
    return ['classic', 'modern', 'minimal', 'luxury'].includes(value) ? value : 'classic';
  }
  function safeFont(value) {
    return ['Vazirmatn', 'Abar', 'Lalezar', 'Anjoman'].includes(value) ? value : 'Vazirmatn';
  }
  function safePaperSize(value) {
    return ['A4', 'A5', '80mm'].includes(value) ? value : 'A4';
  }
  function safeIsoDate(value) {
    const text = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return isoToday();
    const date = new Date(`${text}T12:00:00`);
    if (Number.isNaN(date.getTime())) return isoToday();
    const roundTrip = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return roundTrip === text ? text : isoToday();
  }
  function safeImageData(value) {
    return typeof value === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value) ? value : '';
  }
  function normalizeInvoice(inv) {
    return {
      ...inv,
      date: safeIsoDate(inv.date),
      dueDate: inv.dueDate ? safeIsoDate(inv.dueDate) : '',
      type: inv.type === 'purchase' ? 'purchase' : 'sale',
      paidAmount: Number(inv.paidAmount ?? inv.paid ?? 0) || 0,
      isClosed: Boolean(inv.isClosed),
      paperSize: safePaperSize(inv.paperSize),
      template: safeTemplate(inv.template),
      fontFamily: safeFont(inv.fontFamily),
      items: Array.isArray(inv.items) ? inv.items.filter(Boolean).map(item => ({
        ...item,
        title: String(item.title || '').slice(0, 300),
        qty: numberValue(item.qty),
        price: numberValue(item.price)
      })) : []
    };
  }
  function normalizeExpense(exp) {
    return {
      ...exp,
      id: String(exp.id || id()),
      title: String(exp.title || '').slice(0, 200),
      amount: Math.max(0, numberValue(exp.amount)),
      category: String(exp.category || 'عمومی').slice(0, 100),
      date: safeIsoDate(exp.date),
      notes: String(exp.notes || '').slice(0, 2000)
    };
  }
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      toast('فضای ذخیره‌سازی پر شده است. حجم عکس لوگو یا مهر را کمتر کن.', 'error');
      console.error(error);
      return false;
    }
  }

  function normalizeDigits(value) {
    return String(value ?? '')
      .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
      .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/[٬،]/g, ',')
      .replace(/[٫]/g, '.');
  }
  function numberValue(value) {
    const normalized = normalizeDigits(value).replace(/,/g, '').replace(/[^\d.-]/g, '');
    const number = Number(normalized);
    return Number.isFinite(number) ? number : 0;
  }
  function money(value) {
    return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0)) + ' تومان';
  }
  function shortMoney(value) {
    const v = Math.round(Number(value) || 0);
    if (Math.abs(v) >= 1_000_000_000) return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(v / 1_000_000_000) + ' میلیارد';
    if (Math.abs(v) >= 1_000_000) return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(v / 1_000_000) + ' میلیون';
    if (Math.abs(v) >= 1_000) return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(v / 1_000) + ' هزار';
    return money(v);
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }
  function isoToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function persianDigits(value) {
    return String(value ?? '').replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
  }
  function isoToJalali(iso) {
    return persianDigits(gregorianIsoToJalali(iso));
  }
  function parseJalali(value) {
    return jalaliDateToIso(value);
  }
  function jalaliToday() { return isoToJalali(isoToday()); }
  function formatDate(iso) {
    if (!iso) return '—';
    return isoToJalali(iso);
  }

  function beep(kind = 'ok') {
    if (!state.settings.soundEnabled) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = kind === 'error' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(kind === 'error' ? 220 : 620, audioContext.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(kind === 'error' ? 145 : 820, audioContext.currentTime + 0.11);
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.018, audioContext.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.15);
      oscillator.connect(gain); gain.connect(audioContext.destination);
      oscillator.start(); oscillator.stop(audioContext.currentTime + 0.16);
    } catch (error) { console.debug('Sound unavailable', error); }
  }
  function toast(message, type = 'info') {
    const node = document.createElement('div');
    node.className = `toast${type === 'error' ? ' error' : ''}`;
    node.textContent = message;
    els.toastRegion.appendChild(node);
    window.setTimeout(() => node.remove(), 3200);
    if (type === 'error') beep('error');
  }
  function openModal({ title, eyebrow = 'فرنوا', body = '', footer = '' }) {
    els.modalTitle.textContent = title;
    els.modalEyebrow.textContent = eyebrow;
    els.modalBody.innerHTML = body;
    els.modalFooter.innerHTML = footer;
    els.modalBackdrop.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    els.modalSheet.scrollTop = 0;
  }
  function closeModal() {
    els.modalBackdrop.classList.add('hidden');
    els.modalBody.innerHTML = '';
    els.modalFooter.innerHTML = '';
    document.body.style.overflow = '';
    previewContext = null;
  }
  function switchView(view) {
    currentView = view;
    $$('.view').forEach(node => node.classList.toggle('active', node.dataset.view === view));
    $$('.nav-btn').forEach(node => node.classList.toggle('active', node.dataset.target === view));
    if (view === 'dashboard') drawChart();
  }

  function nextInvoiceNumber() {
    const max = state.invoices.reduce((highest, inv) => {
      const match = String(inv.number || '').match(/(\d+)$/);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    return `FN-${String(max + 1).padStart(5, '0')}`;
  }

  function render() {
    renderDashboard();
    renderInvoices();
    renderExpenses();
    renderSettings();
    renderAppSettings();
  }
  function statCard(label, value, hint, extra = '') {
    return `<article class="stat-card ${extra}"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><div class="hint">${escapeHtml(hint)}</div></article>`;
  }
  function renderDashboard() {
    const sales = state.invoices.filter(x => x.type === 'sale').reduce((s, x) => s + calculateInvoice(x).total, 0);
    const received = state.invoices.filter(x => x.type === 'sale').reduce((s, x) => s + calculateInvoice(x).paid, 0);
    const receivable = state.invoices.filter(x => x.type === 'sale').reduce((s, x) => s + calculateInvoice(x).remaining, 0);
    const payable = state.invoices.filter(x => x.type === 'purchase').reduce((s, x) => s + calculateInvoice(x).remaining, 0);
    const expenses = state.expenses.reduce((s, x) => s + numberValue(x.amount), 0);
    els.statsGrid.innerHTML = [
      statCard('فروش کل', money(sales), `${state.invoices.filter(x => x.type === 'sale').length} فاکتور فروش`),
      statCard('دریافتی از مشتریان', money(received), 'مبالغ ثبت‌شده به‌عنوان پرداخت', 'emphasis'),
      statCard('مانده طلب از مشتریان', money(receivable), 'فاکتورهای فروش تسویه‌نشده', receivable ? 'warning' : 'emphasis'),
      statCard('مانده بدهی خرید', money(payable), 'فاکتورهای خرید تسویه‌نشده'),
      statCard('هزینه‌های ثبت‌شده', money(expenses), `${state.expenses.length} مورد هزینه`)
    ].join('');

    const recentInv = [...state.invoices].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 4);
    els.recentInvoices.innerHTML = recentInv.length ? recentInv.map(invoiceCardCompact).join('') : empty('هنوز فاکتوری ثبت نشده است.');
    const recentExp = [...state.expenses].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 4);
    els.recentExpenses.innerHTML = recentExp.length ? recentExp.map(expenseCard).join('') : empty('هنوز هزینه‌ای ثبت نشده است.');

    const unsettled = state.invoices
      .map(inv => ({ inv, calc: calculateInvoice(inv) }))
      .filter(x => x.calc.remaining > 0)
      .sort((a, b) => String(a.inv.date).localeCompare(String(b.inv.date)))
      .slice(0, 4);
    els.unsettledPreview.innerHTML = unsettled.length ? unsettled.map(({ inv, calc }) => `
      <div class="invoice-card">
        <div class="invoice-head">
          <div><div class="invoice-title">${escapeHtml(inv.number)} · ${escapeHtml(inv.customerName || 'بدون نام')}</div><div class="invoice-meta">${formatDate(inv.date)} · ${inv.type === 'purchase' ? 'خرید' : 'فروش'}</div></div>
          <span class="badge ${calc.paymentStatus}">${paymentLabel(calc.paymentStatus)}</span>
        </div>
        <div class="balance-row"><span>مانده قابل تسویه</span><strong class="remaining">${money(calc.remaining)}</strong></div>
      </div>`).join('') : empty('همه فاکتورها تسویه شده‌اند. عالیه!');
    drawChart();
  }
  function empty(text) { return `<div class="empty-state">${escapeHtml(text)}</div>`; }
  function paymentLabel(status) {
    return status === 'paid' ? 'تسویه کامل' : status === 'partial' ? 'پرداخت بخشی' : 'تسویه‌نشده';
  }
  function invoiceCardCompact(inv) {
    const calc = calculateInvoice(inv);
    return `<article class="invoice-card">
      <div class="invoice-head">
        <div><div class="invoice-title">${escapeHtml(inv.number)} · ${escapeHtml(inv.customerName || 'بدون نام')}</div><div class="invoice-meta">${formatDate(inv.date)} · ${inv.type === 'purchase' ? 'خرید' : 'فروش'}</div></div>
        <span class="badge ${calc.paymentStatus}">${paymentLabel(calc.paymentStatus)}</span>
      </div>
      <div class="invoice-total">${money(calc.total)}</div>
      ${calc.remaining > 0 ? `<div class="balance-row"><span>مانده</span><strong class="remaining">${money(calc.remaining)}</strong></div>` : ''}
    </article>`;
  }
  function invoiceCard(inv) {
    const calc = calculateInvoice(inv);
    return `<article class="invoice-card">
      <div class="invoice-head">
        <div>
          <div class="invoice-title">${escapeHtml(inv.number)} · ${escapeHtml(inv.customerName || 'بدون نام')}</div>
          <div class="invoice-meta"><span>${formatDate(inv.date)}${inv.dueDate ? ` · سررسید ${formatDate(inv.dueDate)}` : ''}</span><span>${(inv.items || []).length} قلم · ${escapeHtml(inv.paperSize || 'A4')}</span></div>
        </div>
        <div style="display:grid;gap:6px;justify-items:end">
          <span class="badge ${inv.type}">${inv.type === 'purchase' ? 'خرید' : 'فروش'}</span>
          <span class="badge ${inv.isClosed ? 'closed' : 'open'}">${inv.isClosed ? 'بسته' : 'باز'}</span>
        </div>
      </div>
      <div class="balance-row"><span>مبلغ کل</span><strong>${money(calc.total)}</strong></div>
      <div class="balance-row"><span>پرداخت‌شده</span><strong>${money(calc.paid)}</strong></div>
      <div class="balance-row"><span>مانده تسویه</span><strong class="${calc.remaining ? 'remaining' : ''}">${money(calc.remaining)}</strong></div>
      <div class="invoice-meta"><span>قالب: ${TEMPLATE_LABELS[inv.template || 'classic']} · فونت: ${FONT_LABELS[inv.fontFamily || 'Vazirmatn']}</span></div>
      <div class="stack-actions">
        <button type="button" class="secondary-btn" data-action="edit-invoice" data-id="${escapeHtml(inv.id)}">ویرایش</button>
        <button type="button" class="secondary-btn" data-action="preview-invoice" data-id="${escapeHtml(inv.id)}">پیش‌نمایش</button>
        <button type="button" class="primary-btn" data-action="share-invoice" data-id="${escapeHtml(inv.id)}">اشتراک‌گذاری</button>
        <button type="button" class="secondary-btn" data-action="${inv.isClosed ? 'reopen-invoice' : 'close-invoice'}" data-id="${escapeHtml(inv.id)}">${inv.isClosed ? 'بازگشایی' : 'بستن فاکتور'}</button>
        <button type="button" class="danger-btn" data-action="delete-invoice" data-id="${escapeHtml(inv.id)}">حذف</button>
      </div>
    </article>`;
  }
  function renderInvoices() {
    if (!els.invoiceList) return;
    const query = (els.invoiceSearch.value || '').trim().toLocaleLowerCase('fa-IR');
    const filter = els.invoiceFilter.value;
    let list = [...state.invoices].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (query) list = list.filter(inv => [inv.number, inv.customerName, inv.customerPhone, ...(inv.items || []).map(x => x.title)].join(' ').toLocaleLowerCase('fa-IR').includes(query));
    if (filter === 'unsettled') list = list.filter(inv => calculateInvoice(inv).remaining > 0);
    if (filter === 'open') list = list.filter(inv => !inv.isClosed);
    if (filter === 'closed') list = list.filter(inv => inv.isClosed);
    els.invoiceList.innerHTML = list.length ? list.map(invoiceCard).join('') : empty('فاکتوری با این شرایط پیدا نشد.');
  }
  function expenseCard(exp) {
    return `<article class="expense-card">
      <div class="expense-head"><div><div class="expense-title">${escapeHtml(exp.title)}</div><div class="expense-meta">${formatDate(exp.date)} · ${escapeHtml(exp.category || 'عمومی')}</div></div><div class="expense-amount">${money(exp.amount)}</div></div>
      <div class="stack-actions">
        <button type="button" class="secondary-btn" data-action="edit-expense" data-id="${escapeHtml(exp.id)}">ویرایش</button>
        <button type="button" class="danger-btn" data-action="delete-expense" data-id="${escapeHtml(exp.id)}">حذف</button>
      </div>
    </article>`;
  }
  function renderExpenses() {
    const list = [...state.expenses].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    els.expenseList.innerHTML = list.length ? list.map(expenseCard).join('') : empty('هزینه‌ای ثبت نشده است.');
  }

  function monthlyData() {
    const now = new Date();
    const current = toJalaali(now.getFullYear(), now.getMonth() + 1, now.getDate());
    const rows = [];
    for (let offset = -5; offset <= 0; offset++) {
      const { jy, jm } = shiftJalaliMonth(current.jy, current.jm, offset);
      const key = `${jy}-${String(jm).padStart(2, '0')}`;
      const invoices = state.invoices.filter(inv => jalaliMonthKey(inv.date) === key);
      const salesInvoices = invoices.filter(inv => inv.type === 'sale');
      const purchaseInvoices = invoices.filter(inv => inv.type === 'purchase');
      const sales = salesInvoices.reduce((sum, inv) => sum + calculateInvoice(inv).total, 0);
      const purchases = purchaseInvoices.reduce((sum, inv) => sum + calculateInvoice(inv).total, 0);
      const received = salesInvoices.reduce((sum, inv) => sum + calculateInvoice(inv).paid, 0);
      const outstanding = salesInvoices.reduce((sum, inv) => sum + calculateInvoice(inv).remaining, 0);
      const expenses = state.expenses
        .filter(exp => jalaliMonthKey(exp.date) === key)
        .reduce((sum, exp) => sum + numberValue(exp.amount), 0);
      rows.push({
        key,
        label: `${MONTHS_FA[jm - 1]} ${new Intl.NumberFormat('fa-IR').format(jy)}`,
        sales, purchases, received, outstanding, expenses,
        invoiceCount: invoices.length,
        monthDays: jalaaliMonthLength(jy, jm)
      });
    }
    return rows;
  }
  function drawChart() {
    if (!els.statsChart) return;
    const rows = monthlyData();
    const max = Math.max(1, ...rows.flatMap(x => [x.sales, x.expenses]));
    els.statsChart.innerHTML = `
      <div class="chart-legend"><span><i class="legend-dot" style="background:#18a88e"></i>فروش</span><span><i class="legend-dot" style="background:#315d85"></i>هزینه</span></div>
      ${rows.map(row => `
        <button type="button" class="chart-row ${activeChartMonth === row.key ? 'selected' : ''}" data-month="${row.key}" aria-label="جزئیات ${row.label}">
          <span class="chart-month">${row.label.split(' ')[0]}</span>
          <span class="chart-bars">
            <span class="chart-bar-track"><i class="chart-bar sales" style="display:block;width:${Math.max(row.sales ? 1 : 0, row.sales / max * 100)}%"></i></span>
            <span class="chart-bar-track"><i class="chart-bar expenses" style="display:block;width:${Math.max(row.expenses ? 1 : 0, row.expenses / max * 100)}%"></i></span>
          </span>
          <span class="chart-values"><b>${escapeHtml(shortMoney(row.sales))}</b><b>${escapeHtml(shortMoney(row.expenses))}</b></span>
        </button>`).join('')}
    `;
    const selected = rows.find(x => x.key === activeChartMonth) || rows[rows.length - 1];
    activeChartMonth = selected?.key || null;
    if (selected) {
      els.chartDetails.innerHTML = `
        <div class="chart-detail-title">${selected.label} · گزارش ماهانه</div>
        <div class="chart-detail-grid">
          <div class="chart-detail-cell"><span>فروش ثبت‌شده</span><strong>${money(selected.sales)}</strong></div>
          <div class="chart-detail-cell"><span>هزینه‌ها</span><strong>${money(selected.expenses)}</strong></div>
          <div class="chart-detail-cell"><span>دریافتی</span><strong>${money(selected.received)}</strong></div>
          <div class="chart-detail-cell"><span>مانده طلب</span><strong>${money(selected.outstanding)}</strong></div>
          <div class="chart-detail-cell"><span>خرید</span><strong>${money(selected.purchases)}</strong></div>
          <div class="chart-detail-cell"><span>تعداد فاکتور</span><strong>${new Intl.NumberFormat('fa-IR').format(selected.invoiceCount)}</strong></div>
        </div>`;
    }
  }

  function setPreviewImage(element, data, emptyText) {
    if (!element) return;
    element.innerHTML = data ? `<img src="${data}" alt="تصویر انتخاب‌شده">` : `<span>${escapeHtml(emptyText)}</span>`;
  }
  function renderSettings() {
    const form = els.settingsForm;
    for (const [key, value] of Object.entries(state.settings)) {
      if (!form.elements.namedItem(key)) continue;
      const control = form.elements.namedItem(key);
      if (control.type !== 'file') control.value = value ?? '';
    }
    setPreviewImage($('#logoPreview'), state.settings.logoData, 'هنوز لوگویی انتخاب نشده');
    setPreviewImage($('#stampPreview'), state.settings.stampData, 'هنوز مهری انتخاب نشده');
  }
  function renderAppSettings() {
    const form = els.appSettingsForm;
    form.elements.soundEnabled.checked = !!state.settings.soundEnabled;
    form.elements.animationsEnabled.checked = !!state.settings.animationsEnabled;
    document.body.classList.toggle('no-motion', !state.settings.animationsEnabled);
  }

  function jalaliDateField(name, label, value, required = false) {
    const initialValue = value !== undefined && value !== null ? value : (required ? jalaliToday() : '');
    return `<label class="field"><span>${label}</span><input class="text-input jalali-date" name="${name}" type="text" inputmode="numeric" autocomplete="off" placeholder="۱۴۰۵/۰۸/۱۵" value="${escapeHtml(initialValue)}" ${required ? 'required' : ''}><small class="field-hint">تاریخ شمسی؛ نمونه ۱۴۰۵/۰۸/۱۵</small></label>`;
  }
  function invoiceFormHTML(existing = null) {
    const inv = existing || {
      id: '', number: nextInvoiceNumber(), type: 'sale', date: isoToday(), dueDate: '',
      customerName: '', customerPhone: '', discount: 0, taxPercent: 0, paidAmount: 0,
      notes: '', paperSize: 'A4', template: 'classic', fontFamily: state.settings.defaultFont || 'Vazirmatn',
      isClosed: false, items: [{ id: id(), title: '', qty: 1, price: 0 }]
    };
    const calc = calculateInvoice(inv);
    return `
      <form id="invoiceForm" class="form-grid" novalidate>
        <div class="inline-grid-2">
          <label class="field"><span>شماره فاکتور</span><input class="text-input" name="number" value="${escapeHtml(inv.number)}" required></label>
          ${jalaliDateField('date', 'تاریخ فاکتور', isoToJalali(inv.date), true)}
        </div>
        <div class="inline-grid-2">
          <label class="field"><span>نوع فاکتور</span><select class="text-input" name="type"><option value="sale" ${inv.type === 'sale' ? 'selected' : ''}>فروش</option><option value="purchase" ${inv.type === 'purchase' ? 'selected' : ''}>خرید</option></select></label>
          <label class="field"><span>اندازه کاغذ</span><select class="text-input" name="paperSize">${['A4','A5','80mm'].map(s => `<option value="${s}" ${inv.paperSize === s ? 'selected' : ''}>${s === '80mm' ? 'رسید ۸۰ میلی‌متر' : s}</option>`).join('')}</select></label>
        </div>
        <div class="inline-grid-2">
          <label class="field"><span>نام مشتری / تأمین‌کننده</span><input class="text-input" name="customerName" value="${escapeHtml(inv.customerName || '')}" required placeholder="نام طرف حساب"></label>
          <label class="field"><span>شماره تماس</span><input class="text-input" name="customerPhone" inputmode="tel" value="${escapeHtml(inv.customerPhone || '')}" placeholder="شماره تماس"></label>
        </div>
        <div class="inline-grid-2">
          ${jalaliDateField('dueDate', 'سررسید پرداخت (اختیاری)', inv.dueDate ? isoToJalali(inv.dueDate) : '', false)}
          <label class="field"><span>مبلغ پرداخت‌شده (تومان)</span><input class="text-input" name="paidAmount" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(inv.paidAmount ?? 0)}"><small class="field-hint">برای محاسبه مانده تسویه وارد کن.</small></label>
        </div>
        <section class="panel" style="padding:12px">
          <div class="panel-head"><div><h3>اقلام فاکتور</h3><p>تعداد و قیمت واحد را وارد کن.</p></div><button type="button" class="primary-btn" id="addItemBtn">＋ افزودن قلم</button></div>
          <div id="invoiceItems" class="form-grid">${(inv.items || []).map(itemRowHTML).join('')}</div>
        </section>
        <div class="inline-grid-2">
          <label class="field"><span>تخفیف (تومان)</span><input class="text-input" name="discount" type="number" min="0" value="${escapeHtml(inv.discount ?? 0)}"></label>
          <label class="field"><span>مالیات (%)</span><input class="text-input" name="taxPercent" type="number" min="0" max="100" step="0.01" value="${escapeHtml(inv.taxPercent ?? 0)}"></label>
        </div>
        <label class="field"><span>یادداشت فاکتور</span><textarea class="text-input" name="notes" rows="3">${escapeHtml(inv.notes || '')}</textarea></label>
        <div class="form-summary" id="invoiceLiveSummary">
          <div><span>جمع اقلام</span><strong>${money(calc.subtotal)}</strong></div>
          <div><span>مبلغ نهایی</span><strong>${money(calc.total)}</strong></div>
          <div><span>پرداخت‌شده</span><strong>${money(calc.paid)}</strong></div>
          <div><span>مانده تسویه</span><strong class="remaining">${money(calc.remaining)}</strong></div>
        </div>
        <div class="print-note">پس از ذخیره، پیش‌نمایش فاکتور را باز کن تا چهار قالب و فونت را ببینی و فایل PDF، Word، PNG یا JPG را مستقیم به اشتراک بگذاری.</div>
      </form>`;
  }
  function itemRowHTML(item, index) {
    const rowId = item.id || id();
    return `<div class="item-row" data-item-id="${escapeHtml(rowId)}">
      <div class="item-row-top"><strong>قلم فاکتور</strong><button type="button" class="del-btn" data-action="remove-item" aria-label="حذف قلم">×</button></div>
      <label class="field"><span>شرح کالا یا خدمت</span><input class="text-input" name="title" value="${escapeHtml(item.title || '')}" placeholder="مثلاً طراحی و اجرا"></label>
      <div class="inline-grid-2">
        <label class="field"><span>تعداد</span><input class="text-input" name="qty" type="number" min="0.01" step="0.01" inputmode="decimal" value="${escapeHtml(item.qty ?? 1)}"></label>
        <label class="field"><span>قیمت واحد (تومان)</span><input class="text-input" name="price" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(item.price ?? 0)}"></label>
      </div>
    </div>`;
  }
  function formValue(root, name) {
    const control = root?.elements?.namedItem
      ? root.elements.namedItem(name)
      : root?.querySelector?.(`[name="${name}"]`);
    return control ? control.value : '';
  }
  function collectInvoiceForm(existingId, forceClosed = false) {
    const form = $('#invoiceForm');
    if (!form) return null;
    const date = parseJalali(formValue(form, 'date'));
    const dueRaw = formValue(form, 'dueDate').trim();
    const dueDate = dueRaw ? parseJalali(dueRaw) : '';
    if (!date) { toast('تاریخ فاکتور شمسی معتبر نیست؛ نمونه ۱۴۰۵/۰۸/۱۵', 'error'); return null; }
    if (dueRaw && !dueDate) { toast('تاریخ سررسید شمسی معتبر نیست.', 'error'); return null; }
    const items = $$('#invoiceItems .item-row').map(row => ({
      id: row.dataset.itemId || id(),
      title: formValue(row, 'title').trim(),
      qty: numberValue(formValue(row, 'qty')),
      price: numberValue(formValue(row, 'price'))
    })).filter(item => item.title && item.qty > 0);
    if (!formValue(form, 'customerName').trim()) { toast('نام مشتری یا تأمین‌کننده را وارد کن.', 'error'); return null; }
    if (!items.length) { toast('حداقل یک قلم معتبر با شرح و تعداد وارد کن.', 'error'); return null; }
    const draft = {
      id: existingId || id(),
      number: formValue(form, 'number').trim() || nextInvoiceNumber(),
      type: formValue(form, 'type'),
      date,
      dueDate,
      customerName: formValue(form, 'customerName').trim(),
      customerPhone: formValue(form, 'customerPhone').trim(),
      discount: Math.max(0, numberValue(formValue(form, 'discount'))),
      taxPercent: Math.min(100, Math.max(0, numberValue(formValue(form, 'taxPercent')))),
      paidAmount: Math.max(0, numberValue(formValue(form, 'paidAmount'))),
      notes: formValue(form, 'notes').trim(),
      paperSize: formValue(form, 'paperSize') || 'A4',
      template: 'classic',
      fontFamily: state.settings.defaultFont || 'Vazirmatn',
      isClosed: forceClosed,
      items
    };
    const previous = state.invoices.find(x => x.id === draft.id);
    if (previous) {
      draft.template = previous.template || draft.template;
      draft.fontFamily = previous.fontFamily || draft.fontFamily;
      if (!forceClosed) draft.isClosed = previous.isClosed;
    }
    return draft;
  }
  function saveInvoiceFromForm(existingId, closeAfter = false) {
    const draft = collectInvoiceForm(existingId, closeAfter);
    if (!draft) return;
    const index = state.invoices.findIndex(x => x.id === draft.id);
    if (index >= 0) state.invoices[index] = draft;
    else state.invoices.unshift(draft);
    if (!saveState()) return;
    render();
    closeModal();
    toast(closeAfter ? 'فاکتور ذخیره و بسته شد.' : 'فاکتور ذخیره شد.');
    beep();
    switchView('invoices');
  }
  function reindexItems() {
    $$('#invoiceItems .item-row').forEach((row, index) => {
      const label = row.querySelector('.item-row-top strong');
      if (label) label.textContent = `قلم ${new Intl.NumberFormat('fa-IR').format(index + 1)}`;
    });
  }
  function updateLiveInvoiceSummary() {
    const form = $('#invoiceForm');
    const summary = $('#invoiceLiveSummary');
    if (!form || !summary) return;
    const items = $$('#invoiceItems .item-row').map(row => ({
      qty: numberValue(formValue(row, 'qty')),
      price: numberValue(formValue(row, 'price'))
    }));
    const subtotal = items.reduce((s, x) => s + x.qty * x.price, 0);
    const discount = Math.min(subtotal, numberValue(formValue(form, 'discount')));
    const tax = Math.max(0, subtotal - discount) * numberValue(formValue(form, 'taxPercent')) / 100;
    const total = Math.max(0, subtotal - discount + tax);
    const paid = Math.min(total, numberValue(formValue(form, 'paidAmount')));
    summary.innerHTML = `<div><span>جمع اقلام</span><strong>${money(subtotal)}</strong></div><div><span>مبلغ نهایی</span><strong>${money(total)}</strong></div><div><span>پرداخت‌شده</span><strong>${money(paid)}</strong></div><div><span>مانده تسویه</span><strong class="remaining">${money(Math.max(0, total - paid))}</strong></div>`;
  }
  function openInvoiceForm(existingId = null) {
    const invoice = existingId ? state.invoices.find(x => x.id === existingId) : null;
    openModal({
      title: existingId ? 'ویرایش فاکتور' : 'ثبت فاکتور جدید',
      eyebrow: 'اطلاعات فاکتور',
      body: invoiceFormHTML(invoice),
      footer: `<button type="button" class="secondary-btn" id="cancelInvoiceBtn">انصراف</button><button type="button" class="secondary-btn" id="closeInvoiceBtn">بستن فاکتور</button><button type="button" class="primary-btn" id="saveInvoiceBtn">ذخیره فاکتور</button>`
    });
    $('#addItemBtn').addEventListener('click', () => {
      $('#invoiceItems').insertAdjacentHTML('beforeend', itemRowHTML({ id: id(), title: '', qty: 1, price: 0 }));
      reindexItems();
      updateLiveInvoiceSummary();
      beep();
    });
    $('#invoiceItems').addEventListener('click', event => {
      const button = event.target.closest('[data-action="remove-item"]');
      if (!button) return;
      const rows = $$('#invoiceItems .item-row');
      if (rows.length <= 1) return toast('حداقل یک قلم باید باقی بماند.', 'error');
      button.closest('.item-row').remove();
      reindexItems(); updateLiveInvoiceSummary(); beep();
    });
    $('#invoiceForm').addEventListener('input', updateLiveInvoiceSummary);
    $('#cancelInvoiceBtn').addEventListener('click', closeModal);
    $('#saveInvoiceBtn').addEventListener('click', () => saveInvoiceFromForm(existingId, false));
    $('#closeInvoiceBtn').addEventListener('click', () => {
      if (confirm('فاکتور ذخیره و بسته شود؟ بعداً می‌توانی آن را بازگشایی کنی.')) saveInvoiceFromForm(existingId, true);
    });
  }

  function expenseFormHTML(exp = null) {
    const item = exp || { title: '', amount: 0, category: 'عمومی', date: isoToday(), notes: '' };
    return `<form id="expenseForm" class="form-grid">
      <label class="field"><span>عنوان هزینه</span><input class="text-input" name="title" value="${escapeHtml(item.title)}" placeholder="مثلاً اجاره یا حمل‌ونقل" required></label>
      <div class="inline-grid-2">
        <label class="field"><span>مبلغ (تومان)</span><input class="text-input" type="number" name="amount" min="0" value="${escapeHtml(item.amount)}"></label>
        <label class="field"><span>دسته‌بندی</span><input class="text-input" name="category" value="${escapeHtml(item.category || 'عمومی')}"></label>
      </div>
      ${jalaliDateField('date', 'تاریخ هزینه', isoToJalali(item.date), true)}
      <label class="field"><span>یادداشت</span><textarea class="text-input" name="notes" rows="3">${escapeHtml(item.notes || '')}</textarea></label>
    </form>`;
  }
  function openExpenseForm(existingId = null) {
    const existing = existingId ? state.expenses.find(x => x.id === existingId) : null;
    openModal({
      title: existingId ? 'ویرایش هزینه' : 'ثبت هزینه جدید',
      eyebrow: 'هزینه‌ها',
      body: expenseFormHTML(existing),
      footer: '<button type="button" class="secondary-btn" id="cancelExpenseBtn">انصراف</button><button type="button" class="primary-btn" id="saveExpenseBtn">ذخیره هزینه</button>'
    });
    $('#cancelExpenseBtn').addEventListener('click', closeModal);
    $('#saveExpenseBtn').addEventListener('click', () => {
      const form = $('#expenseForm');
      const date = parseJalali(formValue(form, 'date'));
      const title = formValue(form, 'title').trim();
      if (!date) return toast('تاریخ شمسی هزینه معتبر نیست.', 'error');
      if (!title) return toast('عنوان هزینه را وارد کن.', 'error');
      const data = {
        id: existingId || id(), title,
        amount: Math.max(0, numberValue(formValue(form, 'amount'))),
        category: formValue(form, 'category').trim() || 'عمومی',
        date, notes: formValue(form, 'notes').trim()
      };
      const index = state.expenses.findIndex(x => x.id === data.id);
      if (index >= 0) state.expenses[index] = data; else state.expenses.unshift(data);
      if (!saveState()) return;
      render(); closeModal(); switchView('expenses'); toast('هزینه ذخیره شد.'); beep();
    });
  }

  function invoiceDocumentHTML(inv, options = {}) {
    const calc = calculateInvoice(inv);
    const template = safeTemplate(options.template || inv.template);
    const font = safeFont(options.font || inv.fontFamily);
    const size = safePaperSize(options.size || inv.paperSize);
    const settings = state.settings;
    const logo = settings.logoData ? `<img class="doc-logo" src="${escapeHtml(settings.logoData)}" alt="لوگو">` : '';
    const stamp = settings.stampData ? `<img class="doc-stamp" src="${escapeHtml(settings.stampData)}" alt="مهر">` : '';
    const itemRows = (inv.items || []).map((item, index) => `
      <tr><td>${new Intl.NumberFormat('fa-IR').format(index + 1)}</td><td>${escapeHtml(item.title)}</td><td>${new Intl.NumberFormat('fa-IR').format(numberValue(item.qty))}</td><td>${money(item.price)}</td><td>${money(numberValue(item.qty) * numberValue(item.price))}</td></tr>
    `).join('');
    const pageStyle = size === 'A5' ? 'doc-size-a5' : size === '80mm' ? 'doc-size-receipt' : 'doc-size-a4';
    return `<article id="invoicePreviewPage" class="invoice-preview-page ${pageStyle} template-${template} font-${font.toLowerCase()}" style="font-family:'${font}',Tahoma,sans-serif">
      <header class="doc-head">
        <div class="doc-brand">${logo}<div><div class="doc-title">فاکتور ${inv.type === 'purchase' ? 'خرید' : 'فروش'}</div><div class="doc-sub">${escapeHtml(settings.businessName || '')}${settings.managerName ? `\nمدیر: ${escapeHtml(settings.managerName)}` : ''}${settings.phone ? `\nتلفن: ${escapeHtml(settings.phone)}` : ''}${settings.businessCode ? `\nشناسه: ${escapeHtml(settings.businessCode)}` : ''}${settings.address ? `\n${escapeHtml(settings.address)}` : ''}</div></div></div>
        <div class="doc-meta"><div><b>شماره:</b> ${escapeHtml(inv.number)}</div><div><b>تاریخ:</b> ${formatDate(inv.date)}</div><div><b>سررسید:</b> ${inv.dueDate ? formatDate(inv.dueDate) : '—'}</div><div><b>وضعیت:</b> ${paymentLabel(calc.paymentStatus)}</div></div>
      </header>
      <section class="doc-customer"><div><b>طرف حساب:</b> ${escapeHtml(inv.customerName || '—')}</div><div><b>تماس:</b> ${escapeHtml(inv.customerPhone || '—')}</div></section>
      <table><thead><tr><th>ردیف</th><th>شرح کالا / خدمت</th><th>تعداد</th><th>قیمت واحد</th><th>جمع</th></tr></thead><tbody>${itemRows}</tbody></table>
      <section class="doc-totals">
        <div class="doc-total-row"><span>جمع اقلام</span><b>${money(calc.subtotal)}</b></div>
        <div class="doc-total-row"><span>تخفیف</span><b>${money(calc.discount)}</b></div>
        <div class="doc-total-row"><span>مالیات</span><b>${money(calc.tax)}</b></div>
        <div class="doc-total-row final"><span>مبلغ نهایی</span><b>${money(calc.total)}</b></div>
      </section>
      <section class="doc-payment"><div><b>پرداخت‌شده:</b><br>${money(calc.paid)}</div><div><b>مانده قابل تسویه:</b><br>${money(calc.remaining)}</div></section>
      ${inv.notes ? `<div class="doc-notes"><b>توضیحات:</b> ${escapeHtml(inv.notes)}</div>` : ''}
      <footer class="doc-footer"><div class="doc-sign">با سپاس از اعتماد شما<br>${escapeHtml(settings.businessName || 'فرنوا')}</div>${stamp}</footer>
    </article>`;
  }

  function openInvoicePreview(invoiceId) {
    const inv = state.invoices.find(x => x.id === invoiceId);
    if (!inv) return;
    previewContext = {
      invoiceId,
      template: inv.template || 'classic',
      font: inv.fontFamily || state.settings.defaultFont || 'Vazirmatn',
      size: inv.paperSize || 'A4'
    };
    openModal({
      title: `پیش‌نمایش ${inv.number}`,
      eyebrow: 'قالب و فونت فاکتور',
      body: `
        <div class="invoice-preview-controls">
          <label class="field"><span>قالب فاکتور</span><select class="text-input" id="previewTemplate">${Object.entries(TEMPLATE_LABELS).map(([k,v]) => `<option value="${k}" ${k === previewContext.template ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="field"><span>فونت فاکتور</span><select class="text-input" id="previewFont">${Object.entries(FONT_LABELS).map(([k,v]) => `<option value="${k}" ${k === previewContext.font ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="field"><span>اندازه کاغذ</span><select class="text-input" id="previewSize"><option value="A4" ${previewContext.size === 'A4' ? 'selected' : ''}>A4</option><option value="A5" ${previewContext.size === 'A5' ? 'selected' : ''}>A5</option><option value="80mm" ${previewContext.size === '80mm' ? 'selected' : ''}>رسید ۸۰ میلی‌متر</option></select></label>
        </div>
        <div class="preview-wrap" id="previewWrap">${invoiceDocumentHTML(inv, previewContext)}</div>
        <div class="print-note">این پیش‌نمایش همان قالبی است که در PDF و تصویر استفاده می‌شود. تغییر قالب، فونت یا اندازه بلافاصله نمایش داده می‌شود.</div>
      `,
      footer: `<button type="button" class="secondary-btn" id="closePreviewBtn">بستن</button><button type="button" class="primary-btn" id="openShareMenuBtn">اشتراک‌گذاری فایل</button>`
    });
    const refresh = () => {
      previewContext.template = $('#previewTemplate').value;
      previewContext.font = $('#previewFont').value;
      previewContext.size = $('#previewSize').value;
      $('#previewWrap').innerHTML = invoiceDocumentHTML(inv, previewContext);
      inv.template = previewContext.template;
      inv.fontFamily = previewContext.font;
      inv.paperSize = previewContext.size;
      saveState();
    };
    ['previewTemplate', 'previewFont', 'previewSize'].forEach(idName => $(`#${idName}`).addEventListener('change', refresh));
    $('#closePreviewBtn').addEventListener('click', closeModal);
    $('#openShareMenuBtn').addEventListener('click', () => openShareMenu(invoiceId, previewContext));
  }

  function openShareMenu(invoiceId, options = null) {
    const inv = state.invoices.find(x => x.id === invoiceId);
    if (!inv) return;
    const current = options || { template: inv.template || 'classic', font: inv.fontFamily || 'Vazirmatn', size: inv.paperSize || 'A4' };
    openModal({
      title: `اشتراک فاکتور ${inv.number}`,
      eyebrow: 'ارسال برای مشتری',
      body: `
        <div class="form-summary"><div><span>مشتری</span><strong>${escapeHtml(inv.customerName)}</strong></div><div><span>مانده</span><strong>${money(calculateInvoice(inv).remaining)}</strong></div><div><span>قالب و فونت</span><strong>${TEMPLATE_LABELS[current.template]} · ${FONT_LABELS[current.font]}</strong></div></div>
        <div class="share-grid">
          <button type="button" class="share-type-btn" data-share-format="pdf">اشتراک PDF<span>مناسب چاپ و ارسال رسمی</span></button>
          <button type="button" class="share-type-btn" data-share-format="docx">اشتراک Word<span>فایل قابل ویرایش</span></button>
          <button type="button" class="share-type-btn" data-share-format="png">اشتراک PNG<span>تصویر باکیفیت</span></button>
          <button type="button" class="share-type-btn" data-share-format="jpg">اشتراک JPG<span>تصویر کم‌حجم‌تر</span></button>
        </div>
      `,
      footer: '<button type="button" class="secondary-btn" id="cancelShareBtn">بازگشت</button>'
    });
    $('#cancelShareBtn').addEventListener('click', () => openInvoicePreview(invoiceId));
    $$('.share-type-btn').forEach(button => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        const oldText = button.textContent;
        button.textContent = 'در حال آماده‌سازی…';
        try {
          const format = button.dataset.shareFormat;
          const blob = await createExportBlob(inv, current, format);
          const ext = format === 'docx' ? 'docx' : format;
          const mime = format === 'pdf' ? 'application/pdf' :
            format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
            format === 'png' ? 'image/png' : 'image/jpeg';
          await shareBlob(blob, `${safeFileName(inv.number)}-${safeFileName(inv.customerName)}.${ext}`, mime, `فاکتور ${inv.number}`);
          closeModal();
          toast('فایل برای اشتراک‌گذاری آماده شد.');
          beep();
        } catch (error) {
          console.error(error);
          toast(`ساخت یا اشتراک فایل ناموفق بود: ${error.message || 'خطای ناشناخته'}`, 'error');
          button.disabled = false;
          button.textContent = oldText;
        }
      });
    });
  }
  function safeFileName(value) {
    return String(value || 'Farnava').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-').slice(0, 50);
  }

  async function captureInvoice(inv, options) {
    const holder = document.createElement('div');
    const renderWidth = options.size === 'A5' ? 559 : options.size === '80mm' ? 302 : 794;
    holder.style.cssText = `position:fixed;left:-10000px;top:0;z-index:-1;width:${renderWidth}px;background:#fff;pointer-events:none;`;
    holder.innerHTML = invoiceDocumentHTML(inv, options);
    document.body.appendChild(holder);
    try {
      await document.fonts.ready;
      const images = Array.from(holder.querySelectorAll('img'));
      await Promise.all(images.map(img => img.complete ? Promise.resolve() : new Promise(resolve => { img.onload = resolve; img.onerror = resolve; })));
      const page = $('#invoicePreviewPage', holder);
      const canvas = await html2canvas(page, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        windowWidth: Math.max(page.scrollWidth, renderWidth),
        windowHeight: page.scrollHeight
      });
      return canvas;
    } finally {
      holder.remove();
    }
  }
  async function createPdfBlob(canvas, size) {
    let format = size === 'A5' ? 'a5' : 'a4';
    if (size === '80mm') {
      const heightMm = Math.max(100, canvas.height / canvas.width * 80 + 10);
      format = [80, heightMm];
    }
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format, compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const pageCanvasHeight = Math.max(1, Math.floor(canvas.width * pageHeight / pageWidth));
    let offsetY = 0;
    let pageIndex = 0;
    while (offsetY < canvas.height) {
      const sliceHeight = Math.min(pageCanvasHeight, canvas.height - offsetY);
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = pageCanvasHeight;
      const ctx = slice.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, offsetY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
      if (pageIndex > 0) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/jpeg', 0.94), 'JPEG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
      offsetY += sliceHeight;
      pageIndex++;
    }
    return pdf.output('blob');
  }
  async function createDocxBlob(inv, options) {
    const calc = calculateInvoice(inv);
    const font = safeFont(options.font || 'Vazirmatn');
    const template = safeTemplate(options.template || inv.template);
    const accent = ({ classic: '233B54', modern: '087F73', minimal: '30343A', luxury: '936C2F' })[template];
    const zip = new JSZip();
    const xml = value => escapeHtml(value).replace(/&#39;/g, '&apos;');
    const run = (value, bold = false, size = 22, color = '222222') => `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/><w:rtl/>${bold ? '<w:b/><w:bCs/>' : ''}<w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xml(value)}</w:t></w:r>`;
    const para = (value, bold = false, size = 22, color = '222222') => `<w:p><w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr>${run(value, bold, size, color)}</w:p>`;
    const cell = (value, bold = false) => `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/>${bold ? `<w:shd w:fill="${accent}"/>` : ''}</w:tcPr><w:p><w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr>${run(String(value), bold, 19, bold ? 'FFFFFF' : '222222')}</w:p></w:tc>`;
    const imageRels = [];
    const imageParagraph = (dataUrl, name, relId, widthCm, heightCm) => {
      if (!dataUrl || !dataUrl.startsWith('data:image/png;base64,')) return '';
      const base64 = dataUrl.split(',')[1];
      zip.folder('word').folder('media').file(name, base64, { base64: true });
      imageRels.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
      const cx = Math.round(widthCm * 360000);
      const cy = Math.round(heightCm * 360000);
      return `<w:p><w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${relId === 'rIdLogo' ? 1 : 2}" name="${name}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    };

    const logoXml = imageParagraph(state.settings.logoData, 'farnava-logo.png', 'rIdLogo', 2.3, 2.0);
    const stampXml = imageParagraph(state.settings.stampData, 'farnava-stamp.png', 'rIdStamp', 2.6, 2.0);
    const tableRows = [
      `<w:tr>${['ردیف','شرح کالا / خدمت','تعداد','قیمت واحد','جمع'].map(x => cell(x, true)).join('')}</w:tr>`,
      ...(inv.items || []).map((item, index) => `<w:tr>${[
        new Intl.NumberFormat('fa-IR').format(index + 1),
        item.title,
        new Intl.NumberFormat('fa-IR').format(numberValue(item.qty)),
        money(item.price),
        money(numberValue(item.qty) * numberValue(item.price))
      ].map(x => cell(x)).join('')}</w:tr>`)
    ].join('');
    const body = [
      logoXml,
      para(`فاکتور ${inv.type === 'purchase' ? 'خرید' : 'فروش'}`, true, 34, accent),
      para(state.settings.businessName || 'فرنوا', true, 26, accent),
      para(`مدیر: ${state.settings.managerName || '—'}   تلفن: ${state.settings.phone || '—'}   شناسه: ${state.settings.businessCode || '—'}`),
      para(`آدرس: ${state.settings.address || '—'}`),
      para(`شماره فاکتور: ${inv.number}   تاریخ: ${formatDate(inv.date)}   سررسید: ${inv.dueDate ? formatDate(inv.dueDate) : '—'}`),
      para(`طرف حساب: ${inv.customerName || '—'}   تماس: ${inv.customerPhone || '—'}`),
      `<w:tbl><w:tblPr><w:bidiVisual/><w:tblBorders><w:top w:val="single" w:sz="6"/><w:left w:val="single" w:sz="6"/><w:bottom w:val="single" w:sz="6"/><w:right w:val="single" w:sz="6"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="900"/><w:gridCol w:w="3600"/><w:gridCol w:w="900"/><w:gridCol w:w="1800"/><w:gridCol w:w="1800"/></w:tblGrid>${tableRows}</w:tbl>`,
      para(`جمع اقلام: ${money(calc.subtotal)}`),
      para(`تخفیف: ${money(calc.discount)}`),
      para(`مالیات: ${money(calc.tax)}`),
      para(`مبلغ نهایی: ${money(calc.total)}`, true, 26),
      para(`پرداخت‌شده: ${money(calc.paid)}     مانده تسویه: ${money(calc.remaining)}`, true),
      para(`توضیحات: ${inv.notes || '—'}`),
      stampXml,
      para(`مهر و امضا: ${state.settings.businessName || '—'}`)
    ].join('');
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr><w:pgSz w:w="${options.size === 'A5' ? 8391 : options.size === '80mm' ? 4535 : 11906}" w:h="${options.size === 'A5' ? 11906 : options.size === '80mm' ? 12000 : 16838}"/><w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850"/></w:sectPr></w:body></w:document>`;
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
    zip.file('[Content_Types].xml', contentTypes);
    zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    zip.folder('word').file('document.xml', documentXml);
    zip.folder('word').file('styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/><w:rtl/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`);
    zip.folder('word').folder('_rels').file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${imageRels.join('')}</Relationships>`);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
  }
  async function createExportBlob(inv, options, format) {
    if (format === 'docx') return createDocxBlob(inv, options);
    const canvas = await captureInvoice(inv, options);
    if (format === 'pdf') return createPdfBlob(canvas, options.size);
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('ساخت تصویر ناموفق بود')), mime, 0.94));
  }
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.style.display = 'none';
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function shareBlob(blob, filename, mime, title) {
    const file = new File([blob], filename, { type: mime });
    if (Capacitor.isNativePlatform()) {
      try {
        const base64 = await blobToBase64(blob);
        const path = `farnava-share/${Date.now()}-${filename}`;
        await Filesystem.writeFile({ path, data: base64, directory: Directory.Cache, recursive: true });
        const fileUri = await Filesystem.getUri({ path, directory: Directory.Cache });
        await Share.share({
          title,
          text: `فایل ${title} از فرنوا`,
          files: [fileUri.uri],
          dialogTitle: 'اشتراک‌گذاری فاکتور'
        });
        return;
      } catch (nativeError) {
        console.warn('Native file share failed; trying Web Share', nativeError);
      }
    }
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title, text: `فایل ${title} از فرنوا`, files: [file] });
      return;
    }
    downloadBlob(blob, filename);
    toast('اشتراک فایل در این محیط پشتیبانی نشد؛ فایل دانلود شد.');
  }

  async function compressImageFile(file) {
    if (!file || !file.type.startsWith('image/')) throw new Error('فایل انتخاب‌شده تصویر نیست.');
    if (file.size > 8 * 1024 * 1024) throw new Error('حجم تصویر باید کمتر از ۸ مگابایت باشد.');
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = source;
    });
    let max = 900;
    let scale = Math.min(1, max / Math.max(img.width, img.height));
    let canvas = document.createElement('canvas');
    let ctx = canvas.getContext('2d');
    const render = () => {
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    };
    let result = render();
    if (result.length > 1_300_000) {
      max = 600;
      scale = Math.min(1, max / Math.max(img.width, img.height));
      result = render();
    }
    if (result.length > 1_300_000) {
      max = 400;
      scale = Math.min(1, max / Math.max(img.width, img.height));
      result = render();
    }
    if (result.length > 1_600_000) throw new Error('حجم تصویر پس از فشرده‌سازی هنوز زیاد است؛ تصویر کوچک‌تری انتخاب کن.');
    return result;
  }
  async function handleBrandImage(file, key, previewId, label) {
    if (!file) return;
    try {
      const previous = state.settings[key];
      state.settings[key] = await compressImageFile(file);
      if (!saveState()) {
        state.settings[key] = previous;
        return;
      }
      setPreviewImage($(previewId), state.settings[key], '');
      toast(`${label} ذخیره شد.`);
      beep();
    } catch (error) {
      toast(error.message || 'ذخیره تصویر انجام نشد.', 'error');
    }
  }

  function exportBackup() {
    const payload = {
      app: 'Farnava',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      dateCalendar: 'jalali-input-gregorian-storage',
      data: state
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    shareBlob(blob, `Farnava-Backup-${isoToday()}.farnava`, 'application/json', 'بکاپ فرنوا')
      .then(() => toast('فایل بکاپ آماده شد.'))
      .catch(error => toast(`اشتراک بکاپ ناموفق بود: ${error.message}`, 'error'));
  }
  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const data = parsed.data || parsed;
        if (!data || !Array.isArray(data.invoices) || !Array.isArray(data.expenses)) throw new Error('invalid');
        if (!confirm('اطلاعات فعلی با اطلاعات بکاپ جایگزین شود؟')) return;
        state = {
          ...defaultState(), ...data,
          settings: {
            ...defaultSettings(),
            ...(data.settings || {}),
            defaultFont: safeFont(data.settings?.defaultFont),
            logoData: safeImageData(data.settings?.logoData),
            stampData: safeImageData(data.settings?.stampData)
          },
          invoices: data.invoices.filter(Boolean).map(normalizeInvoice),
          expenses: data.expenses.filter(Boolean).map(normalizeExpense)
        };
        saveState(); render(); toast('بازیابی بکاپ با موفقیت انجام شد.'); beep();
      } catch (error) {
        toast('فایل بکاپ معتبر نیست یا قابل خواندن نیست.', 'error');
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function seedDemo() {
    if (!confirm('دو فاکتور و چند هزینه نمونه برای آزمایش اضافه شود؟')) return;
    const today = isoToday();
    const first = {
      id: id(), number: nextInvoiceNumber(), type: 'sale', date: today, dueDate: '',
      customerName: 'فروشگاه نمونه', customerPhone: '۰۹۱۲۱۲۳۴۵۶۷',
      discount: 100000, taxPercent: 9, paidAmount: 1500000, notes: 'بخشی از مبلغ دریافت شده است.',
      paperSize: 'A4', template: 'modern', fontFamily: 'Vazirmatn', isClosed: false,
      items: [{ id: id(), title: 'طراحی و اجرای خدمات', qty: 1, price: 2500000 }, { id: id(), title: 'پشتیبانی ماهانه', qty: 2, price: 500000 }]
    };
    const second = {
      id: id(), number: `FN-${String(state.invoices.length + 2).padStart(5, '0')}`, type: 'purchase', date: today, dueDate: '',
      customerName: 'تأمین‌کننده نمونه', customerPhone: '',
      discount: 0, taxPercent: 0, paidAmount: 200000, notes: '',
      paperSize: 'A5', template: 'classic', fontFamily: 'Abar', isClosed: false,
      items: [{ id: id(), title: 'مواد اولیه', qty: 5, price: 320000 }]
    };
    state.invoices.unshift(first, second);
    state.expenses.unshift(
      { id: id(), title: 'هزینه اینترنت', amount: 350000, category: 'عملیاتی', date: today, notes: '' },
      { id: id(), title: 'حمل‌ونقل', amount: 480000, category: 'لجستیک', date: today, notes: '' }
    );
    saveState(); render(); toast('داده نمونه اضافه شد؛ مانده و نمودار را بررسی کن.'); beep();
  }
  function resetAll() {
    if (!confirm('تمام فاکتورها، هزینه‌ها و اطلاعات کسب‌وکار حذف شوند؟ این کار برگشت‌پذیر نیست.')) return;
    state = defaultState(); saveState(); render(); toast('اطلاعات پاک شد.'); beep();
  }

  function openPrivacyPolicy() {
    openModal({
      title: 'حریم خصوصی فرنوا',
      eyebrow: 'اطلاعات شما',
      body: `
        <div class="privacy-copy">
          <p><strong>فرنوا برای مدیریت فاکتور و حساب‌وکتاب طراحی شده است.</strong></p>
          <p>اطلاعات کسب‌وکار، مشتریان، فاکتورها، هزینه‌ها، لوگو و مهر در حافظه محلی همین دستگاه نگهداری می‌شوند.</p>
          <p>فرنوا حساب کاربری، تبلیغات، پرداخت درون‌برنامه‌ای یا سرویس ابری ندارد و اطلاعات را به سرور اختصاصی ارسال نمی‌کند.</p>
          <p>اگر خودتان فاکتور یا فایل بکاپ را از طریق برنامه دیگری به اشتراک بگذارید، آن فایل طبق انتخاب شما در اختیار همان برنامه یا گیرنده قرار می‌گیرد.</p>
          <p>با حذف داده‌ها از تنظیمات یا پاک‌کردن اطلاعات برنامه، داده‌های محلی حذف می‌شوند. پیش از حذف برنامه، در صورت نیاز از بخش بکاپ یک نسخه فایل تهیه کنید.</p>
          <p class="muted">نسخه سیاست حریم خصوصی: ۱.۰ · آخرین بازبینی: آبان ۱۴۰۵</p>
        </div>
      `,
      footer: '<button type="button" class="primary-btn" id="privacyCloseBtn">متوجه شدم</button>'
    });
    $('#privacyCloseBtn').addEventListener('click', closeModal);
  }

  function bindEvents() {
    $$('.nav-btn').forEach(button => button.addEventListener('click', () => switchView(button.dataset.target)));
    $('#newInvoiceBtn').addEventListener('click', () => openInvoiceForm());
    $('#newInvoiceHero').addEventListener('click', () => openInvoiceForm());
    $('#newExpenseBtn').addEventListener('click', () => openExpenseForm());
    $('#newExpenseHero').addEventListener('click', () => openExpenseForm());
    els.quickAddBtn.addEventListener('click', () => {
      openModal({
        title: 'افزودن سریع',
        eyebrow: 'عملیات سریع',
        body: '<div class="backup-grid"><button type="button" class="primary-btn big-btn" id="quickInvoice">＋ فاکتور جدید</button><button type="button" class="secondary-btn big-btn" id="quickExpense">＋ هزینه جدید</button></div>',
        footer: '<button type="button" class="secondary-btn" id="quickClose">بستن</button>'
      });
      $('#quickInvoice').addEventListener('click', () => openInvoiceForm());
      $('#quickExpense').addEventListener('click', () => openExpenseForm());
      $('#quickClose').addEventListener('click', closeModal);
    });
    els.closeModalBtn.addEventListener('click', closeModal);
    els.modalBackdrop.addEventListener('click', event => { if (event.target === els.modalBackdrop) closeModal(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !els.modalBackdrop.classList.contains('hidden')) closeModal(); });

    els.invoiceSearch.addEventListener('input', renderInvoices);
    els.invoiceFilter.addEventListener('change', renderInvoices);
    els.statsChart.addEventListener('click', event => {
      const row = event.target.closest('[data-month]');
      if (!row) return;
      activeChartMonth = row.dataset.month;
      drawChart();
      beep();
    });
    $('#showUnsettledBtn').addEventListener('click', () => {
      switchView('invoices');
      els.invoiceFilter.value = 'unsettled';
      renderInvoices();
    });

    els.invoiceList.addEventListener('click', event => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const invoiceId = button.dataset.id;
      const invoice = state.invoices.find(x => x.id === invoiceId);
      if (!invoice) return;
      switch (button.dataset.action) {
        case 'edit-invoice': openInvoiceForm(invoiceId); break;
        case 'preview-invoice': openInvoicePreview(invoiceId); break;
        case 'share-invoice': openShareMenu(invoiceId); break;
        case 'close-invoice':
          if (confirm('این فاکتور بسته شود؟ مانده آن حذف نمی‌شود و در گزارش تسویه‌نشده باقی می‌ماند.')) {
            invoice.isClosed = true; saveState(); render(); toast('فاکتور بسته شد.'); beep();
          }
          break;
        case 'reopen-invoice':
          invoice.isClosed = false; saveState(); render(); toast('فاکتور دوباره باز شد.'); beep(); break;
        case 'delete-invoice':
          if (confirm('این فاکتور حذف شود؟')) {
            state.invoices = state.invoices.filter(x => x.id !== invoiceId);
            saveState(); render(); toast('فاکتور حذف شد.'); beep();
          }
          break;
      }
    });
    els.expenseList.addEventListener('click', event => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const exp = state.expenses.find(x => x.id === button.dataset.id);
      if (!exp) return;
      if (button.dataset.action === 'edit-expense') openExpenseForm(exp.id);
      if (button.dataset.action === 'delete-expense' && confirm('این هزینه حذف شود؟')) {
        state.expenses = state.expenses.filter(x => x.id !== exp.id);
        saveState(); render(); toast('هزینه حذف شد.'); beep();
      }
    });

    els.settingsForm.addEventListener('submit', event => {
      event.preventDefault();
      const form = event.currentTarget;
      for (const key of ['businessName', 'managerName', 'phone', 'businessCode', 'address', 'defaultFont']) {
        state.settings[key] = formValue(form, key).trim();
      }
      if (!state.settings.businessName) state.settings.businessName = 'نام کسب‌وکار شما';
      if (saveState()) { render(); toast('اطلاعات کسب‌وکار ذخیره شد.'); beep(); }
    });
    els.appSettingsForm.addEventListener('submit', event => {
      event.preventDefault();
      state.settings.soundEnabled = !!event.currentTarget.elements.soundEnabled.checked;
      state.settings.animationsEnabled = !!event.currentTarget.elements.animationsEnabled.checked;
      saveState(); renderAppSettings(); toast('تنظیمات برنامه ذخیره شد.'); beep();
    });

    els.logoFile.addEventListener('change', async event => {
      await handleBrandImage(event.target.files?.[0], 'logoData', '#logoPreview', 'لوگو');
      event.target.value = '';
    });
    els.stampFile.addEventListener('change', async event => {
      await handleBrandImage(event.target.files?.[0], 'stampData', '#stampPreview', 'مهر');
      event.target.value = '';
    });
    $('#removeLogoBtn').addEventListener('click', () => { state.settings.logoData = ''; saveState(); renderSettings(); toast('لوگو حذف شد.'); });
    $('#removeStampBtn').addEventListener('click', () => { state.settings.stampData = ''; saveState(); renderSettings(); toast('مهر حذف شد.'); });

    $('#exportBackupBtn').addEventListener('click', exportBackup);
    $('#importBackupBtn').addEventListener('click', () => els.backupFileInput.click());
    els.backupFileInput.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (file) importBackup(file);
      event.target.value = '';
    });
    $('#seedDemoBtn').addEventListener('click', seedDemo);
    $('#resetDataBtn').addEventListener('click', resetAll);
    $('#privacyBtn').addEventListener('click', openPrivacyPolicy);
    window.addEventListener('resize', () => { if (currentView === 'dashboard') drawChart(); });
  }

  bindEvents();
  render();
})();