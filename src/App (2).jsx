import React, { useState, useEffect, useMemo, useCallback, useRef, startTransition } from "react";
import { createPortal } from "react-dom";
import {
  Bell, Menu, Plus, X, Search, ChevronDown, ChevronLeft, ChevronRight,
  ArrowLeftRight, Landmark, TrendingUp, TrendingDown, Receipt,
  Trash2, Grid3x3, PieChart as PieChartIcon, Home as HomeIcon,
  Tag, Check, Star, Sun, Moon, Image as ImageIcon,
  Repeat, Download, Upload, Bitcoin, Landmark as Bank, CalendarDays,
  BellRing, FileSpreadsheet, Printer, Users, ShieldCheck, Save,
  Eye, EyeOff, StickyNote, Mic, LayoutGrid, LayoutList, ArrowUp, ArrowDown,
  DollarSign, RefreshCw, Sparkles, Type, Target, Fingerprint, Pencil, RotateCcw, Eraser,
  Fuel, ShoppingCart, Zap, Car, Pill, HandCoins, Shirt, Wifi, Smartphone, Drama, Gift, Wrench,
  Banknote, Building2, Droplets, Bus, CarTaxiFront, ConciergeBell, Minus, Utensils,
  ClipboardList, BarChart3, Scale, ScrollText, Wallet
} from "lucide-react";
import {
  PieChart, Pie, Cell, Sector, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  LineChart, Line, CartesianGrid
} from "recharts";
import { exportDocXlsx, exportDocPdf } from "./exportDoc.js";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Browser } from "@capacitor/browser";
import { BiometricAuth } from "@aparajita/capacitor-biometric-auth";
import { SpeechRecognition } from "@capgo/capacitor-speech-recognition";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { LocalNotifications } from "@capacitor/local-notifications";
import { nativeLoad, nativeSave, secureGet, secureSet, secureRemove } from "./nativeStorage.js";
import { rebuildLedger } from "./ledgerEngine.js";
import { isPnlTransaction, pnlAmount, postOnce, removeLinkedTransactions } from "./financialEngine.js";

/* ---------------------------------------------------------
   Helpers
--------------------------------------------------------- */
const toFaInt = (n) => Math.round(Number(n || 0)).toLocaleString("fa-IR");
const FA_DIGIT_MAP = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
const faDigits = (n) => String(n).split("").map((ch) => (/[0-9]/.test(ch) ? FA_DIGIT_MAP[+ch] : ch)).join("");
function jalaliYear(d) {
  try { return parseInt(new Intl.DateTimeFormat("en-US-u-ca-persian", { year: "numeric" }).format(d), 10); }
  catch { return new Date(d).getFullYear(); }
}
function jalaliParts(d) {
  try {
    const parts = new Intl.DateTimeFormat("en-US-u-ca-persian", { year: "numeric", month: "numeric", day: "numeric" }).formatToParts(d);
    return {
      y: +parts.find((p) => p.type === "year").value,
      m: +parts.find((p) => p.type === "month").value,
      day: +parts.find((p) => p.type === "day").value,
    };
  } catch { return { y: d.getFullYear(), m: d.getMonth() + 1, day: d.getDate() }; }
}
function faLongDate(d) {
  try { return new Intl.DateTimeFormat("fa-IR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d); }
  catch { return d.toDateString(); }
}
function faMonthYear(d) {
  try { return new Intl.DateTimeFormat("fa-IR", { month: "long", year: "numeric" }).format(d); }
  catch { return ""; }
}
function addMonths(dateStr, n) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysUntil(dateStr) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const todayISO = () => new Date().toISOString().slice(0, 10);
function migrateTransactions(list = [], loans = []) {
  const loanMap = new Map((Array.isArray(loans) ? loans : []).map((l) => [l.id, l]));
  return (Array.isArray(list) ? list : []).map((t) => {
    if (t?.loanId && t.loanRole === "receipt") return { ...t, isFinancing: true, pnlAmount: 0, sourceType: t.sourceType || "loan_receipt", sourceId: t.sourceId || t.loanId };
    if (t?.loanId && t.loanRole === "installment") {
      const l = loanMap.get(t.loanId);
      const totalInterest = l ? Math.max(0, Number(l.installments || 0) * Number(l.monthlyPayment || 0) - Number(l.principal || 0)) : 0;
      const interestPart = l?.installments ? totalInterest / Number(l.installments) : Number(t.interestPart || 0);
      return { ...t, isFinancing: true, pnlAmount: Number(t.pnlAmount ?? interestPart), principalPart: Number(t.principalPart ?? Math.max(0, Number(t.amount || 0) - interestPart)), interestPart, sourceType: t.sourceType || "loan_installment", sourceId: t.sourceId || `${t.loanId}:${t.loanSeq || t.id}` };
    }
    return t;
  });
}

function findJalaliMonthStart(jYear, jMonth) {
  // Farvardin 1 (Jalali New Year) falls around March 21 of (jYear + 621) in the Gregorian
  // calendar, and each subsequent Jalali month is ~30 days later. This anchor gets us close
  // enough that a modest search window reliably lands on the true day 1 of the target month.
  const approxNewYear = new Date(Date.UTC(jYear + 621, 2, 21));
  const anchor = new Date(approxNewYear);
  anchor.setUTCDate(anchor.getUTCDate() + (jMonth - 1) * 30);
  for (let delta = -25; delta <= 25; delta++) {
    const d = new Date(anchor); d.setUTCDate(d.getUTCDate() + delta);
    const p = jalaliParts(d);
    if (p.y === jYear && p.m === jMonth && p.day === 1) return d;
  }
  return null;
}
function getJalaliMonthCells(jYear, jMonth) {
  const start = findJalaliMonthStart(jYear, jMonth);
  if (!start) return [];
  const cells = []; let d = new Date(start);
  for (let i = 0; i < 32; i++) {
    const p = jalaliParts(d);
    if (p.y !== jYear || p.m !== jMonth) break;
    cells.push({ date: new Date(d), day: p.day, weekday: (d.getUTCDay() + 1) % 7 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return cells;
}

// Parses Persian number WORDS ("دویست و پنجاه هزار") into a numeric value.
// Needed because voice transcripts contain spoken numbers as words, not digits —
// the plain digit-regex below only catches typed/pasted numbers.
const FA_NUM_WORDS = {
  "صفر": 0, "یک": 1, "یه": 1, "دو": 2, "سه": 3, "چهار": 4, "پنج": 5, "شش": 6, "شیش": 6,
  "هفت": 7, "هشت": 8, "نه": 9, "ده": 10, "یازده": 11, "دوازده": 12, "سیزده": 13, "چهارده": 14,
  "پانزده": 15, "شانزده": 16, "هفده": 17, "هجده": 18, "نوزده": 19,
  "بیست": 20, "سی": 30, "چهل": 40, "پنجاه": 50, "شصت": 60, "هفتاد": 70, "هشتاد": 80, "نود": 90,
  "صد": 100, "یکصد": 100, "دویست": 200, "سیصد": 300, "چهارصد": 400, "پانصد": 500,
  "ششصد": 600, "هفتصد": 700, "هشتصد": 800, "نهصد": 900,
};
const FA_MULTIPLIERS = { "هزار": 1000, "میلیون": 1000000, "میلیارد": 1000000000 };
function persianWordsToNumber(text) {
  const words = text.replace(/[،,]/g, " ").split(/\s+/).filter(Boolean);
  let total = 0, current = 0, found = false;
  for (const w of words) {
    if (w === "و") continue;
    if (Object.prototype.hasOwnProperty.call(FA_NUM_WORDS, w)) { current += FA_NUM_WORDS[w]; found = true; }
    else if (Object.prototype.hasOwnProperty.call(FA_MULTIPLIERS, w)) { current = (current || 1) * FA_MULTIPLIERS[w]; total += current; current = 0; found = true; }
  }
  total += current;
  return found ? total : null;
}

function normalizeDigitsText(text = "") {
  return String(text)
    .replace(/[۰-۹]/g, (d) => "0123456789"["۰۱۲۳۴۵۶۷۸۹".indexOf(d)])
    .replace(/[٠-٩]/g, (d) => "0123456789"["٠١٢٣٤٥٦٧٨٩".indexOf(d)]);
}
function parseBankSms(text) {
  const raw = String(text || "").trim();
  const normalized = normalizeDigitsText(raw).replace(/[٬,،]/g, "");
  const amountMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(میلیارد|میلیون|هزار)?\s*(تومان|تومن|ریال)?/);
  let amount = null;
  let fromWords = false;
  if (amountMatch) {
    amount = Number(amountMatch[1]);
    const mult = { "هزار": 1e3, "میلیون": 1e6, "میلیارد": 1e9 }[amountMatch[2]] || 1;
    amount *= mult;
    if (amountMatch[3] === "تومان" || amountMatch[3] === "تومن") {
      // In spoken Persian, "۳۵۰ تومن" is commonly shorthand for 350 thousand Toman.
      if (!amountMatch[2] && amount < 10000) amount *= 1000;
      amount *= 10;
    }
  }
  if (!amount || !Number.isFinite(amount)) {
    const wordAmount = persianWordsToNumber(normalized);
    if (wordAmount !== null && wordAmount > 0) { amount = wordAmount; fromWords = true; }
  }
  if (amount === null) {
    const fallback = normalized.match(/\d+/);
    if (fallback) amount = Number(fallback[0]);
  }
  let type = "expense";
  if (/واریز|دریافت|حقوق|دستمزد|درآمد|طلب|credit|deposit|income/i.test(raw)) type = "income";
  if (/برداشت|خرید|خرج|پرداخت|هزینه|دادم|داد|کرایه|بنزین|رستوران|شام|ناهار|debit|purchase|expense/i.test(raw)) type = "expense";
  const CATEGORY_HINTS = [
    { re: /بنزین|سوخت|پمپ/, name: "بنزین" },
    { re: /رستوران|غذا|شام|ناهار|صبحانه|کافه|سوپرمارکت|خرید خوراک|بازار/, name: "خوراک و بازار" },
    { re: /قبض|آب|برق|گاز|اینترنت|تلفن|شارژ/, name: "قبوض" },
    { re: /تاکسی|اسنپ|تپسی|اتوبوس|مترو|کرایه|حمل/, name: "حمل و نقل" },
    { re: /دارو|دکتر|درمان|بیمارستان|پزشک/, name: "درمان" },
    { re: /حقوق|دستمزد|مزایا|فیش حقوقی/, name: "حقوق" },
    { re: /فروش|فروش کالا|فروش محصول/, name: "درآمد متفرقه" },
  ];
  const hint = CATEGORY_HINTS.find((h) => h.re.test(raw));
  return { amount: amount && Number.isFinite(amount) ? Math.round(amount) : null, type, note: raw.replace(/\s+/g, " ").slice(0, 160), categoryHint: hint?.name, fromWords };
}

// Currency display: base unit stored everywhere internally is always Rial.
// This only affects how numbers are *shown*, so data entry / storage stays consistent.
// usdRialRate = how many Rials one US Dollar costs right now (from the live rates widget,
// or the manual value the user entered in Settings if the live fetch didn't work).
function formatMoney(amount, currency, usdRialRate) {
  const n = Number(amount || 0);
  if (currency === "toman") return `${toFaInt(Math.round(n / 10))} تومان`;
  if (currency === "usd") {
    if (!usdRialRate) return `${toFaInt(n)} ریال`; // no rate yet, fall back to Rial rather than guess
    return `$${(n / usdRialRate).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
  return `${toFaInt(n)} ریال`;
}

function resizeImage(file, maxSize = 480) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > h) { if (w > maxSize) { h = h * maxSize / w; w = maxSize; } }
        else { if (h > maxSize) { w = w * maxSize / h; h = maxSize; } }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------------------------------------------------------
   Seed data
--------------------------------------------------------- */
const seedAccounts = () => ([
  { id: uid(), name: "بانک ملت", type: "bank", initial: 5000000 },
  { id: uid(), name: "صندوق نقدی", type: "fund", initial: 800000 },
  { id: uid(), name: "کارت عابر ملت", type: "card", initial: 0 },
]);
const seedCategories = () => {
  const vehicle = { id: uid(), name: "خودرو", kind: "expense" };
  return [
    vehicle,
    { id: uid(), name: "بنزین", kind: "expense", parentId: vehicle.id },
    { id: uid(), name: "خوراک و بازار", kind: "expense" },
    { id: uid(), name: "قبوض", kind: "expense" },
    { id: uid(), name: "حمل و نقل", kind: "expense" },
    { id: uid(), name: "درمان", kind: "expense" },
    { id: uid(), name: "متفرقه", kind: "expense" },
    { id: uid(), name: "حقوق", kind: "income" },
    { id: uid(), name: "درآمد متفرقه", kind: "income" },
  ];
};
const DEFAULT_HOME_SECTIONS = [
  { key: "shortcut", visible: true }, { key: "operations", visible: true }, { key: "expense", visible: true }, { key: "income", visible: true },
  { key: "banks", visible: true }, { key: "funds", visible: true }, { key: "balrep", visible: true },
  { key: "budget", visible: true }, { key: "loanchk", visible: true }, { key: "bills", visible: true },
];
// برای کاربرانی که چیدمان قدیمی ذخیره دارند: بخش «عملیات» اضافه و بخش حذف‌شده‌ی «اشخاص و بدهی‌ها» کنار گذاشته می‌شود
const normalizeHomeSections = (list) => {
  const base = (Array.isArray(list) && list.length ? list : DEFAULT_HOME_SECTIONS).filter((x) => x.key !== "contacts");
  if (base.some((x) => x.key === "operations")) return base;
  const out = [...base];
  out.splice(out.findIndex((x) => x.key === "shortcut") + 1, 0, { key: "operations", visible: true });
  return out;
};
const seedSettings = () => ({
  theme: "light", pin: "", pinHash: "", pinSalt: "", dueNotif: true, sharedFamily: false, themeColor: "purple",
  profile: { name: "alireza shadfar", phone: "", email: "" },
  homeLayout: "cards", homeSections: DEFAULT_HOME_SECTIONS,
  fontScale: 1, calendarMode: "jalali", currency: "rial",
  checkReminderDays: 7, smsNotif: false, smsAutoRead: false, biometricEnabled: false,
  manualUsdRate: "", shortcuts: [], lastRatesUpdate: "",
});

/* ---------------------------------------------------------
   Theme / palette
   BRAND is intentionally mutable: App() re-assigns its keys from the
   chosen preset on every render, so every component below (which reads
   BRAND.xxx directly at render time) automatically reflects the user's
   color choice without needing a context/hook everywhere.
--------------------------------------------------------- */
const COLOR_PRESETS = {
  purple: { name: "بنفش کلاسیک", header: "#3E1461", mauve: "#A65475", darkgreen: "#1B6B2C", green: "#1E8449", violet: "#6C3FA0", teal: "#4E9AA0", gold: "#A98A3B", crimson: "#B01E4A", orange: "#C56A1F", fab: "#28C76F" },
  ocean: { name: "آبی اقیانوسی", header: "#0B4F6C", mauve: "#3D7EA6", darkgreen: "#0F7173", green: "#14919B", violet: "#145DA0", teal: "#4CC9F0", gold: "#B08968", crimson: "#D64550", orange: "#F2A65A", fab: "#2EC4B6" },
  forest: { name: "سبز جنگلی", header: "#1B4332", mauve: "#40916C", darkgreen: "#2D6A4F", green: "#40916C", violet: "#52796F", teal: "#74C69D", gold: "#B08968", crimson: "#BC4749", orange: "#DDA15E", fab: "#52B788" },
  rose: { name: "گلبهی", header: "#6D2148", mauve: "#B23A5D", darkgreen: "#2D6A4F", green: "#40916C", violet: "#8E3B6C", teal: "#C9738A", gold: "#B08968", crimson: "#C1121F", orange: "#E07A5F", fab: "#F4978E" },
  charcoal: { name: "زغالی تیره", header: "#22223B", mauve: "#4A4E69", darkgreen: "#22577A", green: "#38A3A5", violet: "#4A4E69", teal: "#5C677D", gold: "#9A8C98", crimson: "#C9184A", orange: "#C08552", fab: "#57CC99" },
};
let BRAND = { ...COLOR_PRESETS.purple };
const THEME = {
  light: { bg: "#F1EFF4", card: "#ffffff", text: "#241a30", sub: "#8a8194", border: "#f0eef3", input: "#faf9fb", inputBorder: "#e3e0ea" },
  dark: { bg: "#17131c", card: "#241d2c", text: "#f1eef5", sub: "#a79fb3", border: "#332b3d", input: "#2c2434", inputBorder: "#3d3348" },
};
const FONT = "'Vazirmatn', Tahoma, 'Segoe UI', sans-serif";

// Storage abstraction: uses the Claude-artifact window.storage API when present
// (always true inside claude.ai), and falls back to localStorage automatically
// when this same code runs as a standalone deployed app / APK build.
const hasCloudStorage = typeof window !== "undefined" && window.storage && typeof window.storage.get === "function";
async function loadKey(key, fallback, shared) {
  flushSaves();
  try {
    if (hasCloudStorage) {
      const res = await window.storage.get(key, !!shared);
      return res && res.value ? JSON.parse(res.value) : fallback;
    }
    if (Capacitor.isNativePlatform()) return await nativeLoad(key, fallback);
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
// ذخیره‌ی دسته‌ای: نوشتن‌های پشت‌سرهم یکی می‌شوند و بیرون از لحظه‌ی کلیک انجام می‌شوند (ثبت تراکنش دیگر هنگ نمی‌کند)
const _saveQueue = new Map();
let _saveTimer = null;
function flushSaves() {
  clearTimeout(_saveTimer); _saveTimer = null;
  const pending = Array.from(_saveQueue.entries());
  _saveQueue.clear();
  for (const [key, { value, shared }] of pending) {
    try {
      if (hasCloudStorage) window.storage.set(key, JSON.stringify(value), !!shared);
      else if (Capacitor.isNativePlatform()) nativeSave(key, value).catch((e) => console.error("sqlite save fail", e));
      else window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { console.error("save fail", e); }
  }
}
async function saveKey(key, value, shared) {
  _saveQueue.set(key, { value, shared });
  clearTimeout(_saveTimer);
  // نوشتن سنگین (JSON.stringify همه‌ی تراکنش‌ها) در زمان بیکاری انجام می‌شود تا کلیک‌ها هنگ نکنند
  _saveTimer = setTimeout(() => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(flushSaves, { timeout: 3000 });
    else flushSaves();
  }, 900);
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushSaves);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushSaves(); });
  try { CapacitorApp.addListener("pause", flushSaves); } catch {}
}

/* ---------------------------------------------------------
   Small UI atoms (theme aware)
--------------------------------------------------------- */
function useT() { return React.useContext(ThemeCtx); }
const ThemeCtx = React.createContext(THEME.light);

/* ---------------------------------------------------------
   Exploding / stylized pie chart — click a slice to pop it out
   a little and see its label. Recharts doesn't do true 3D, so
   "3D" here means a soft drop-shadow + slightly thicker ring to
   give it some depth rather than a flat chart.
--------------------------------------------------------- */
function renderExplodingSlice(props) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, isActive } = props;
  const RADIAN = Math.PI / 180;
  const midAngle = (startAngle + endAngle) / 2;
  const offset = isActive ? 14 : 0;
  const ox = Math.cos(-midAngle * RADIAN) * offset;
  const oy = Math.sin(-midAngle * RADIAN) * offset;
  return (
    <g transform={`translate(${ox},${oy})`} style={{ filter: "drop-shadow(0px 3px 4px rgba(0,0,0,0.35))" }}>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={isActive ? outerRadius + 6 : outerRadius}
        startAngle={startAngle} endAngle={endAngle} fill={fill} stroke="#fff" strokeWidth={2} />
    </g>
  );
}
function ExplodingPie({ data, height = 220, currency, usdRate }) {
  const t = useT();
  const [active, setActive] = useState(null);
  if (!data || data.length === 0) return <EmptyRow text="داده‌ای برای نمایش نیست" />;
  const item = active != null ? data[active] : null;
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={data} dataKey="amount" nameKey="name" innerRadius={height * 0.16} outerRadius={height * 0.36}
            paddingAngle={2}
            onClick={(_, i) => setActive(active === i ? null : i)}
            shape={(props) => renderExplodingSlice({ ...props, isActive: active === props.index })}>
            {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} cursor="pointer" />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div style={{ textAlign: "center", minHeight: 20, fontSize: 13, fontWeight: 700, color: item ? PIE_COLORS[active % PIE_COLORS.length] : t.sub }}>
        {item ? `${item.name} — ${formatMoney(item.amount, currency, usdRate)}` : "برای جزئیات روی هر بخش بزن"}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 8 }}>
        {data.map((d, i) => (
          <span key={i} onClick={() => setActive(active === i ? null : i)} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: t.sub, cursor: "pointer" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: PIE_COLORS[i % PIE_COLORS.length] }} />
            {d.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Half-circle speedometer gauge — e.g. check collection ratio
--------------------------------------------------------- */
function GaugeSpeedometer({ pct, label, colorFrom = "#B01E4A", colorTo = "#1E8449" }) {
  const t = useT();
  const size = 200, stroke = 16;
  const cx = size / 2, cy = size / 2 + 10, r = size / 2 - stroke;
  const clamped = Math.max(0, Math.min(100, pct));
  const angle = -180 + (clamped / 100) * 180; // -180 (left) .. 0 (right)
  const rad = (angle * Math.PI) / 180;
  const needleX = cx + r * 0.86 * Math.cos(rad);
  const needleY = cy + r * 0.86 * Math.sin(rad);
  const arc = (startDeg, endDeg, color) => {
    const s = (startDeg * Math.PI) / 180, e = (endDeg * Math.PI) / 180;
    const x1 = cx + r * Math.cos(s), y1 = cy + r * Math.sin(s);
    const x2 = cx + r * Math.cos(e), y2 = cy + r * Math.sin(e);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" />;
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width={size} height={size / 2 + 30}>
        {arc(-180, 0, t.border)}
        {arc(-180, angle, clamped >= 60 ? colorTo : clamped >= 30 ? "#C56A1F" : colorFrom)}
        <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke={t.text} strokeWidth={3} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={7} fill={t.text} />
      </svg>
      <div style={{ fontSize: 20, fontWeight: 800, color: t.text, marginTop: -6 }}>{toFaInt(Math.round(clamped))}٪</div>
      <div style={{ fontSize: 12.5, color: t.sub, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

/* ---------------------------------------------------------
   Bank card carousel — swipeable, with a show/hide-balance eye
--------------------------------------------------------- */
// تاریخ انقضا: ۴ رقم و یک «/» بین دو رقم اول و دو رقم دوم (مثلا 04/08)
const toEnDigits = (v) => String(v || "").replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
function fmtExpiry4(v) { const d = toEnDigits(v).replace(/\D/g, "").slice(0, 4); return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; }
function expiryFromStored(v) { let d = toEnDigits(v).replace(/\D/g, ""); if (d.length >= 6) d = d.slice(2, 6); return fmtExpiry4(d); } // مقدارهای قدیمی مثل 1406/08 → 06/08
function BankCard({ account, balance, hidden, currency, usdRate, onEdit }) {
  const rawCard = String(account.cardNumber || "").replace(/\D/g, "").slice(0, 16);
  const cardNumber = rawCard.length === 16 ? rawCard.replace(/(.{4})/g, "$1 ").trim() : (account.cardNumberLast4 ? `•••• •••• •••• ${account.cardNumberLast4}` : "شماره کارت ثبت نشده");
  const expiryDate = expiryFromStored(account.expiryDate) || "—";
  return (
    <div style={{
      minWidth: 300, maxWidth: 300, height: 176, borderRadius: 18, padding: 18, color: "#fff", flexShrink: 0,
      background: `linear-gradient(135deg, ${BRAND.violet}, ${BRAND.header})`,
      boxShadow: "0 6px 16px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", justifyContent: "space-between",
      scrollSnapAlign: "center", position: "relative", overflow: "hidden"
    }}>
      <div style={{ position: "absolute", top: -40, left: -40, width: 140, height: 140, borderRadius: "50%", background: "rgba(255,255,255,0.08)" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", zIndex: 1 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>{account.name}</div>
        <button onClick={onEdit} aria-label="ویرایش کارت" style={{ border: "none", background: "rgba(255,255,255,.14)", color: "#fff", borderRadius: 8, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Pencil size={15} /></button>
      </div>
      <div style={{ fontSize: rawCard.length === 16 ? 16 : 13, letterSpacing: rawCard.length === 16 ? 2.2 : 0.5, fontWeight: 700, zIndex: 1, direction: "ltr", textAlign: "left", whiteSpace: "nowrap" }}>
        {cardNumber}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", zIndex: 1 }}>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9.5, opacity: 0.72 }}>تاریخ انقضا</div>
          <div style={{ fontSize: 13, fontWeight: 800, direction: "ltr" }}>{expiryDate}</div>
        </div>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 11, opacity: 0.8 }}>{account.type === "card" ? "کارت" : "بانک"}</div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{hidden ? "••••••••" : formatMoney(balance, currency, usdRate)}</div>
        </div>
      </div>
    </div>
  );
}
function BankCardCarousel({ accounts, accountBalance, currency, usdRate, onAddCard, onEditAccount }) {
  const t = useT();
  const [hidden, setHidden] = useState(false);
  const cards = accounts.filter((a) => a.type === "bank" || a.type === "card");
  return (
    <div style={{ marginBottom: 16 }}>
      {cards.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 4px 6px" }}>
          <button onClick={() => setHidden((v) => !v)} style={{ background: "none", border: "none", color: t.sub, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600 }}>
            {hidden ? <EyeOff size={15} /> : <Eye size={15} />} {hidden ? "نمایش موجودی" : "مخفی کردن موجودی"}
          </button>
        </div>
      )}
      <div style={{ display: "flex", gap: 12, overflowX: "auto", scrollSnapType: "x mandatory", paddingBottom: 4, paddingInline: 2 }}>
        {cards.map((a) => <BankCard key={a.id} account={a} balance={accountBalance(a.id)} hidden={hidden} currency={currency} usdRate={usdRate} onEdit={() => onEditAccount?.(a)} />)}
        <button onClick={onAddCard} style={{
          minWidth: 300, maxWidth: 300, height: 176, borderRadius: 18, flexShrink: 0, scrollSnapAlign: "center",
          border: `2px dashed ${t.border}`, background: t.card, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer", color: t.sub
        }}>
          <span style={{ width: 44, height: 44, borderRadius: "50%", background: BRAND.violet, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Plus size={22} />
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>افزودن کارت/حساب جدید</span>
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Today box: date + quick note / reminder buttons
--------------------------------------------------------- */
function DateQuickBox({ onNote, onReminder }) {
  const t = useT();
  return (
    <div style={{ background: t.card, borderRadius: 14, padding: "12px 16px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
      <div style={{ color: t.text, fontSize: 13, fontWeight: 700 }}>{faLongDate(new Date())}</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onNote} style={{ ...quickPillBtn, background: BRAND.violet }}><StickyNote size={13} /> یادداشت</button>
        <button onClick={onReminder} style={{ ...quickPillBtn, background: BRAND.orange }}><BellRing size={13} /> یادآوری</button>
      </div>
    </div>
  );
}
const quickPillBtn = { display: "flex", alignItems: "center", gap: 4, border: "none", color: "#fff", borderRadius: 20, padding: "6px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" };

/* ---------------------------------------------------------
   Income/Expense day widget — مطابق تصویر مرجع:
   هدر (تاریخ + تعداد سررسید)، نمودار دایره‌ای رنگی با آیکن دسته‌ها
   (بدون هیچ نوشته یا کادری داخل نمودار)، فلش‌های روز قبل/بعد در دو طرف،
   و دو کادر «جمع درآمدها» / «جمع هزینه‌ها» که با لمس، نمودار را عوض می‌کنند.
--------------------------------------------------------- */
// هزینه‌ها: رنگ‌های قرمز/بنفش/نارنجی — درآمدها: رنگ‌های سبز/آبی
const EXPENSE_COLORS = ["#F5503F", "#6B42B8", "#FFA726", "#EC407A", "#8D6E63", "#E53935"];
const INCOME_COLORS = ["#96C852", "#14AEF2", "#26A69A", "#66BB6A", "#29B6F6", "#00ACC1"];

function categoryIconFor(name = "") {
  const n = String(name);
  if (/بنزین|سوخت|پمپ/.test(n)) return Fuel;
  if (/رستوران|کافه|غذا|شام|ناهار/.test(n)) return Utensils;
  if (/خوراک|بازار|سوپر|خرید|مارکت/.test(n)) return ShoppingCart;
  if (/برق|گاز/.test(n)) return Zap;
  if (/آب/.test(n)) return Droplets;
  if (/قبض|قبوض/.test(n)) return Zap;
  if (/تاکسی|اسنپ|تپسی|اتوبوس|مترو|حمل|کرایه|ماشین|خودرو/.test(n)) return Car;
  if (/درمان|دارو|دکتر|پزشک|بیمارستان|سلامت/.test(n)) return Pill;
  if (/حقوق|دستمزد|مزایا/.test(n)) return HandCoins;
  if (/پوشاک|لباس/.test(n)) return Shirt;
  if (/اینترنت/.test(n)) return Wifi;
  if (/موبایل|تلفن|شارژ/.test(n)) return Smartphone;
  if (/تفریح|سرگرمی|بازی/.test(n)) return Drama;
  if (/هدیه/.test(n)) return Gift;
  if (/تعمیر/.test(n)) return Wrench;
  if (/خانه|منزل|اجاره|رهن|ساختمان/.test(n)) return HomeIcon;
  if (/بانک|کارمزد/.test(n)) return Building2;
  if (/وام|قسط|درآمد|فروش|سود/.test(n)) return Banknote;
  return Sparkles;
}

// مبلغ را به دو بخش «عدد» و «واحد» می‌شکند (واحد در کادر به‌صورت عمودی نوشته می‌شود)
function moneyParts(amount, currency, usdRate) {
  const n = Number(amount || 0);
  if (currency === "toman") return { num: toFaInt(Math.round(n / 10)), unit: "تومان" };
  if (currency === "usd" && usdRate) return { num: (n / usdRate).toLocaleString("en-US", { maximumFractionDigits: 2 }), unit: "$" };
  return { num: toFaInt(n), unit: "ریال" };
}
function faDayMonth(dateStr) {
  try { return new Intl.DateTimeFormat("fa-IR", { weekday: "long", day: "numeric", month: "long" }).format(new Date(dateStr)); }
  catch { return dateStr; }
}

function periodKey(rawDate, period) {
  const dateStr = String(rawDate || "").slice(0, 10); // اگر تاریخ همراه ساعت ذخیره شده باشد هم کار کند
  if (period === "day") return dateStr;
  const p = jalaliParts(new Date(dateStr));
  return period === "year" ? String(p.y) : `${p.y}-${p.m}`;
}
function stepPeriod(dateStr, period, dir) {
  if (period === "day") return addDays(dateStr, dir);
  const k = periodKey(dateStr, period);
  let d = dateStr;
  for (let i = 0; i < 400; i++) { d = addDays(d, dir); if (periodKey(d, period) !== k) break; }
  return d;
}
function periodLabel(dateStr, period) {
  if (period === "day") return faDayMonth(dateStr);
  if (period === "month") return faMonthYear(new Date(dateStr));
  return `سال ${faDigits(jalaliParts(new Date(dateStr)).y)}`;
}

const polarPt = (cx, cy, r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
};
function slicePath(cx, cy, r, a0, a1) {
  const [x0, y0] = polarPt(cx, cy, r, a0), [x1, y1] = polarPt(cx, cy, r, a1);
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1} Z`;
}
function ringPath(cx, cy, r0, r1, a0, a1) {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [ox0, oy0] = polarPt(cx, cy, r1, a0), [ox1, oy1] = polarPt(cx, cy, r1, a1);
  const [ix0, iy0] = polarPt(cx, cy, r0, a0), [ix1, iy1] = polarPt(cx, cy, r0, a1);
  return `M ${ox0} ${oy0} A ${r1} ${r1} 0 ${large} 1 ${ox1} ${oy1} L ${ix1} ${iy1} A ${r0} ${r0} 0 ${large} 0 ${ix0} ${iy0} Z`;
}

function ColorPie({ data, selected, onSelect }) {
  const t = useT();
  const cx = 150, cy = 150, R = 134, HOLE = 28, RING = 40, START = 35;
  const total = data.reduce((s, d) => s + d.amount, 0);
  let acc = START;
  const slices = total > 0 ? data.map((d, i) => {
    const span = (d.amount / total) * 360;
    const s = { ...d, i, a0: acc, a1: acc + span, span, color: d.color };
    acc += span;
    return s;
  }) : [];
  const single = slices.length === 1;

  return (
    <svg viewBox="0 0 300 300" style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}>
      {total <= 0 && <circle cx={cx} cy={cy} r={R - 4} fill={t.inputBorder} />}
      {slices.map((s) => {
        const mid = (s.a0 + s.a1) / 2;
        const isSel = selected === s.i;
        const [ox, oy] = isSel ? polarPt(0, 0, 9, mid) : [0, 0];
        const Icon = categoryIconFor(s.name);
        const [ix, iy] = polarPt(cx, cy, R * 0.63, mid);
        const arcLen = (s.span * Math.PI / 180) * R * 0.63;
        const size = Math.min(46, arcLen * 0.75);
        return (
          <g key={s.i} transform={`translate(${ox} ${oy})`} onClick={() => onSelect(isSel ? null : s.i)} style={{ cursor: "pointer" }}>
            {single
              ? <circle cx={cx} cy={cy} r={R} fill={s.color} />
              : <path d={slicePath(cx, cy, R, s.a0, s.a1)} fill={s.color} stroke={t.card} strokeWidth={8} strokeLinejoin="round" />}
            {single
              ? <circle cx={cx} cy={cy} r={(HOLE + RING) / 2} fill="none" stroke="#fff" strokeOpacity={0.4} strokeWidth={RING - HOLE} />
              : <path d={ringPath(cx, cy, HOLE, RING, s.a0, s.a1)} fill="#fff" fillOpacity={0.4} />}
            {size >= 16 && (
              <Icon x={ix - size / 2} y={iy - size / 2} size={size} color="#fff" strokeWidth={1.7}
                fill="#fff" fillOpacity={0.28} style={{ opacity: 0.6, pointerEvents: "none" }} />
            )}
          </g>
        );
      })}
      {total <= 0 && <circle cx={cx} cy={cy} r={RING} fill="#fff" fillOpacity={0.4} />}
      <circle cx={cx} cy={cy} r={HOLE} fill={t.card} style={{ pointerEvents: "none" }} />
    </svg>
  );
}

// منحنی تراز: درآمد > هزینه = لبخند سبز | هزینه > درآمد = اخم قرمز | برابر = خط صاف نارنجی (بدون هیچ نوشته)
function SmileFrownArc({ income, expense }) {
  const net = income - expense;
  const color = net > 0 ? "#22A559" : net < 0 ? "#E5384B" : "#F59E0B";
  const w = 220, h = 56, strokeW = 13;
  const d = net > 0
    ? `M 18 ${h * 0.30} Q ${w / 2} ${h * 0.90} ${w - 18} ${h * 0.30}`   // لبخند ∪ (درآمد بیشتر)
    : net < 0
      ? `M 18 ${h * 0.70} Q ${w / 2} ${h * 0.14} ${w - 18} ${h * 0.70}`  // اخم ∩ (هزینه بیشتر)
      : `M 18 ${h / 2} L ${w - 18} ${h / 2}`;
  return (
    <div style={{ display: "flex", justifyContent: "center", paddingTop: 14 }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", overflow: "visible" }}>
        <path d={d} fill="none" stroke={color} strokeWidth={strokeW} strokeLinecap="round" />
      </svg>
    </div>
  );
}

function DayArrowBtn({ dir, onClick }) {
  const t = useT();
  return (
    <button onClick={onClick} aria-label={dir === "left" ? "روز بعد" : "روز قبل"}
      style={{ width: 28, height: 42, borderRadius: 7, border: "none", background: t.inputBorder, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, padding: 0 }}>
      <svg width="12" height="14" viewBox="0 0 12 14">
        <polygon points={dir === "left" ? "11,1 1,7 11,13" : "1,1 11,7 1,13"} fill={t.sub} />
      </svg>
    </button>
  );
}

function TotalBox({ kind, active, amount, currency, usdRate, onClick }) {
  const t = useT();
  const isExp = kind === "expense";
  const main = isExp ? "#E5384B" : "#22A559";
  const c = active ? main : "#9b9b9b";
  const { num, unit } = moneyParts(amount, currency, usdRate);
  const fs = num.length > 14 ? 10.5 : num.length > 12 ? 12 : num.length > 9 ? 14 : 16;
  return (
    <button onClick={onClick} style={{
      flex: 1, minWidth: 0, direction: "rtl", display: "flex", alignItems: "center", gap: 6, padding: "10px 8px",
      border: `2px solid ${active ? main : "#cfcfcf"}`, borderRadius: 14, background: t.card, cursor: "pointer", fontFamily: "inherit"
    }}>
      <span style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: active ? (isExp ? "#FBC9CF" : "#C2EBD2") : "#e4e4e4", color: c }}>
        {isExp ? <Minus size={20} strokeWidth={3.4} /> : <Plus size={20} strokeWidth={3.4} />}
      </span>
      <span style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: c }}>{isExp ? "جمع هزینه‌ها" : "جمع درآمدها"}</div>
        <div style={{ fontSize: fs, fontWeight: 900, color: c, whiteSpace: "nowrap", marginTop: 2 }}>{num}</div>
      </span>
      <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontSize: 11, fontWeight: 700, color: c, flexShrink: 0 }}>{unit}</span>
    </button>
  );
}

function IncomeExpenseDayWidget({ day, setDay, transactions, catById, currency, usdRate, bills = [], checks = [], onOpenTransactions }) {
  const t = useT();
  const [show, setShow] = useState({ expense: true, income: true });
  const [period, setPeriod] = useState("month");
  const [selected, setSelected] = useState(null);
  const touchX = useRef(null);
  useEffect(() => { setSelected(null); }, [day, show, period]);
  // اگر امروز تراکنشی نیست، یک بار به آخرین روزی که تراکنش دارد برو تا نمودار خالی نماند
  const autoJumped = useRef(false);
  useEffect(() => {
    if (autoJumped.current || !transactions.length) return;
    autoJumped.current = true;
    if (transactions.some((tx) => periodKey(tx.date, period) === periodKey(day, period))) return;
    const dates = transactions.filter((tx) => tx.type === "income" || tx.type === "expense").map((tx) => tx.date).filter(Boolean).sort();
    if (dates.length) setDay(dates[dates.length - 1]);
    // eslint-disable-next-line
  }, [transactions]);

  const dayKey = periodKey(day, period);
  const dayTx = useMemo(() => transactions.filter((tx) => tx.date && periodKey(tx.date, period) === dayKey), [transactions, dayKey, period]);
  const income = dayTx.filter((tx) => tx.type === "income").reduce((s, tx) => s + Number(tx.amount || 0), 0);
  const expense = dayTx.filter((tx) => tx.type === "expense").reduce((s, tx) => s + Number(tx.amount || 0), 0);
  // یک نمودار برای هر دو: برش‌های هزینه و درآمد کنار هم
  const pieData = useMemo(() => {
    const build = (type, colors) => {
      const map = {};
      dayTx.filter((tx) => tx.type === type).forEach((tx) => {
        const name = catById(tx.categoryId)?.name || "بدون دسته";
        map[name] = (map[name] || 0) + Number(tx.amount || 0);
      });
      let all = Object.entries(map).sort((a, b) => b[1] - a[1]).map(([name, amount]) => ({ name, amount }));
      if (all.length > 6) all = [...all.slice(0, 5), { name: "سایر", amount: all.slice(5).reduce((x, d) => x + d.amount, 0) }];
      return all.map((d, k) => ({ ...d, type, color: colors[k % colors.length] }));
    };
    return [...(show.expense ? build("expense", EXPENSE_COLORS) : []), ...(show.income ? build("income", INCOME_COLORS) : [])];
  }, [dayTx, show, catById]);
  const toggleKind = (k) => setShow((p) => {
    const other = k === "expense" ? "income" : "expense";
    return p[k] && !p[other] ? p : { ...p, [k]: !p[k] }; // حداقل یکی همیشه روشن می‌ماند
  });

  const dueCount = bills.filter((b) => !b.paid && b.dueDate && periodKey(b.dueDate, period) === dayKey).length + checks.filter((c) => c.status === "pending" && c.dueDate && periodKey(c.dueDate, period) === dayKey).length;
  const sel = selected != null ? pieData[selected] : null;

  const prev = () => setDay(stepPeriod(day, period, -1));
  const next = () => setDay(stepPeriod(day, period, 1));
  const onTouchEnd = (e) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) > 55) { dx > 0 ? prev() : next(); }
  };

  return (
    <div style={{ background: t.card, borderRadius: 20, marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", overflow: "hidden", direction: "rtl" }}>
      {/* هدر */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${t.border}` }}>
        <span style={{ width: 34, height: 34, borderRadius: "50%", background: t.inputBorder, color: t.text, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, flexShrink: 0 }}>
          {faDigits(dueCount)}
        </span>
        <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 800, color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          سررسیدهای، <span onClick={() => setDay(todayISO())} style={{ color: BRAND.violet, cursor: "pointer" }}>{periodLabel(day, period)}</span>
        </div>
        <button onClick={onOpenTransactions} aria-label="تراکنش‌ها" style={{ border: "none", background: "transparent", color: t.text, display: "flex", padding: 4, cursor: "pointer" }}>
          <ChevronLeft size={24} />
        </button>
      </div>

      {/* بازه: روز / ماه / سال */}
      <div style={{ display: "flex", justifyContent: "center", gap: 8, paddingTop: 12 }}>
        {[["day", "روز"], ["month", "ماه"], ["year", "سال"]].map(([k, l]) => (
          <button key={k} onClick={() => setPeriod(k)} style={{ border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700, padding: "5px 16px", borderRadius: 14, background: period === k ? BRAND.violet : t.inputBorder, color: period === k ? "#fff" : t.sub }}>{l}</button>
        ))}
      </div>

      <SmileFrownArc income={income} expense={expense} />

      {/* نمودار + فلش‌ها */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 12px 8px" }}>
        <DayArrowBtn dir="right" onClick={prev} />
        <div style={{ flex: 1, maxWidth: 290, margin: "0 auto", touchAction: "pan-y" }}
          onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }} onTouchEnd={onTouchEnd}>
          <ColorPie data={pieData} selected={selected} onSelect={setSelected} />
        </div>
        <DayArrowBtn dir="left" onClick={next} />
      </div>
      {sel && (
        <div style={{ textAlign: "center", fontSize: 12.5, fontWeight: 700, color: sel.color, padding: "0 12px 4px" }}>
          {sel.name} — {formatMoney(sel.amount, currency, usdRate)}
        </div>
      )}

      {/* جمع درآمدها / هزینه‌ها */}
      <div style={{ display: "flex", gap: 12, padding: "14px 12px 14px" }}>
        <TotalBox kind="expense" active={show.expense} amount={expense} currency={currency} usdRate={usdRate} onClick={() => toggleKind("expense")} />
        <TotalBox kind="income" active={show.income} amount={income} currency={currency} usdRate={usdRate} onClick={() => toggleKind("income")} />
      </div>
    </div>
  );
}

function CollapsibleSection({ color, title, open, onToggle, children, badge, onAdd, radius = 14 }) {
  const t = useT();
  return (
    <div style={{ borderRadius: radius, overflow: "hidden", marginBottom: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
      <div onClick={onToggle} style={{
        width: "100%", background: color, border: "none", color: "#fff", padding: "15px 16px",
        display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", fontFamily: "inherit"
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ChevronDown size={17} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          </span>
          {onAdd && (
            <button onClick={(e) => { e.stopPropagation(); onAdd(); }} style={{
              width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,.22)", border: "none",
              color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer"
            }}>
              <Plus size={16} />
            </button>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15 }}>
          {badge}{title}
        </span>
      </div>
      {open && <div style={{ background: t.card, padding: "6px 14px" }}>{children}</div>}
    </div>
  );
}

function Row({ leftIcon, leftColor = "#eee", title, subtitle, value, valueColor, onClick, chevron = "left", extra }) {
  const t = useT();
  return (
    <div onClick={onClick} style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 4px",
      borderBottom: `1px solid ${t.border}`, cursor: onClick ? "pointer" : "default"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {chevron && <ChevronLeft size={16} color={t.sub} style={{ flexShrink: 0, transform: chevron === "left" ? "none" : "rotate(180deg)" }} />}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: t.text }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: t.sub, marginTop: 2 }}>{subtitle}</div>}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {extra}
        {value !== undefined && <span style={{ fontSize: 13.5, fontWeight: 700, color: valueColor || t.text }}>{value}</span>}
        {leftIcon && (
          <span style={{ width: 36, height: 36, borderRadius: 10, background: leftColor, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
            {leftIcon}
          </span>
        )}
      </div>
    </div>
  );
}
function EmptyRow({ text }) { const t = useT(); return <div style={{ padding: "16px 4px", textAlign: "center", color: t.sub, fontSize: 13 }}>{text}</div>; }
function AddLink({ text, onClick }) { return <div onClick={onClick} style={{ padding: "10px 4px", color: BRAND.header, fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "center" }}>{text}</div>; }
function SectionTitle({ text }) { const t = useT(); return <div style={{ fontWeight: 700, fontSize: 14, color: t.text, margin: "6px 4px 10px" }}>{text}</div>; }
function StatusBadge({ text, color }) { return <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: color, padding: "3px 9px", borderRadius: 20 }}>{text}</span>; }

function pillStyle(active) {
  return { flex: 1, padding: "8px 4px", borderRadius: 8, border: `1.5px solid ${active ? BRAND.header : "#ccc4d8"}`, background: active ? BRAND.header : "transparent", color: active ? "#fff" : "inherit", cursor: "pointer", fontWeight: 700, fontSize: 13 };
}
function useStyles() {
  const t = useT();
  return {
    input: { width: "100%", padding: "10px 12px", borderRadius: 9, border: `1.5px solid ${t.inputBorder}`, marginBottom: 10, fontSize: 14, outline: "none", background: t.input, color: t.text },
    primaryBtn: { width: "100%", padding: "11px", borderRadius: 9, border: "none", background: BRAND.fab, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" },
    label: { display: "block", fontSize: 12.5, color: t.sub, fontWeight: 600, marginBottom: 6 },
    card: { background: t.card, borderRadius: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" },
  };
}

/* ---------------------------------------------------------
   Amount input — shows a live thousands separator (۱٬۲۳۴٬۵۶۷)
   while typing; the value passed to onChange is always the plain
   numeric string (no commas), so nothing downstream needs to change.
--------------------------------------------------------- */
function AmountInput({ value, onChange, placeholder, style }) {
  const display = value ? Number(value).toLocaleString("en-US") : "";
  return (
    <KeypadInput
      kind="amount"
      value={value}
      display={display}
      onChange={(e) => onChange(String(e.target.value || "").replace(/[^0-9]/g, ""))}
      placeholder={placeholder}
      style={{ ...style, direction: "ltr", textAlign: "right" }}
    />
  );
}

/* ---------------------------------------------------------
   ماشین‌حساب داخل برنامه: به‌جای صفحه‌کلید گوشی، برای ورود اعداد باز می‌شود.
   kind = "amount" (ماشین‌حساب کامل برای مبلغ) | "digits" (فقط ارقام) | "decimal" (ارقام و اعشار)
--------------------------------------------------------- */
// پنجره‌های پایین‌صفحه (ماشین‌حساب، انتخاب حساب) مستقیم داخل body رسم می‌شوند تا هیچ پنجره‌ی دیگری یا منوی پایین روی آن‌ها نیفتد
const toBody = (node) => (typeof document !== "undefined" && document.body ? createPortal(node, document.body) : node);
function evalCalc(expr) {
  const tokens = String(expr).match(/\d+\.?\d*|\.\d+|[+\-×÷]/g);
  if (!tokens) return null;
  const nums = [], ops = [];
  let expectNum = true, sign = 1;
  for (const tk of tokens) {
    if (/^[+\-×÷]$/.test(tk)) {
      if (expectNum) { if (tk === "-") sign = -sign; else if (tk !== "+") return null; continue; }
      ops.push(tk); expectNum = true;
    } else { nums.push(sign * parseFloat(tk)); sign = 1; expectNum = false; }
  }
  if (!nums.length) return null;
  while (ops.length >= nums.length) ops.pop();
  const outN = [nums[0]], outO = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i], bb = nums[i + 1];
    if (op === "×") outN[outN.length - 1] *= bb;
    else if (op === "÷") { if (bb === 0) return null; outN[outN.length - 1] /= bb; }
    else { outO.push(op); outN.push(bb); }
  }
  let r = outN[0];
  outO.forEach((op, i) => { r = op === "+" ? r + outN[i + 1] : r - outN[i + 1]; });
  return Number.isFinite(r) ? r : null;
}
function NumKeypadSheet({ title, initial = "", kind = "amount", limit, onDone, onClose }) {
  const t = useT();
  const dark = t.card === THEME.dark.card;
  const calc = kind === "amount";
  const dot = kind === "amount" || kind === "decimal";
  const [expr, setExpr] = useState(String(initial || ""));
  const [fresh, setFresh] = useState(!!initial);
  const [bad, setBad] = useState(false);
  useEffect(() => { // دکمه‌ی بازگشت گوشی ابتدا همین ماشین‌حساب را می‌بندد
    const h = () => onClose();
    (window.__rexaBack = window.__rexaBack || []).push(h);
    return () => { window.__rexaBack = (window.__rexaBack || []).filter((x) => x !== h); };
  }, []);
  const blue = dark ? "#8fb0ff" : "#2f5fe0";
  const lastNum = (e) => (e.match(/[0-9.]*$/) || [""])[0];
  function press(k) {
    setBad(false);
    if (k === "C") { setExpr(""); setFresh(false); return; }
    if (k === "⌫") { setExpr((e) => (fresh ? "" : e.slice(0, -1))); setFresh(false); return; }
    if (k === "=") { const r = evalCalc(expr); if (r === null) { setBad(true); return; } setExpr(String(Math.round(r * 1e6) / 1e6)); setFresh(true); return; }
    if (/^[+\-×÷]$/.test(k)) {
      if (!calc) return;
      setExpr((e) => { if (!e) return k === "-" ? "-" : e; return /[+\-×÷]$/.test(e) ? e.slice(0, -1) + k : e + k; });
      setFresh(false); return;
    }
    setExpr((e) => {
      const base = fresh ? "" : e;
      if (k === ".") { if (!dot || lastNum(base).includes(".")) return base; return base === "" || /[+\-×÷]$/.test(base) ? base + "0." : base + "."; }
      const add = k === "000" ? (calc && lastNum(base) !== "" && lastNum(base) !== "0" && !lastNum(base).includes(".") ? "000" : "") : k;
      if (!add) return base;
      if (!calc && limit && base.length + add.length > limit) return base;
      if ((calc || kind === "decimal") && lastNum(base) === "0") return base.slice(0, -1) + add; // صفر ابتدایی فقط در اعداد حذف می‌شود، نه در شماره‌ها
      return base + add;
    });
    setFresh(false);
  }
  function confirm() {
    if (calc) {
      if (!expr) { onDone(""); return; }
      const r = evalCalc(expr);
      if (r === null) { setBad(true); return; }
      onDone(String(Math.max(0, Math.round(r))));
    } else onDone(expr.replace(/\.$/, ""));
  }
  const pretty = calc
    ? expr.replace(/\d+(\.\d*)?/g, (m) => { const [i, d] = m.split("."); return Number(i).toLocaleString("en-US") + (d !== undefined ? "." + d : ""); })
    : expr;
  const hasOp = calc && /\d[+\-×÷]\d/.test(expr.replace(/^-/, ""));
  const preview = hasOp ? evalCalc(expr) : null;
  const rows = calc
    ? [["C", "⌫", "÷", "×"], ["7", "8", "9", "-"], ["4", "5", "6", "+"], ["1", "2", "3", "="], ["000", "0", ".", "OK"]]
    : [["7", "8", "9"], ["4", "5", "6"], ["1", "2", "3"], [dot ? "." : "C", "0", "⌫"]];
  const keyStyle = (k) => {
    const isOp = /^[+\-×÷=]$/.test(k), isFn = k === "C" || k === "⌫";
    return { height: 54, border: "none", borderRadius: 13, fontSize: k === "OK" ? 15 : 21, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
      background: k === "OK" ? "linear-gradient(160deg, #62a8ff 0%, #2f62f0 100%)" : isOp ? (dark ? "rgba(143,176,255,.18)" : "rgba(47,95,224,.10)") : isFn ? (dark ? "rgba(255,120,120,.16)" : "rgba(214,60,60,.09)") : t.input,
      color: k === "OK" ? "#fff" : isOp ? blue : isFn ? "#d63c3c" : t.text };
  };
  return toBody(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.42)", zIndex: 600, display: "flex", alignItems: "flex-end", justifyContent: "center", maxWidth: 480, margin: "0 auto", fontFamily: FONT }}>
      <div onClick={(e) => e.stopPropagation()} dir="ltr" style={{ width: "100%", background: t.card, borderRadius: "20px 20px 0 0", padding: "14px 14px calc(14px + env(safe-area-inset-bottom, 0px))", boxShadow: "0 -8px 30px rgba(0,0,0,.2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <button onClick={onClose} aria-label="بستن" style={{ background: "none", border: "none", color: t.sub, padding: 4, cursor: "pointer", display: "flex" }}><X size={22} /></button>
          <div dir="rtl" style={{ fontSize: 12.5, color: t.sub, fontWeight: 600, maxWidth: "80%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title || "ورود عدد"}</div>
        </div>
        <div style={{ background: t.input, borderRadius: 14, padding: "10px 14px", marginBottom: 12, minHeight: 78, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", border: `1.5px solid ${bad ? "#d63c3c" : t.inputBorder}` }}>
          <div style={{ fontSize: 13, color: bad ? "#d63c3c" : t.sub, minHeight: 18, direction: "ltr" }}>{bad ? "عبارت نامعتبر است" : preview !== null && preview !== undefined ? `= ${(Math.round(preview * 1e6) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 })}` : ""}</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: t.text, direction: "ltr", wordBreak: "break-all", textAlign: "right", lineHeight: 1.3 }}>{(pretty || "0").replace(/-/g, "−")}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${rows[0].length}, 1fr)`, gap: 8 }}>
          {rows.flat().map((k) => (
            <button key={k} onClick={() => (k === "OK" ? confirm() : press(k))} aria-label={k === "OK" ? "تأیید" : k}
              style={keyStyle(k)}>{k === "OK" ? "تأیید" : k === "-" ? "−" : k}</button>
          ))}
        </div>
        {!calc && <button onClick={confirm} aria-label="تأیید" style={{ ...keyStyle("OK"), width: "100%", marginTop: 8 }}>تأیید</button>}
      </div>
    </div>
  );
}
function KeypadInput({ kind = "digits", value, onChange, placeholder, style, maxLength, digitsMax, display, ...rest }) {
  const [open, setOpen] = useState(false);
  const raw = value == null ? "" : String(value);
  const initial = kind === "digits" ? raw.replace(/\D/g, "") : raw;
  return (
    <>
      <input {...rest} readOnly inputMode="none" value={display ?? raw} placeholder={placeholder} style={{ ...style, cursor: "pointer" }}
        onClick={() => setOpen(true)} onFocus={(e) => { try { e.target.blur(); } catch {} setOpen(true); }} />
      {open && <NumKeypadSheet title={placeholder} initial={initial} kind={kind} limit={digitsMax ?? maxLength}
        onClose={() => setOpen(false)} onDone={(v) => { setOpen(false); onChange?.({ target: { value: v } }); }} />}
    </>
  );
}

/* ---------------------------------------------------------
   Header + BottomNav
--------------------------------------------------------- */
function Header({ title = "Rexa", onMenu, back, onBack, onMic }) {
  return <div style={{ background: BRAND.header, color: "#fff", padding: "calc(env(safe-area-inset-top, 0px) + 10px) 12px 10px", display: "grid", gridTemplateColumns: "42px 1fr 76px", alignItems: "center", position: "sticky", top: 0, zIndex: 80 }}>
    <div style={{ display: "flex", justifyContent: "flex-start" }}>{back ? <button onClick={onBack} style={iconBtn}><ChevronRight size={24} /></button> : <button onClick={onMenu} style={iconBtn} aria-label="منوی برنامه"><Menu size={24} /></button>}</div>
    <div style={{ textAlign: "center", fontWeight: 800, fontSize: 17, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
    <div style={{ display: "flex", justifyContent: "flex-end" }}>{onMic && <VoiceCaptureButton onResult={onMic} />}</div>
  </div>;
}
const iconBtn = { background: "none", border: "none", color: "#fff", cursor: "pointer" };

function VoiceCaptureButton({ onResult, dark }) {
  const [listening, setListening] = useState(false);
  const isNative = typeof Capacitor !== "undefined" && Capacitor.isNativePlatform && Capacitor.isNativePlatform();

  async function startNative() {
    try {
      setListening(true);
      try { await SpeechRecognition.requestPermissions(); } catch { /* some versions prompt inside start() instead */ }
      const result = await SpeechRecognition.start({
        language: "fa-IR", maxResults: 1, prompt: "چی می‌خوای ثبت کنی؟", partialResults: false, popup: true,
      });
      setListening(false);
      const transcript = result?.matches?.[0];
      if (transcript) onResult(transcript);
      else alert("چیزی شنیده نشد، دوباره امتحان کن.");
    } catch (e) {
      setListening(false);
      alert("مشکلی در تشخیص گفتار پیش اومد. دوباره امتحان کن یا از دکمه‌ی سه‌بار لمس صفحه برای ثبت متنی استفاده کن.");
    }
  }

  function startWeb() {
    const Rec = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!Rec) {
      alert("تشخیص گفتار روی این مرورگر پشتیبانی نمی‌شود. وقتی برنامه به‌صورت APK نصب بشه، از تشخیص گفتار واقعی گوشی استفاده می‌کنه. فعلاً می‌تونی از دکمه سه‌بار لمس صفحه برای ثبت متنی استفاده کنی.");
      return;
    }
    const rec = new Rec();
    rec.lang = "fa-IR";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.onresult = (e) => {
      const transcript = e.results?.[0]?.[0]?.transcript;
      if (transcript) onResult(transcript);
    };
    try { rec.start(); } catch { setListening(false); }
  }

  function start() { if (isNative) startNative(); else startWeb(); }

  return (
    <button onClick={start} style={{ ...iconBtn, color: dark ? (listening ? BRAND.orange : BRAND.header) : (listening ? "#ffd166" : "#fff") }} title="ثبت با صدا">
      <Mic size={20} />
    </button>
  );
}

function BottomNav({ active, setActive, onAdd, hidden = false }) {
  const t = useT();
  const dark = t.card === THEME.dark.card;
  // وقتی صفحه‌کلید باز می‌شود و ارتفاع صفحه کم می‌شود، منو بالای کیبورد نمی‌آید؛ همان ته صفحه (زیر کیبورد) می‌ماند
  const [kbShift, setKbShift] = useState(0);
  useEffect(() => {
    let maxH = window.innerHeight, w = window.innerWidth;
    const upd = () => {
      if (window.innerWidth !== w) { w = window.innerWidth; maxH = window.innerHeight; }
      maxH = Math.max(maxH, window.innerHeight);
      const d = maxH - window.innerHeight;
      setKbShift(d > 120 ? d : 0);
    };
    window.addEventListener("resize", upd);
    window.visualViewport?.addEventListener("resize", upd);
    return () => { window.removeEventListener("resize", upd); window.visualViewport?.removeEventListener("resize", upd); };
  }, []);
  // ترتیب از چپ به راست: گزارش‌ها، تراکنش‌ها، (ثبت سریع)، چک‌ها، خانه — بدون هیچ کادر؛ آیکن‌های سه‌بعدی
  const items = [
    { key: "reports", label: "گزارش‌ها", icon: PieChartIcon },
    { key: "transactions", label: "تراکنش‌ها", icon: Receipt },
    { key: "__add", label: "ثبت سریع", icon: Repeat },
    { key: "checks", label: "چک‌ها", icon: FileSpreadsheet },
    { key: "home", label: "خانه", icon: HomeIcon },
  ];
  if (hidden) return null;
  return (
    <div dir="ltr" style={{ position: "fixed", left: 0, right: 0, bottom: 0, maxWidth: 480, margin: "0 auto", zIndex: 300, background: "transparent", border: "none", boxShadow: "none", transform: kbShift ? `translateY(${kbShift}px)` : "none", pointerEvents: "none", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", alignItems: "end", padding: "18px calc(4px + env(safe-area-inset-right, 0px)) calc(6px + env(safe-area-inset-bottom, 0px)) calc(4px + env(safe-area-inset-left, 0px))" }}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          {Object.entries(NAV3D).map(([k, c]) => (
            <linearGradient key={k} id={`nav3d-${k}`} gradientUnits="userSpaceOnUse" x1="4" y1="0" x2="20" y2="24">
              <stop offset="0" stopColor={c.c1} /><stop offset="1" stopColor={c.c2} />
            </linearGradient>
          ))}
        </defs>
      </svg>
      {items.map((it) => <NavBtn key={it.key} it={it} isActive={it.key !== "__add" && active === it.key} onClick={it.key === "__add" ? onAdd : () => setActive(it.key)} dark={dark} />)}
    </div>
  );
}
// رنگ هر آیکن سه‌بعدی: روشن، تیره، و رنگ ضخامت (عمق)
const NAV3D = {
  reports: { c1: "#c4a6ff", c2: "#7c3aed", side: "#4c1d95" },
  transactions: { c1: "#7cc0ff", c2: "#1d6fd8", side: "#12408a" },
  __add: { c1: "#ff9db9", c2: "#e11d5a", side: "#8f0f3a" },
  checks: { c1: "#ffd77a", c2: "#f59e0b", side: "#98590a" },
  home: { c1: "#7ee8c0", c2: "#059669", side: "#065f46" },
};
const NAV_BTN_RESET = { background: "none", border: "none", outline: "none", boxShadow: "none", WebkitTapHighlightColor: "transparent", appearance: "none", WebkitAppearance: "none", padding: 0, margin: 0, height: 66, pointerEvents: "auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 2, cursor: "pointer", fontFamily: "inherit", userSelect: "none" };
function NavBtn({ it, isActive, onClick, dark }) {
  const Icon = it.icon; const c = NAV3D[it.key];
  const big = it.key === "__add";
  const size = big ? 40 : isActive ? 35 : 31;
  const depth = isActive || big ? 5 : 3;
  const g = `url(#nav3d-${it.key})`;
  const common = { size, strokeWidth: big ? 2.6 : 2.3, strokeLinecap: "round", strokeLinejoin: "round" };
  return (
    <button onClick={onClick} aria-label={it.label} style={{ ...NAV_BTN_RESET, opacity: isActive || big || true ? 1 : 1 }}>
      <span style={{ position: "relative", width: size, height: size + depth, display: "block", transform: `perspective(260px) rotateX(${isActive || big ? 14 : 9}deg) translateY(${isActive ? -4 : 0}px)`, transformOrigin: "50% 100%", transition: "transform .2s ease", filter: `drop-shadow(0 ${isActive || big ? 7 : 4}px ${isActive || big ? 7 : 4}px rgba(0,0,0,${dark ? 0.55 : 0.28}))`, opacity: isActive || big ? 1 : 0.88 }}>
        {Array.from({ length: depth }, (_, i) => depth - i).map((d) => (
          <Icon key={d} {...common} color={c.side} fill={c.side} fillOpacity={0.9} style={{ position: "absolute", left: 0, top: d }} />
        ))}
        <Icon {...common} color={g} stroke={g} fill={g} fillOpacity={0.32} style={{ position: "absolute", left: 0, top: 0 }} />
      </span>
      <span style={{ fontSize: 11, fontWeight: isActive ? 800 : 600, marginTop: 2, color: isActive ? c.c2 : (dark ? "#b7c0d6" : "#5b6785"), textShadow: dark ? "0 0 5px rgba(0,0,0,.9)" : "0 0 5px rgba(255,255,255,.95), 0 0 9px rgba(255,255,255,.8)" }}>{it.label}</span>
    </button>
  );
}

/* ---------------------------------------------------------
   Lock screen
--------------------------------------------------------- */
/* ---------------------------------------------------------
   همگام‌سازی ابری با گیت‌هاب: داده‌ها با رمز شما (AES-GCM) رمزنگاری می‌شوند و
   به‌صورت یک فایل در ریپوی گیت‌هابِ خودتان ذخیره می‌شوند. سرور = GitHub.
   توکن و رمز فقط روی همین دستگاه می‌مانند و داخل پشتیبان/فایل همگام‌سازی نمی‌روند.
--------------------------------------------------------- */
const SYNC_CFG_KEY = "rexa:sync";
const SYNC_PATH = "rexa-data.enc.json";
const APP_BUILD = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_BUILD_NUMBER) || "";
const APP_REPO = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_GITHUB_REPO) || "";
const emptySyncCfg = () => ({ token: "", repo: "", pass: "", auto: true, lastSha: "", lastHash: "", lastAt: "", device: "" });
function loadSyncCfg() {
  try { const raw = JSON.parse(localStorage.getItem(SYNC_CFG_KEY) || "{}"); const c = { ...emptySyncCfg(), ...raw, token: "", pass: "" }; if (!c.device) c.device = uid(); return c; } catch { return { ...emptySyncCfg(), device: uid(), token: "", pass: "" }; }
}
const b64 = (bytes) => { let s = ""; const a = new Uint8Array(bytes); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
const utf8b64 = (text) => b64(new TextEncoder().encode(text));
const b64utf8 = (str) => new TextDecoder().decode(unb64(str.replace(/\s/g, "")));
function hashText(str) { let h1 = 0xdeadbeef, h2 = 0x41c6ce57; for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909); return `${str.length}-${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}`; }
async function aesKey(pass, salt, iter) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encryptSnapshot(obj, pass, meta = {}) {
  const iter = 200000, salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(pass, salt, iter);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return JSON.stringify({ app: "rexa", v: 1, kdf: "PBKDF2-SHA256", iter, salt: b64(salt), iv: b64(iv), ct: b64(ct), updatedAt: new Date().toISOString(), ...meta });
}
async function decryptSnapshot(text, pass) {
  let env; try { env = JSON.parse(text); } catch { throw new Error("BAD_FILE"); }
  if (env.app !== "rexa" || !env.ct) throw new Error("BAD_FILE");
  try {
    const key = await aesKey(pass, unb64(env.salt), env.iter || 200000);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(env.iv) }, key, unb64(env.ct));
    return { data: JSON.parse(new TextDecoder().decode(pt)), meta: env };
  } catch { throw new Error("BAD_PASS"); }
}
async function ghFetch(cfg, method, path, body, raw) {
  const url = `https://api.github.com${path}`;
  const headers = { Authorization: `Bearer ${cfg.token}`, Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (body) headers["Content-Type"] = "application/json";
  let status, data;
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.request({ url, method, headers, data: body, connectTimeout: 15000, readTimeout: 30000, responseType: raw ? "text" : "json" });
    status = r.status; data = r.data;
  } else {
    const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    status = r.status; data = raw && r.ok ? await r.text() : await r.json().catch(() => ({}));
  }
  if (typeof data === "string" && !raw) { try { data = JSON.parse(data); } catch {} }
  return { status, data };
}
const ghErr = (r) => { const e = new Error(r.data?.message || `HTTP ${r.status}`); e.status = r.status; return e; };
async function ghGetFile(cfg) {
  const path = `/repos/${cfg.repo}/contents/${SYNC_PATH}`;
  const r = await ghFetch(cfg, "GET", path);
  if (r.status === 404) return { exists: false };
  if (r.status !== 200) throw ghErr(r);
  let text = r.data.content && r.data.encoding === "base64" ? b64utf8(r.data.content) : null;
  if (text === null || (r.data.size > 0 && !text)) { const r2 = await ghFetch(cfg, "GET", path, null, true); if (r2.status !== 200) throw ghErr(r2); text = typeof r2.data === "string" ? r2.data : JSON.stringify(r2.data); }
  return { exists: true, sha: r.data.sha, text };
}
async function ghPutFile(cfg, text, sha) {
  const r = await ghFetch(cfg, "PUT", `/repos/${cfg.repo}/contents/${SYNC_PATH}`, { message: `Rexa sync ${new Date().toISOString()}`, content: utf8b64(text), ...(sha ? { sha } : {}) });
  if (r.status !== 200 && r.status !== 201) throw ghErr(r);
  return r.data?.content?.sha || "";
}
async function ghRepoInfo(cfg) {
  const r = await ghFetch(cfg, "GET", `/repos/${cfg.repo}`);
  if (r.status !== 200) throw ghErr(r);
  return { isPrivate: !!r.data.private, canPush: r.data.permissions ? !!r.data.permissions.push : true };
}
function syncErrorText(e) {
  const m = String(e?.message || e);
  if (m === "BAD_PASS") return "رمز همگام‌سازی با داده‌ی روی گیت‌هاب نمی‌خواند.";
  if (m === "BAD_FILE") return "فایل روی گیت‌هاب فایل Rexa نیست.";
  if (e?.status === 401) return "توکن نامعتبر یا منقضی است.";
  if (e?.status === 403) return "دسترسی توکن کافی نیست (باید Contents: Read and write باشد) یا محدودیت گیت‌هاب.";
  if (e?.status === 404) return "ریپو پیدا نشد یا توکن به آن دسترسی ندارد.";
  if (e?.status === 409 || e?.status === 422) return "تعارض در ذخیره؛ دوباره تلاش کنید.";
  if (/network|failed to fetch|timeout|load failed/i.test(m)) return "اتصال اینترنت برقرار نیست.";
  return `خطا: ${m.slice(0, 120)}`;
}
// باز کردن لینک دانلود در مرورگر گوشی (داخل WebView برنامه، window.open کاری نمی‌کند)
async function openExternalUrl(url) {
  if (!url) return;
  try { if (Capacitor.isNativePlatform()) { await Browser.open({ url }); return; } } catch {}
  try { window.location.href = url; } catch {}
}
let _updErr = "";
async function rawGet(url, accept) {
  if (Capacitor.isNativePlatform()) { const r = await CapacitorHttp.get({ url, headers: { Accept: accept, "Cache-Control": "no-cache" }, connectTimeout: 8000, readTimeout: 12000 }); return { status: r.status, data: r.data, url: r.url }; }
  const r = await fetch(url, { headers: { Accept: accept } }); return { status: r.status, data: accept.includes("json") ? await r.json().catch(() => ({})) : null, url: r.url };
}
// آخرین نسخه‌ی منتشرشده: اول API گیت‌هاب، اگر نشد خود صفحه‌ی releases/latest (بدون محدودیت API)
async function checkLatestRelease(repo) {
  _updErr = "";
  try {
    const r = await rawGet(`https://api.github.com/repos/${repo}/releases/latest?t=${Date.now()}`, "application/vnd.github+json");
    const data = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
    if (r.status === 200 && data) {
      const n = Number(String(data.tag_name || "").replace(/\D/g, ""));
      const apk = (data.assets || []).find((x) => /\.apk$/i.test(x.name));
      return { build: n, name: data.name || data.tag_name, url: apk?.browser_download_url || data.html_url, page: data.html_url };
    }
    _updErr = `API ${r.status}`;
  } catch (e) { _updErr = `API ${e?.message || e}`; }
  try {
    const r = await rawGet(`https://github.com/${repo}/releases/latest`, "text/html");
    const m = String(r.url || "").match(/\/releases\/tag\/([^/?#]+)/);
    if (r.status === 200 && m) {
      const tag = decodeURIComponent(m[1]); const n = Number(tag.replace(/\D/g, ""));
      return { build: n, name: `Rexa build ${n}`, url: `https://github.com/${repo}/releases/download/${tag}/Rexa-build-${n}.apk`, page: `https://github.com/${repo}/releases/tag/${tag}` };
    }
    _updErr += ` | صفحه ${r.status}`;
  } catch (e) { _updErr += ` | صفحه ${e?.message || e}`; }
  return null;
}

const SYNC_DEBOUNCE_MS = 20000;
const syncReady = (c) => !!(c.token && /^[\w.-]+\/[\w.-]+$/.test(c.repo || "") && (c.pass || "").length >= 8);
const localSnapshotHash = (snap) => { const { exportedAt, ...rest } = snap || {}; return hashText(JSON.stringify(rest)); };
// منطق همگام‌سازی: getSnapshot() داده‌ی فعلی را می‌دهد، applySnapshot(data) داده‌ی دریافتی را جایگزین می‌کند
function useGithubSync({ loaded, getSnapshot, applySnapshot, deps }) {
  const [cfg, setCfg] = useState(loadSyncCfg);
  const cfgRef = useRef(cfg);
  const [state, setState] = useState({ busy: false, msg: null, conflict: null });
  const busy = useRef(false);
  const timer = useRef(null);
  const started = useRef(false);
  const secretsLoaded = useRef(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [tok, pass] = await Promise.all([secureGet("rexa.github.token"), secureGet("rexa.github.pass")]);
        if (!alive) return;
        const token = tok?.value || ""; const syncPass = pass?.value || "";
        const next = { ...cfgRef.current, token, pass: syncPass };
        cfgRef.current = next; setCfg(next); secretsLoaded.current = true;
      } catch { secretsLoaded.current = true; }
    })();
    return () => { alive = false; };
  }, []);
  const saveCfg = (patch) => {
    const next = { ...cfgRef.current, ...patch };
    cfgRef.current = next; setCfg(next);
    const safe = { ...next, token: undefined, pass: undefined };
    delete safe.token; delete safe.pass;
    try { localStorage.setItem(SYNC_CFG_KEY, JSON.stringify(safe)); } catch {}
    if (patch.token !== undefined) secureSet("rexa.github.token", patch.token).catch(() => {});
    if (patch.pass !== undefined) secureSet("rexa.github.pass", patch.pass).catch(() => {});
    return next;
  };
  const fail = (e) => setState((x) => ({ ...x, busy: false, msg: { ok: false, text: syncErrorText(e) } }));
  const remoteInfo = (text) => { try { const m = JSON.parse(text); return { updatedAt: m.updatedAt, device: m.device }; } catch { return {}; } };

  async function runSync(mode, { force = false } = {}) {
    const c = cfgRef.current;
    if (!syncReady(c) || busy.current) return;
    busy.current = true; setState((x) => ({ ...x, busy: true, msg: null }));
    try {
      const remote = await ghGetFile(c);
      const snap = getSnapshot(); const hash = localSnapshotHash(snap);
      const localDirty = hash !== c.lastHash;
      const remoteChanged = remote.exists && remote.sha !== c.lastSha;
      let action = mode;
      if (mode === "auto") action = !remote.exists ? "push" : !remoteChanged ? (localDirty ? "push" : "none") : (c.lastSha && !localDirty ? "pull" : "conflict");
      else if (mode === "push" && remoteChanged && !force) action = "conflict";
      if (action === "conflict") { setState({ busy: false, msg: null, conflict: { ...remoteInfo(remote.text), sha: remote.sha } }); return; }
      if (action === "none") { setState({ busy: false, conflict: null, msg: { ok: true, text: "همه‌چیز با گیت‌هاب یکی است." } }); return; }
      if (action === "pull") {
        if (!remote.exists) { setState({ busy: false, conflict: null, msg: { ok: false, text: "هنوز داده‌ای در گیت‌هاب ذخیره نشده است." } }); return; }
        const { data } = await decryptSnapshot(remote.text, c.pass);
        applySnapshot(data);
        saveCfg({ lastSha: remote.sha, lastAt: new Date().toISOString() });
        setTimeout(() => { saveCfg({ lastHash: localSnapshotHash(getSnapshot()) }); }, 1500);
        setState({ busy: false, conflict: null, msg: { ok: true, text: "داده‌ها از گیت‌هاب دریافت شد." } });
        return;
      }
      const text = await encryptSnapshot(snap, c.pass, { device: c.device, build: APP_BUILD });
      const sha = await ghPutFile(c, text, remote.exists ? remote.sha : undefined);
      saveCfg({ lastSha: sha, lastHash: hash, lastAt: new Date().toISOString() });
      setState({ busy: false, conflict: null, msg: { ok: true, text: "داده‌ها (رمزگذاری‌شده) در گیت‌هاب ذخیره شد." } });
    } catch (e) { fail(e); }
    finally { busy.current = false; }
  }
  // اتصال: ابتدا ریپو و دسترسی بررسی می‌شود؛ ریپوی عمومی پذیرفته نمی‌شود
  async function connect(patch) {
    const next = { ...cfgRef.current, ...patch, token: (patch.token || "").trim(), repo: (patch.repo || "").trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "") };
    if (!syncReady(next)) { setState((x) => ({ ...x, msg: { ok: false, text: "توکن، نام ریپو به شکل «نام‌کاربری/نام‌ریپو» و رمز همگام‌سازی (حداقل ۸ نویسه) لازم است." } })); return false; }
    if (typeof crypto === "undefined" || !crypto.subtle) { setState((x) => ({ ...x, msg: { ok: false, text: "رمزنگاری در این محیط در دسترس نیست." } })); return false; }
    setState((x) => ({ ...x, busy: true, msg: null }));
    try {
      const info = await ghRepoInfo(next);
      if (!info.isPrivate) { setState((x) => ({ ...x, busy: false, msg: { ok: false, text: "این ریپو عمومی است. برای اطلاعات مالی فقط ریپوی «خصوصی (Private)» مجاز است." } })); return false; }
      if (!info.canPush) { setState((x) => ({ ...x, busy: false, msg: { ok: false, text: "توکن اجازه‌ی نوشتن در این ریپو را ندارد." } })); return false; }
    } catch (e) { fail(e); return false; }
    const changedTarget = next.repo !== cfgRef.current.repo || next.token !== cfgRef.current.token;
    saveCfg({ ...next, ...(changedTarget ? { lastSha: "", lastHash: "", lastAt: "" } : {}) });
    setState((x) => ({ ...x, busy: false }));
    await runSync("auto");
    return true;
  }
  async function disconnect() {
    clearTimeout(timer.current);
    await secureRemove("rexa.github.token").catch(() => {});
    await secureRemove("rexa.github.pass").catch(() => {});
    saveCfg({ token: "", pass: "", repo: "", lastSha: "", lastHash: "", lastAt: "" });
    setState({ busy: false, msg: { ok: true, text: "اتصال قطع شد و توکن از این گوشی پاک شد." }, conflict: null });
  }
  // همگام‌سازی خودکار: یک بار بعد از بارگذاری برنامه و ۲۰ ثانیه بعد از هر تغییر داده
  useEffect(() => {
    if (!loaded || started.current || !secretsLoaded.current) return;
    started.current = true;
    if (cfgRef.current.auto && syncReady(cfgRef.current)) runSync("auto");
  }, [loaded]);
  useEffect(() => {
    if (!loaded || !started.current) return;
    if (!cfgRef.current.auto || !syncReady(cfgRef.current)) return;
    clearTimeout(timer.current);
    // حالت auto فقط وقتی چیزی را می‌فرستد که داده‌ی این گوشی واقعاً با آخرین همگام‌سازی فرق داشته باشد
    timer.current = setTimeout(() => runSync("auto"), SYNC_DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, deps);
  return { cfg, state, runSync, connect, disconnect, setAuto: (auto) => saveCfg({ auto }) };
}

/* ---------------------------------------------------------
   امنیت رمز عددی: رمز هرگز به‌صورت متن ساده ذخیره نمی‌شود (هش + salt)،
   داخل فایل پشتیبان نمی‌رود و بعد از چند تلاش اشتباه موقتاً قفل می‌شود.
--------------------------------------------------------- */
const PIN_LOCK_KEY = "rexa:pinLock";
const PIN_FREE_TRIES = 5;
const withoutPin = (st = {}) => { const { pin, pinHash, pinSalt, ...rest } = st; return rest; };
const hexOf = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
async function derivePinHash(pin, salt, scheme) {
  if (scheme === "p1") {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: 120000, hash: "SHA-256" }, key, 256);
    return hexOf(bits);
  }
  // روش جایگزین وقتی crypto.subtle در دسترس نباشد
  const str = `${salt}:${pin}`;
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let r = 0; r < 3000; r++) for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}
async function makePinRecord(pin) {
  let salt = "";
  try { salt = hexOf(crypto.getRandomValues(new Uint8Array(16))); } catch { salt = Math.random().toString(16).slice(2) + Date.now().toString(16); }
  let scheme = typeof crypto !== "undefined" && crypto.subtle ? "p1" : "f1";
  let hash;
  try { hash = await derivePinHash(String(pin), salt, scheme); } catch { scheme = "f1"; hash = await derivePinHash(String(pin), salt, scheme); }
  return { pinHash: `${scheme}:${hash}`, pinSalt: salt };
}
async function verifyPin(input, { pin, pinHash, pinSalt }) {
  try {
    if (pinHash) {
      const [scheme, hash] = String(pinHash).split(":");
      return (await derivePinHash(String(input), pinSalt || "", scheme)) === hash;
    }
    if (pin) return String(input) === String(pin); // رمز قدیمی؛ بلافاصله بعد از ورود به هش تبدیل می‌شود
  } catch {}
  return false;
}
function readPinLock() {
  try { const v = JSON.parse(localStorage.getItem(PIN_LOCK_KEY) || "null"); return { fails: Number(v?.fails) || 0, until: Number(v?.until) || 0 }; } catch { return { fails: 0, until: 0 }; }
}
function clearPinLock() { try { localStorage.removeItem(PIN_LOCK_KEY); } catch {} }
function registerPinFail() {
  const fails = readPinLock().fails + 1;
  const until = fails >= PIN_FREE_TRIES ? Date.now() + Math.min(15 * 60, 30 * 2 ** (fails - PIN_FREE_TRIES)) * 1000 : 0;
  const next = { fails, until };
  try { localStorage.setItem(PIN_LOCK_KEY, JSON.stringify(next)); } catch {}
  return next;
}

/* ---------------------------------------------------------
   اعلان‌های واقعی سررسید (Android): چک، قبض، قسط وام و یادآوری‌ها
   ساعت ۹ صبح همان روز (و برای چک/قبض، قبل از سررسید) نمایش داده می‌شوند.
--------------------------------------------------------- */
const DUE_NOTIF_BASE = 710000000;
const DUE_NOTIF_MAX = 60;
function atNine(dateStr, daysBefore = 0) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3] - daysBefore, 9, 0, 0) : null;
}
async function rescheduleDueNotifications({ enabled, checks, bills, loans, reminders, checkDays }) {
  const pending = await LocalNotifications.getPending();
  const mine = (pending.notifications || []).filter((n) => n.id >= DUE_NOTIF_BASE && n.id < DUE_NOTIF_BASE + 1000);
  if (mine.length) await LocalNotifications.cancel({ notifications: mine.map((n) => ({ id: n.id })) });
  if (!enabled) return;
  const items = [];
  const push = (when, title, body) => {
    if (!when || isNaN(when.getTime())) return;
    const t = when.getTime();
    if (t > Date.now() + 10000 && t < Date.now() + 120 * 86400000) items.push({ when, title, body });
  };
  (checks || []).filter((c) => c.status === "pending" && c.dueDate).forEach((c) => {
    const what = `چک ${c.type === "received" ? "دریافتی" : "پرداختی"} ${c.payee || ""} — ${toFaInt(c.amount)} ریال`;
    if (checkDays > 0) push(atNine(c.dueDate, checkDays), "یادآوری سررسید چک", `${what} — ${toFaInt(checkDays)} روز دیگر سررسید می‌شود`);
    push(atNine(c.dueDate, 0), "امروز سررسید چک است", what);
  });
  (bills || []).filter((b) => !b.paid && b.dueDate).forEach((b) => {
    const what = `قبض ${b.title || ""}${b.amount ? ` — ${toFaInt(b.amount)} ریال` : ""}`;
    push(atNine(b.dueDate, 1), "یادآوری سررسید قبض", `${what} — فردا سررسید است`);
    push(atNine(b.dueDate, 0), "امروز سررسید قبض است", what);
  });
  (loans || []).filter((l) => l.startDate && l.paidCount < l.installments).forEach((l) => {
    const due = addMonths(l.startDate, l.paidCount);
    const what = `قسط ${l.title || "وام"}${l.monthlyPayment ? ` — ${toFaInt(l.monthlyPayment)} ریال` : ""}`;
    push(atNine(due, 1), "یادآوری سررسید قسط", `${what} — فردا سررسید است`);
    push(atNine(due, 0), "امروز سررسید قسط است", what);
  });
  (reminders || []).filter((r) => !r.done && r.date).forEach((r) => push(atNine(r.date, 0), "یادآوری Rexa", r.text || ""));
  const list = items.sort((a, b) => a.when - b.when).slice(0, DUE_NOTIF_MAX);
  if (!list.length) return;
  let perm = await LocalNotifications.checkPermissions();
  if (perm.display === "prompt" || perm.display === "prompt-with-rationale") perm = await LocalNotifications.requestPermissions();
  if (perm.display !== "granted") return;
  try { await LocalNotifications.createChannel({ id: "rexa-due", name: "سررسیدها و یادآوری‌ها", description: "چک، قبض، قسط و یادآوری‌ها", importance: 4, visibility: 1 }); } catch {}
  await LocalNotifications.schedule({
    notifications: list.map((it, i) => ({ id: DUE_NOTIF_BASE + i, title: it.title, body: it.body, schedule: { at: it.when }, channelId: "rexa-due" })),
  });
}

function LockScreen({ pin, pinHash, pinSalt, onUnlock, biometricEnabled }) {
  const [val, setVal] = useState("");
  const [err, setErr] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioChecked, setBioChecked] = useState(false);
  const isNative = typeof Capacitor !== "undefined" && Capacitor.isNativePlatform && Capacitor.isNativePlatform();
  const [now, setNow] = useState(Date.now());
  const [lock, setLock] = useState(() => readPinLock());
  const remaining = Math.max(0, Math.ceil(((lock.until || 0) - now) / 1000));
  useEffect(() => {
    if (!remaining) return;
    const tm = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(tm);
  }, [remaining > 0]);
  async function submitPin() {
    if (remaining > 0 || !val) return;
    if (await verifyPin(val, { pin, pinHash, pinSalt })) { clearPinLock(); onUnlock(); return; }
    setLock(registerPinFail()); setNow(Date.now()); setErr(true); setVal("");
  }

  async function tryBiometric() {
    if (!biometricEnabled || !isNative) { setBioChecked(true); return; }
    try {
      const info = await BiometricAuth.checkBiometry();
      setBioAvailable(!!info.isAvailable);
      if (info.isAvailable) {
        try {
          await BiometricAuth.authenticate({
            reason: "برای باز کردن Rexa هویتت رو تایید کن",
            cancelTitle: "لغو",
            allowDeviceCredential: true,
          });
          onUnlock();
          return;
        } catch { /* user cancelled or failed — fall back to PIN, shown below */ }
      }
    } catch { /* biometric not available on this device */ }
    setBioChecked(true);
  }
  useEffect(() => { tryBiometric(); /* eslint-disable-next-line */ }, []);

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: BRAND.header, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: FONT, color: "#fff", gap: 18, maxWidth: 480, margin: "0 auto" }}>
      <RexaLogo size={64} />
      <div style={{ fontWeight: 700, fontSize: 16 }}>Rexa قفل است</div>
      {biometricEnabled && isNative && bioAvailable && (
        <button onClick={tryBiometric} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, background: "none", border: "none", color: "#fff", cursor: "pointer" }}>
          <span style={{ width: 60, height: 60, borderRadius: "50%", background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}><Fingerprint size={30} /></span>
          <span style={{ fontSize: 12 }}>ورود با اثر انگشت</span>
        </button>
      )}
      <input
        type="password" inputMode="numeric" maxLength={6} value={val}
        onChange={(e) => { setVal(e.target.value.replace(/[^0-9]/g, "")); setErr(false); }}
        placeholder="رمز عبور"
        style={{ width: 180, textAlign: "center", fontSize: 22, letterSpacing: 6, padding: "10px", borderRadius: 10, border: "none", outline: "none" }}
      />
      {remaining > 0
        ? <div style={{ color: "#ffb3c1", fontSize: 13, textAlign: "center", maxWidth: 260 }}>تلاش ناموفق زیاد بود. {toFaInt(remaining)} ثانیه دیگر دوباره تلاش کنید.</div>
        : err && <div style={{ color: "#ffb3c1", fontSize: 13 }}>رمز اشتباه است</div>}
      <button onClick={submitPin} disabled={remaining > 0}
        style={{ background: BRAND.fab, color: "#fff", border: "none", borderRadius: 9, padding: "10px 30px", fontWeight: 700, cursor: "pointer", opacity: remaining > 0 ? 0.5 : 1 }}>
        باز کردن
      </button>
      {biometricEnabled && !isNative && bioChecked && (
        <div style={{ fontSize: 11.5, color: "#d8c9e8", marginTop: 6, maxWidth: 260, textAlign: "center" }}>
          قفل اثر انگشت فقط در نسخه‌ی نصب‌شده‌ی APK کار می‌کند؛ در این پیش‌نمایش وب فقط رمز عددی در دسترس است.
        </div>
      )}
    </div>
  );
}

/* ===========================================================
   MAIN APP
=========================================================== */
/* ---------------------------------------------------------
   Rexa logo — fantasy coin-and-monogram mark, matches the app icon.
   Pure inline SVG so it renders inside the app itself (header,
   splash, side menu) without needing an image asset.
--------------------------------------------------------- */
function RexaLogo({ size = 64, showWordmark = false }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <svg width={size} height={size} viewBox="0 0 200 200">
        <defs>
          <radialGradient id="rexaCoin" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#ffe9b0" />
            <stop offset="55%" stopColor="#ffd166" />
            <stop offset="100%" stopColor="#e8a83c" />
          </radialGradient>
          <linearGradient id="rexaRing" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffe6a0" />
            <stop offset="100%" stopColor="#e8951f" />
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r="96" fill="url(#rexaRing)" />
        <circle cx="100" cy="100" r="76" fill="url(#rexaCoin)" stroke="#c9863a" strokeWidth="3" />
        <circle cx="100" cy="100" r="62" fill="none" stroke="#d6a24a" strokeWidth="3" />
        <text x="100" y="128" textAnchor="middle" fontFamily="Georgia, serif" fontWeight="700" fontSize="86" fill={BRAND.header}>R</text>
        <g fill="#fff" opacity="0.9">
          <path d="M162 44 l6 14 14 6 -14 6 -6 14 -6 -14 -14 -6 14 -6 z" />
          <path d="M34 138 l4 9 9 4 -9 4 -4 9 -4 -9 -9 -4 9 -4 z" opacity="0.7" />
        </g>
      </svg>
      {showWordmark && (
        <div style={{ fontWeight: 800, fontSize: size * 0.3, color: "#fff", letterSpacing: 1, fontFamily: "Georgia, serif" }}>Rexa</div>
      )}
    </div>
  );
}

function normalizeCategoriesForHierarchy(list) {
  const out = Array.isArray(list) ? list.map(c => ({ ...c })) : [];
  const hasVehicle = out.some(c => c.kind === "expense" && c.name === "خودرو" && !c.parentId);
  const fuel = out.find(c => c.kind === "expense" && c.name === "بنزین" && !c.parentId);
  if (fuel && !hasVehicle) {
    const parent = { id: uid(), name: "خودرو", kind: "expense" };
    out.push(parent);
    fuel.parentId = parent.id;
  } else if (fuel && hasVehicle) {
    const parent = out.find(c => c.kind === "expense" && c.name === "خودرو" && !c.parentId);
    fuel.parentId = parent.id;
  }
  return out;
}

/* ---------------------------------------------------------
   اسکن برگه پوز: عکس برگه → خواندن نام پذیرنده، مبلغ، تاریخ و ساعت با هوش مصنوعی
   → پیش‌نویس هزینه (دسته‌بندی خودکار)؛ کاربر فقط حساب را انتخاب و ثبت می‌کند.
--------------------------------------------------------- */
function jalaliToGregorian(jy, jm, jd) {
  jy += 1595;
  let days = -355668 + (365 * jy) + (Math.floor(jy / 33) * 8) + Math.floor(((jy % 33) + 3) / 4) + jd + ((jm < 7) ? (jm - 1) * 31 : ((jm - 7) * 30) + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { gy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  let gd = days + 1;
  const sal = [0, 31, ((gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (; gm < 13 && gd > sal[gm]; gm++) gd -= sal[gm];
  return [gy, gm, gd];
}
// تاریخ چاپ‌شده روی برگه (شمسی یا میلادی) → YYYY-MM-DD میلادی؛ اگر نامعتبر بود null
function slipDateToISO(raw) {
  const m = toEnDigits(raw || "").match(/(\d{2,4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,4})/);
  if (!m) return null;
  let y, mo, d;
  if (m[1].length === 4 || +m[1] > 31) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if (m[3].length === 4 || +m[3] > 31) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else { y = 1400 + +m[1]; mo = +m[2]; d = +m[3]; }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  let g;
  if (y >= 1700) g = [y, mo, d];
  else if (y >= 1300 && y <= 1500) g = jalaliToGregorian(y, mo, d);
  else return null;
  const dt = new Date(Date.UTC(g[0], g[1] - 1, g[2]));
  if (dt.getUTCMonth() !== g[1] - 1) return null;                  // مثلا ۳۱ شهریور
  if (dt.getTime() > Date.now() + 2 * 86400000) return null;       // تاریخ آینده = خوانش اشتباه
  return `${g[0]}-${String(g[1]).padStart(2, "0")}-${String(g[2]).padStart(2, "0")}`;
}
function slipTimeToHHMM(raw) {
  const m = toEnDigits(raw || "").match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${String(+m[1]).padStart(2, "0")}:${m[2]}`;
}
// اگر هوش مصنوعی دسته‌بندی نداد، از روی نام فروشگاه حدس بزن
function guessExpenseCategoryId(categories, merchant) {
  const exp = categories.filter((c) => c.kind === "expense");
  const hay = String(merchant || "");
  const rules = [
    [/نان|نانوایی|بیکری|قنادی|شیرین|سوپر|مارکت|خوار|رستوران|کافه|کباب|پیتزا|ساندویچ|فست|میوه|سبزی|گوشت|مرغ|لبنی|قهوه|آبمیوه|ماهی|بستنی|چلو|برنج/, /خوراک|غذا|بازار|رستوران|سوپر/],
    [/بنزین|پمپ|سوخت|cng/i, /بنزین|سوخت|خودرو/],
    [/داروخانه|دارو|درمان|کلینیک|بیمارستان|دندان|آزمایش|پزشک/, /درمان|دارو|سلامت|بهداشت/],
    [/پوشاک|لباس|کفش|کیف|مزون/, /پوشاک|لباس/],
    [/تاکسی|اسنپ|تپسی|مترو|اتوبوس|بلیط/, /حمل|تاکسی|ایاب/],
  ];
  for (const [merchantRe, catRe] of rules) {
    if (!merchantRe.test(hay)) continue;
    const matches = exp.filter((c) => catRe.test(c.name));
    const leaf = matches.find((c) => !exp.some((x) => x.parentId === c.id));
    const pick = leaf || matches[0];
    if (pick) return pick.id;
  }
  return null;
}
/* --- خواندن برگه پوز: OCR کاملاً آفلاین و رایگان (Tesseract.js) ---
   موتور و دادهٔ زبان فارسی داخل خود برنامه است (public/ocr)؛ بدون اینترنت، بدون کلید API. */
let _ocrWorkerPromise = null;
let _ocrProgressCb = null;
let _ocrCoreIdx = 0;          // اگر هسته‌ی سریع روی گوشی بالا نیامد، به هسته‌ی ساده می‌رویم
let _ocrDiag = "";            // آخرین مرحله‌ی بارگذاری (برای نمایش در خطا)
const ocrUrl = (p) => new URL(`ocr/${p}`, document.baseURI).href;
// پشتیبانی WebAssembly SIMD (هسته‌ی «relaxed» عمداً استفاده نمی‌شود؛ روی بعضی WebViewها گیر می‌کند)
function ocrSimdOk() {
  try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch { return false; }
}
const ocrCores = () => ["tesseract-core-simd-lstm.wasm.js"];   // فقط هسته‌ی SIMD (حجم کمتر)؛ گوشی‌های امروزی همگی پشتیبانی می‌کنند
function getOcrWorker() {
  if (!_ocrWorkerPromise) {
    const core = ocrCores()[0];
    _ocrWorkerPromise = (async () => {
      _ocrDiag = "شروع";
      const [{ createWorker }, langMod] = await Promise.all([import("tesseract.js"), import("./ocrLangFas.js")]);
      _ocrDiag = "آماده‌سازی داده‌ی زبان";
      const fasData = Uint8Array.from(atob(langMod.default), (c) => c.charCodeAt(0));   // داده‌ی زبان داخل خود برنامه است
      return await createWorker([{ code: "fas", data: fasData }], 1, {
        workerPath: ocrUrl("worker.min.js"),
        corePath: ocrUrl(core),
        workerBlobURL: false,
        cacheMethod: "none",
        logger: (m) => { _ocrDiag = `${m.status} ${Math.round((m.progress || 0) * 100)}٪`; try { _ocrProgressCb?.(m); } catch {} },
      });
    })().catch((e) => { _ocrDiag = `${_ocrDiag} / ${e?.message || e}`; _ocrWorkerPromise = null; throw e; });
  }
  return _ocrWorkerPromise;
}
// عکس → بوم خاکستری با کنتراست کشیده‌شده (برای برگه‌های حرارتی کم‌رنگ)
function prepareSlipCanvas(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new window.Image();
      img.onerror = reject;
      img.onload = () => {
        const px = img.width * img.height, shortSide = Math.min(img.width, img.height);
        const scale = px > 1.2e6 ? Math.sqrt(1.2e6 / px) : shortSide < 600 ? Math.min(2, 600 / shortSide) : 1;   // حدود ۱ مگاپیکسل: خیلی سریع‌تر و برای برگه کافی
        const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const im = ctx.getImageData(0, 0, w, h), d = im.data, hist = new Uint32Array(256);
        for (let i = 0; i < d.length; i += 4) { const g = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114); d[i] = d[i + 1] = d[i + 2] = g; hist[g]++; }
        const total = w * h; let acc = 0, lo = 0, hi = 255;
        for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.01) { lo = v; break; } }
        acc = 0;
        for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.01) { hi = v; break; } }
        const span = Math.max(40, hi - lo);
        for (let i = 0; i < d.length; i += 4) { const g = Math.max(0, Math.min(255, Math.round(((d[i] - lo) * 255) / span))); d[i] = d[i + 1] = d[i + 2] = g; }
        ctx.putImageData(im, 0, 0);
        resolve(canvas);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

const SLIP_NOISE = /رسید|خرید|بانک|کارت|شماره|پیگیری|مرجع|ترمینال|پایانه|پذیرنده|مبلغ|تاریخ|ساعت|موفق|پرداخت|تراکنش|مانده|سپاس|تشکر|شاپرک|پوز|ریال|تومان|کد\b|www|http|pos\b/i;
const SLIP_NUM_SKIP = /مانده|موجودی|کارت|شماره|پیگیری|مرجع|ترمینال|پایانه|پذیرنده|سریال|کد|rrn|stan/i;
function slipNumbersIn(line) {
  const clean = line
    .replace(/\d{2,4}\s*[\/\-]\s*\d{1,2}\s*[\/\-]\s*\d{1,4}/g, " ")   // تاریخ
    .replace(/\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?/g, " ");            // ساعت
  const out = [];
  const re = /\d{1,3}(?:[,.\s]\d{3})+|\d+/g; let m;
  while ((m = re.exec(clean))) {
    const digits = m[0].replace(/[,.\s]/g, "");
    if (digits.length < 4 || digits.length > 11) continue;               // کوتاه‌تر از ۱۰۰۰ یا شبیه شماره کارت/پیگیری
    out.push(Number(digits));
  }
  return out;
}
// متن خام OCR → { merchant, amount, date, time, categoryId }
function parseSlipText(raw, categories) {
  const text = toEnDigits(String(raw || "")).replace(/[٬،]/g, ",").replace(/٫/g, ".");
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[|_~=*\u200c\u200f\u200e]+/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  // مبلغ
  let amount = 0;
  const KEY = /مبلغ|مبلع|مبل[غع]|amount|قابل\s*پرداخت|جمع\s*کل|خرید\s*[:：]/i;
  for (let i = 0; i < lines.length && !amount; i++) {
    if (!KEY.test(lines[i]) || /مانده|موجودی/.test(lines[i])) continue;
    const nums = slipNumbersIn(lines[i]); const next = lines[i + 1] ? slipNumbersIn(lines[i + 1]) : [];
    amount = nums[0] || next[0] || 0;
  }
  if (!amount) {
    const cands = [];
    lines.forEach((l) => { if (SLIP_NUM_SKIP.test(l)) return; slipNumbersIn(l).forEach((n) => cands.push({ n, hot: /ریال|تومان|rial/i.test(l) })); });
    const hot = cands.filter((c) => c.hot);
    const pool = hot.length ? hot : cands;
    if (pool.length) amount = Math.max(...pool.map((c) => c.n));
  }
  if (amount && /تومان/.test(text) && !/ریال/.test(text)) amount *= 10;
  // تاریخ و ساعت
  let date = null;
  for (const m of text.matchAll(/\d{2,4}\s*[\/\-.]\s*\d{1,2}\s*[\/\-.]\s*\d{1,4}/g)) { date = slipDateToISO(m[0]); if (date) break; }
  let time = null;
  for (const m of text.matchAll(/\d{1,2}\s*:\s*\d{2}/g)) { time = slipTimeToHHMM(m[0]); if (time) break; }
  // نام فروشگاه
  const cleanName = (v) => String(v || "").replace(/[^\u0600-\u06FFA-Za-z0-9\s\-\.]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  let merchant = "";
  for (let i = 0; i < lines.length && !merchant; i++) {
    const m = lines[i].match(/(?:نام\s*)?(?:پذیرنده|فروشگاه|فروشنده|واحد\s*صنفی|نام\s*واحد)\s*[:：]?\s*(.*)$/);
    if (m) { const cand = cleanName(m[1] || lines[i + 1] || ""); if (/[\u0600-\u06FF]{2,}/.test(cand) && !/^\d+$/.test(cand)) merchant = cand; }
  }
  if (!merchant) {
    for (const l of lines.slice(0, 10)) {
      const persian = (l.match(/[\u0600-\u06FF]/g) || []).length, digits = (l.match(/\d/g) || []).length;
      if (persian >= 3 && digits <= 2 && !SLIP_NOISE.test(l)) { merchant = cleanName(l); break; }
    }
  }
  return { merchant, amount: Math.round(amount) || 0, date, time, categoryId: guessExpenseCategoryId(categories, merchant) };
}
async function extractSlip(file, categories, onStatus) {
  _ocrProgressCb = (m) => {
    const st = m.status || "";
    if (st === "recognizing text") onStatus?.(`در حال خواندن متن... ${Math.round((m.progress || 0) * 100)}٪`);
    else if (/language/i.test(st)) onStatus?.("بارگذاری زبان فارسی...");
    else if (/load|init/i.test(st)) onStatus?.("آماده‌سازی موتور خواندن متن...");
  };
  onStatus?.("آماده‌سازی تصویر...");
  const canvas = await prepareSlipCanvas(file);
  onStatus?.("آماده‌سازی موتور خواندن متن...");
  let worker = null;
  const cores = ocrCores();
  for (let k = _ocrCoreIdx; k < cores.length && !worker; k++) {
    _ocrCoreIdx = k;
    try { worker = await withTimeout(getOcrWorker(), k === 0 && cores.length > 1 ? 40000 : 90000); }
    catch (e) { _ocrWorkerPromise = null; }       // این هسته بالا نیامد → هسته‌ی بعدی
  }
  if (!worker) { _ocrCoreIdx = 0; throw new Error(ocrSimdOk() ? `بارگذاری موتور خواندن متن ناموفق بود — مرحله: ${_ocrDiag}` : "این گوشی از موتور خواندن متن پشتیبانی نمی‌کند (WebView قدیمی؛ آن را به‌روزرسانی کنید)"); }
  const run = async (psm, ms) => {
    await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: "1" });
    try { const { data } = await withTimeout(worker.recognize(canvas), ms); return parseSlipText(data?.text || "", categories); }
    catch (e) {
      if (/زمان/.test(e?.message || "")) { try { await worker.terminate(); } catch {} _ocrWorkerPromise = null; throw new Error("خواندن متن بیش از حد طول کشید"); }
      throw e;
    }
  };
  let best = await run("6", 60000);                 // یک بار با حالت سریع و دقیق برای برگه
  if (!best.amount) {                               // فقط اگر مبلغ پیدا نشد، حالت دوم
    onStatus?.("تلاش دوباره برای پیدا کردن مبلغ...");
    try { const r2 = await run("4", 40000); if (r2.amount) best = { ...r2, merchant: best.merchant || r2.merchant }; } catch {}
  }
  return best;
}

function SlipScanView({ categories = [], openWithPrefill, onBack }) {
  const st = useStyles(); const t = useT();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [photo, setPhoto] = useState(null);
  const [result, setResult] = useState(null);
  useEffect(() => { const id = setTimeout(() => { getOcrWorker().catch(() => {}); }, 300); return () => clearTimeout(id); }, []);   // موتور از همین الان آماده می‌شود
  async function onFile(e) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    setErr(""); setResult(null); setBusy(true); setStatus("آماده‌سازی تصویر...");
    try {
      setPhoto(await resizeImage(f, 480));
      const r = await extractSlip(f, categories, setStatus);
      setResult({ ...r, amountText: r.amount ? String(r.amount) : "" });
      if (!r.amount) setErr("مبلغ به‌طور خودکار تشخیص داده نشد؛ می‌تونی دستی وارد کنی یا با نور بهتر دوباره عکس بگیری.");
    } catch (x) { setErr("خواندن برگه ناموفق بود؛ دوباره با نور بهتر عکس بگیر. " + (x?.message ? `(${x.message})` : "")); }
    setBusy(false); setStatus("");
  }
  const cat = result?.categoryId ? categories.find((c) => c.id === result.categoryId) : null;
  const catPath = cat ? accountPath(categories, cat).slice(1).join(" / ") : "";
  const amountNum = result ? Math.round(Number(toEnDigits(result.amountText || "").replace(/[^\d.]/g, ""))) || 0 : 0;
  const btn = (bg, fg) => ({ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "13px 8px", borderRadius: 12, background: bg, color: fg, fontWeight: 800, fontSize: 13.5, cursor: "pointer", opacity: busy ? 0.6 : 1, pointerEvents: busy ? "none" : "auto" });
  return (
    <div>
      <div style={{ ...st.card, padding: 16, marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>اسکن برگه پوز</div>
        <div style={{ fontSize: 12.5, color: t.sub, lineHeight: 2, marginBottom: 12 }}>
          از برگه‌ی پوز عکس بگیر. نام فروشگاه، مبلغ، تاریخ و ساعت روی خود گوشی (آفلاین و رایگان) خوانده می‌شود. قبل از ثبت، مقدارها را می‌توانی ویرایش کنی.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <label style={btn(BRAND.header, "#fff")}><Receipt size={17} /> عکس‌برداری<input type="file" accept="image/*" capture="environment" onChange={onFile} style={{ display: "none" }} /></label>
          <label style={btn("#f1eef4", BRAND.header)}><ImageIcon size={17} /> از گالری<input type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} /></label>
        </div>
        {busy && <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: BRAND.violet }}>{status || "در حال خواندن برگه..."}</div>}
        {err && <div style={{ marginTop: 12, fontSize: 12.5, fontWeight: 700, color: BRAND.crimson, lineHeight: 1.9 }}>{err}</div>}
      </div>
      {result && (
        <div style={{ ...st.card, padding: 16 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            {photo && <img src={photo} alt="" style={{ width: 64, height: 64, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />}
            <div style={{ flex: 1, fontSize: 13, lineHeight: 2.1 }}>
              <div><span style={{ color: t.sub }}>تاریخ: </span><b>{result.date ? faLongDate(new Date(result.date)) : "امروز"}</b>{result.time && <> · <b>{result.time}</b></>}</div>
              <div><span style={{ color: t.sub }}>حساب (دسته): </span><b>{catPath || "در مرحله بعد انتخاب کن"}</b></div>
            </div>
          </div>
          <label style={st.label}>فروشگاه</label>
          <input value={result.merchant} onChange={(e) => setResult((r) => ({ ...r, merchant: e.target.value, categoryId: r.categoryId || guessExpenseCategoryId(categories, e.target.value) }))} placeholder="نام فروشگاه" style={st.input} />
          <label style={st.label}>مبلغ (ریال){amountNum ? ` — ${toFaInt(amountNum)}` : ""}</label>
          <input value={result.amountText} inputMode="numeric" onChange={(e) => setResult((r) => ({ ...r, amountText: e.target.value }))} placeholder="مبلغ به ریال" style={{ ...st.input, direction: "ltr", textAlign: "left" }} />
          <button disabled={!amountNum} onClick={() => { openWithPrefill({ type: "expense", amount: amountNum, date: result.date || undefined, time: result.time || undefined, note: result.merchant, categoryId: result.categoryId || undefined, photo: photo || undefined }); onBack?.(); }} style={{ ...st.primaryBtn, marginTop: 14, opacity: amountNum ? 1 : 0.5 }}>ادامه: انتخاب حساب بانکی و ثبت</button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   جمله روزانه انگلیسی — اسپلاش هنگام هر بار باز شدن برنامه؛ جمله تا پایان همان روز ثابت است
   تلفظ با صدای دستگاه پخش می‌شود؛ ۲ ثانیه بعد از پایان تلفظ با فید وارد برنامه می‌شود.
--------------------------------------------------------- */
/* --- جمله روزانه: فقط از اینترنت، رایگان و نامحدود (Tatoeba — بدون کلید API) ---
   هیچ جمله‌ای داخل برنامه نیست. فقط جمله‌ی امروز تا پایان همان روز نگه داشته می‌شود تا عوض نشود،
   و شناسه‌ی جمله‌های قبلی برای تکراری نشدن. */
const AI_SENTENCE_CACHE = "rexa:dailySentence";      // جمله امروز (تا پایان روز ثابت می‌ماند)
const AI_SENTENCE_HISTORY = "rexa:dailySentenceIds"; // فقط شناسه‌ها
const readJson = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v ?? d; } catch { return d; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("زمان اتصال تمام شد")), ms))]);

let _sentenceErr = "";
async function httpGetJson(url, ms = 7000) {
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.get({ url, headers: { Accept: "application/json" }, connectTimeout: ms, readTimeout: ms });
    if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}`);
    return typeof r.data === "string" ? JSON.parse(r.data) : r.data;
  }
  const r = await withTimeout(fetch(url, { headers: { Accept: "application/json" } }), ms);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}
const okEnglish = (en) => { const w = en.trim().split(/\s+/).length; return w >= 4 && w <= 16 && /^[A-Za-z]/.test(en) && !/[0-9@#<>]/.test(en); };
// منبع ۱: Tatoeba (جمله‌ی انگلیسی + ترجمه‌ی فارسی)، اول بدون کلمه، بعد با یک کلمه‌ی عمومی تصادفی
async function sentenceFromTatoeba(used, word) {
  const q = new URLSearchParams({ from: "eng", to: "pes", query: word || "", trans_filter: "limit", trans_to: "pes", sort: "random", orphans: "no", unapproved: "no" });
  const data = await httpGetJson(`https://tatoeba.org/en/api_v0/search?${q.toString()}`);
  const options = [];
  for (const it of data?.results || []) {
    const en = String(it?.text || "").trim();
    if (!okEnglish(en) || used.has(it.id)) continue;
    const fa = (it.translations || []).flat().find((tr) => tr?.lang === "pes" && String(tr.text || "").trim());
    if (fa) options.push({ id: it.id, en, faPron: "", fa: String(fa.text).trim() });
  }
  if (!options.length) throw new Error("نتیجه‌ای نبود");
  return options[Math.floor(Math.random() * options.length)];
}
// منبع ۲: یک جمله‌ی انگلیسی تصادفی از dummyjson + ترجمه‌ی فارسی با MyMemory (هر دو رایگان و بدون کلید)
async function sentenceFromQuoteApi(used) {
  for (let i = 0; i < 4; i++) {
    const q = await httpGetJson("https://dummyjson.com/quotes/random");
    const en = String(q?.quote || "").trim();
    if (!okEnglish(en) || used.has(`q${q.id}`)) continue;
    const tr = await httpGetJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(en)}&langpair=en|fa`);
    const fa = String(tr?.responseData?.translatedText || "").trim();
    if (!fa || /MYMEMORY|QUERY LENGTH/i.test(fa)) throw new Error("ترجمه‌ای نبود");
    return { id: `q${q.id}`, en, faPron: "", fa };
  }
  throw new Error("جمله‌ی مناسبی نبود");
}
async function fetchOnlineSentence(usedIds = []) {
  const used = new Set(usedIds);
  const WORDS = ["you", "I", "we", "they", "he", "she", "what", "where", "when", "how", "why", "can", "want", "like", "need", "go", "come", "make", "know", "think", "today", "tomorrow", "friend", "work", "home", "water", "time", "good", "very", "please"];
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  const errs = [];
  for (const [name, fn] of [["tatoeba", () => sentenceFromTatoeba(used, "")], ["tatoeba-word", () => sentenceFromTatoeba(used, word)], ["quote", () => sentenceFromQuoteApi(used)]]) {
    try { return await withTimeout(fn(), 9000); } catch (e) { errs.push(`${name}: ${e?.message || e}`); }
  }
  _sentenceErr = errs.join(" | ");
  throw new Error(_sentenceErr);
}

// جمله امروز؛ اگر اینترنت نبود null (برنامه بدون نمایش جمله وارد می‌شود)
let _todaySentencePromise = null;
function resolveTodaySentence() {
  if (_todaySentencePromise) return _todaySentencePromise;
  _todaySentencePromise = (async () => {
    try { localStorage.removeItem("rexa:sentenceStash"); localStorage.removeItem("rexa:dailySentenceHistory"); } catch {}
    const today = todayISO();
    const cache = readJson(AI_SENTENCE_CACHE, null);
    if (cache && cache.date === today && cache.en) return cache;
    const ids = readJson(AI_SENTENCE_HISTORY, []);
    try {
      const pick = await withTimeout(fetchOnlineSentence(ids), 28000);
      writeJson(AI_SENTENCE_HISTORY, [...ids, pick.id].slice(-300));
      const out = { date: today, ...pick, source: "online" };
      writeJson(AI_SENTENCE_CACHE, out);
      return out;
    } catch { return null; }
  })();
  return _todaySentencePromise;
}

function DailySentenceSplash({ onDone }) {
  const [sentence, setSentence] = useState(null);
  const en = sentence?.en || "";
  const faPron = sentence?.faPron || "";
  const faMean = sentence?.fa || "";
  const [speaking, setSpeaking] = useState(false);
  const [fading, setFading] = useState(false);
  const [failMsg, setFailMsg] = useState("");
  const timers = useRef([]);
  const finished = useRef(false);
  const speakId = useRef(0);
  const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.current.push(id); return id; };
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  // فید و ورود به برنامه
  const leave = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    clearTimers();
    try { window.speechSynthesis?.cancel(); } catch {}
    try { if (Capacitor.isNativePlatform()) TextToSpeech.stop(); } catch {}
    setSpeaking(false);
    setFading(true);
    setTimeout(onDone, 650);
  }, [onDone]);

  // پایان تلفظ → ۲ ثانیه مکث → فید
  const afterSpeech = useCallback(() => {
    if (finished.current) return;
    setSpeaking(false);
    clearTimers();
    later(leave, 2000);
  }, [leave]);

  const speak = useCallback(() => {
    if (!en) return;
    clearTimers();
    // اندروید (APK): صدای مرورگر در WebView کار نمی‌کند؛ از موتور TTS خود گوشی استفاده می‌شود
    if (Capacitor.isNativePlatform()) {
      const id = ++speakId.current;
      const done = () => { if (id === speakId.current) afterSpeech(); };
      (async () => {
        try { await TextToSpeech.stop(); } catch {}
        setSpeaking(true);
        try { await TextToSpeech.speak({ text: en, lang: "en-US", rate: 0.85, pitch: 1.0, volume: 1.0, category: "playback" }); } catch {}
        done();
      })();
      later(done, 15000);
      return;
    }
    const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
      // دستگاه صدا ندارد: ۵ ثانیه برای خواندن جمله، بعد ۲ ثانیه و فید
      setSpeaking(false);
      later(afterSpeech, 5000);
      return;
    }
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(en);
      u.lang = "en-US"; u.rate = 0.85; u.pitch = 1;
      let started = false;
      u.onstart = () => { started = true; setSpeaking(true); };
      u.onend = afterSpeech;
      u.onerror = afterSpeech;
      synth.speak(u);
      // اگر ۳ ثانیه شروع نشد (مثلا صدا مسدود بود) یا onend هرگز نیامد، ادامه بده
      later(() => { if (!started) afterSpeech(); }, 3000);
      later(afterSpeech, 15000);
    } catch { later(afterSpeech, 5000); }
  }, [en, afterSpeech]);

  useEffect(() => {
    let alive = true;
    resolveTodaySentence().then((r) => { if (!alive) return; if (r) setSentence(r); else { setFailMsg(_sentenceErr || "اینترنت در دسترس نیست"); later(leave, 4500); } }).catch(() => { if (alive) leave(); });
    return () => { alive = false; clearTimers(); try { window.speechSynthesis?.cancel(); } catch {} try { if (Capacitor.isNativePlatform()) TextToSpeech.stop(); } catch {} };
    // eslint-disable-next-line
  }, []);
  useEffect(() => {
    if (!sentence) return;
    later(speak, 500);
    // eslint-disable-next-line
  }, [sentence]);

  return (
    <div dir="rtl" style={{
      minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "32px 24px", boxSizing: "border-box", fontFamily: FONT, color: "#fff",
      background: `linear-gradient(160deg, ${BRAND.header}, ${BRAND.violet})`,
      opacity: fading ? 0 : 1, transition: "opacity .6s ease", position: "relative",
    }}>
      <style>{`@keyframes rexaPulse{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.18);opacity:1}}`}</style>
      <div style={{ fontSize: 12.5, fontWeight: 700, opacity: 0.8, letterSpacing: 0.5, marginBottom: 22 }}>جمله روز انگلیسی</div>
      <div style={{ fontSize: 40, marginBottom: 18, animation: speaking ? "rexaPulse 1s ease-in-out infinite" : "none" }}>🔊</div>
      {!sentence ? (
        failMsg ? <div style={{ fontSize: 12.5, fontWeight: 600, opacity: 0.9, textAlign: "center", lineHeight: 1.9, maxWidth: 340, direction: "ltr" }}>جمله‌ی امروز از اینترنت گرفته نشد<br />{failMsg}</div>
        : <div style={{ fontSize: 14, fontWeight: 600, opacity: 0.85, textAlign: "center" }}>در حال آماده‌سازی جمله امروز...</div>
      ) : (<>
        <div style={{ direction: "ltr", textAlign: "center", fontSize: 26, fontWeight: 800, lineHeight: 1.45, maxWidth: 360 }}>{en}</div>
        {faPron ? <div style={{ marginTop: 16, fontSize: 15, fontWeight: 600, color: "#e8dcf5", textAlign: "center", lineHeight: 1.8, maxWidth: 340 }}>{faPron}</div> : null}
        <div style={{ marginTop: 14, width: 48, height: 2, borderRadius: 2, background: "rgba(255,255,255,.35)" }} />
        <div style={{ marginTop: 14, fontSize: 16.5, fontWeight: 700, textAlign: "center", lineHeight: 1.9, maxWidth: 340 }}>{faMean}</div>
              </>)}
      <div style={{ display: "flex", gap: 10, marginTop: 34 }}>
        <button onClick={speak} style={{ border: "1.5px solid rgba(255,255,255,.45)", background: "rgba(255,255,255,.12)", color: "#fff", borderRadius: 22, padding: "9px 18px", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>پخش دوباره</button>
        <button onClick={leave} style={{ border: "none", background: "#fff", color: BRAND.header, borderRadius: 22, padding: "9px 22px", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>ورود به برنامه</button>
      </div>
    </div>
  );
}

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState(seedSettings());
  const [unlocked, setUnlocked] = useState(false);
  const [dailySplash, setDailySplash] = useState(true); // هر بار باز شدن برنامه نمایش داده می‌شود؛ جمله تا پایان همان روز ثابت است

  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [journalEntries, setJournalEntries] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [loans, setLoans] = useState([]);
  const [checks, setChecks] = useState([]);
  const [bills, setBills] = useState([]);
  const [assets, setAssets] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [favorites, setFavorites] = useState({ categories: [], accounts: [] });
  const [members, setMembers] = useState([]);
  const [events, setEvents] = useState([]);
  const [projects, setProjects] = useState([]);
  const [fiscalPeriods, setFiscalPeriods] = useState([]);
  const [notes, setNotes] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [persons, setPersons] = useState([]);
  const [debts, setDebts] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [goals, setGoals] = useState([]);

  const [tab, setTab] = useState("home");
  const [subView, setSubView] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [prefillTx, setPrefillTx] = useState(null);
  const [open, setOpen] = useState({ shortcut: true });
  const [year, setYear] = useState(jalaliYear(new Date()));
  const [homeDay, setHomeDay] = useState(todayISO());
  const [txFilter, setTxFilter] = useState("all");
  const [txSearch, setTxSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [showCapture, setShowCapture] = useState(false);
  const [accountEditTarget, setAccountEditTarget] = useState(null);
  const [focusId, setFocusId] = useState(null);   // رکوردی که از صفحه اصلی انتخاب شده و باید در مدیر هر بخش باز شود
  const [rates, setRates] = useState(null); // { usd: rialsPerUsd, fetchedAt }
  const [shortcuts, setShortcuts] = useState(() => settings.shortcuts || []);
  const tapTimesRef = useRef([]);
  function handleTripleTap() {
    const now = Date.now();
    const recent = [...tapTimesRef.current.filter((tms) => now - tms < 600), now];
    tapTimesRef.current = recent;
    if (recent.length >= 3) {
      tapTimesRef.current = [];
      setShowCapture(true);
    }
  }


  const shared = settings.sharedFamily;

  const reloadAll = useCallback(async (sh) => {
    const [a, c, t, b, ln, ck, bl, as, rc, fv, mb, ev, pj, fp, nt, rm, ps, db, cu, gl] = await Promise.all([
      loadKey("hs:accounts", null, sh), loadKey("hs:categories", null, sh),
      loadKey("hs:transactions", null, sh), loadKey("hs:budgets", null, sh),
      loadKey("hs:loans", [], sh), loadKey("hs:checks", [], sh),
      loadKey("hs:bills", [], sh), loadKey("hs:assets", [], sh),
      loadKey("hs:recurring", [], sh), loadKey("hs:favorites", { categories: [], accounts: [] }, sh),
      loadKey("hs:members", [], sh), loadKey("hs:events", [], sh),
      loadKey("hs:projects", [], sh), loadKey("hs:fiscalPeriods", [], sh),
      loadKey("hs:notes", [], sh), loadKey("hs:reminders", [], sh),
      loadKey("hs:persons", [], sh), loadKey("hs:debts", [], sh), loadKey("hs:currencies", [], sh),
      loadKey("hs:goals", [], sh),
    ]);
    setAccounts((a || seedAccounts()).map((x) => ({ ...x, active: x.active !== false })));
    setCategories(normalizeCategoriesForHierarchy((c || seedCategories()).map((x) => ({ ...x, active: x.active !== false }))));
    const migratedTransactions = migrateTransactions(t || [], ln);
    setTransactions(migratedTransactions);
    setJournalEntries(rebuildLedger(migratedTransactions));
    setBudgets(b || []);
    setLoans(ln); setChecks(ck); setBills(bl); setAssets(as); setRecurring(rc); setFavorites(fv);
    setMembers(mb); setEvents(ev); setProjects(pj); setFiscalPeriods(fp);
    setNotes(nt); setReminders(rm);
    setPersons(ps || []); setDebts(db || []); setCurrencies(cu || []); setGoals(gl || []);
  }, []);

  useEffect(() => {
    (async () => {
      const s = await loadKey("hs:settings", seedSettings(), false);
      setSettings(s);
      setShortcuts(s.shortcuts || []); // بازیابی میانبرهای ذخیره‌شده (قبلاً با باز شدن برنامه پاک می‌شدند)
      await reloadAll(s.sharedFamily);
      setLoaded(true);
    })();
    // eslint-disable-next-line
  }, []);

  useEffect(() => { if (loaded) saveKey("hs:settings", settings, false); }, [settings, loaded]);
  useEffect(() => { if (loaded) saveKey("hs:accounts", accounts, shared); }, [accounts, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:categories", categories, shared); }, [categories, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:transactions", transactions, shared); }, [transactions, loaded, shared]);
  useEffect(() => { if (loaded) setJournalEntries(rebuildLedger(transactions)); }, [transactions, loaded]);
  useEffect(() => { if (loaded) saveKey("hs:budgets", budgets, shared); }, [budgets, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:loans", loans, shared); }, [loans, loaded, shared]);
  // هر حساب بانکی/کارت در «حساب‌ها و کارت‌ها» یک حساب هم‌نام در درخت «حساب‌ها ← بانک‌ها» دارد (برای اتصال به موجودی واقعی)
  useEffect(() => {
    if (!loaded) return;
    const missing = accounts.filter((a) => (a.type === "bank" || a.type === "card") && a.name && !categories.some((c) => c.kind === "bank" && faKey(c.name) === faKey(a.name)));
    if (missing.length) setCategories((p) => [...p, ...missing.map((a) => ({ id: uid(), name: a.name, kind: "bank", autoFromAccount: a.id }))]);
  }, [loaded, accounts, categories]);

  useEffect(() => { if (loaded) saveKey("hs:checks", checks, shared); }, [checks, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:bills", bills, shared); }, [bills, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:assets", assets, shared); }, [assets, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:recurring", recurring, shared); }, [recurring, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:favorites", favorites, shared); }, [favorites, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:members", members, shared); }, [members, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:events", events, shared); }, [events, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:projects", projects, shared); }, [projects, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:fiscalPeriods", fiscalPeriods, shared); }, [fiscalPeriods, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:notes", notes, shared); }, [notes, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:reminders", reminders, shared); }, [reminders, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:persons", persons, shared); }, [persons, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:debts", debts, shared); }, [debts, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:currencies", currencies, shared); }, [currencies, loaded, shared]);
  useEffect(() => { if (loaded) saveKey("hs:goals", goals, shared); }, [goals, loaded, shared]);
  useEffect(() => { if (loaded) setSettings((prev) => prev.shortcuts === shortcuts ? prev : { ...prev, shortcuts }); }, [shortcuts, loaded]);

  // process recurring templates once after load
  useEffect(() => {
    if (!loaded) return;
    let changed = false;
    const newTx = [];
    const updated = recurring.map((r) => {
      if (!r.active) return r;
      let next = r.nextDate; let guard = 0; let rr = { ...r };
      while (next <= todayISO() && guard < 24) {
        newTx.push({ id: uid(), type: rr.type, amount: rr.amount, categoryId: rr.categoryId, accountId: rr.accountId, date: next, note: rr.note || "تراکنش تکرارشونده", tags: ["تکرارشونده"], createdAt: new Date().toISOString(), recurringId: rr.id });
        next = rr.interval === "weekly" ? addDays(next, 7) : addMonths(next, 1);
        guard++; changed = true;
      }
      return { ...rr, nextDate: next };
    });
    if (changed) {
      setRecurring(updated);
      setTransactions((prev) => [...newTx, ...prev]);
    }
    // eslint-disable-next-line
  }, [loaded]);

  // تبدیل رمز قدیمی (متن ساده) به هش
  useEffect(() => {
    if (!loaded || !settings.pin || settings.pinHash) return;
    (async () => {
      const rec = await makePinRecord(String(settings.pin));
      setSettings((s) => (s.pin ? { ...s, pin: "", ...rec } : s));
    })();
  }, [loaded, settings.pin, settings.pinHash]);

  // اعلان‌های واقعی سررسید چک/قبض/قسط و یادآوری‌ها (فقط در APK)
  useEffect(() => {
    if (!loaded || dailySplash || !Capacitor.isNativePlatform()) return;
    const tm = setTimeout(() => {
      rescheduleDueNotifications({ enabled: settings.dueNotif !== false, checks, bills, loans, reminders, checkDays: Number(settings.checkReminderDays) || 0 }).catch(() => {});
    }, 800);
    return () => clearTimeout(tm);
  }, [loaded, dailySplash, checks, bills, loans, reminders, settings.dueNotif, settings.checkReminderDays]);

  const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }));
  const catById = useCallback((id) => categories.find((c) => c.id === id), [categories]);
  const accById = useCallback((id) => accounts.find((a) => a.id === id), [accounts]);

  const balanceMap = useMemo(() => {
    const m = {};
    accounts.forEach((a) => { m[a.id] = a.initial || 0; });
    transactions.forEach((t) => {
      if (t.type === "expense" && t.accountId in m) m[t.accountId] -= t.amount;
      else if (t.type === "income" && t.accountId in m) m[t.accountId] += t.amount;
      else if (t.type === "transfer") { if (t.accountId in m) m[t.accountId] -= t.amount; if (t.toAccountId in m) m[t.toAccountId] += t.amount; }
    });
    return m;
  }, [accounts, transactions]);
  const accountBalance = useCallback((accId) => balanceMap[accId] || 0, [balanceMap]);

  const totalBalance = useMemo(() => accounts.reduce((s, a) => s + accountBalance(a.id), 0), [accounts, accountBalance]);
  const totalAssets = useMemo(() => assets.reduce((s, a) => s + (a.quantity * a.currentPrice || 0), 0), [assets]);

  const yearTx = useMemo(() => transactions.filter((t) => jalaliYear(new Date(t.date)) === year), [transactions, year]);
  const totalIncomeYear = useMemo(() => yearTx.filter((t) => t.type === "income" && isPnlTransaction(t)).reduce((s, t) => s + pnlAmount(t), 0), [yearTx]);
  const totalExpenseYear = useMemo(() => yearTx.filter((t) => t.type === "expense" && isPnlTransaction(t)).reduce((s, t) => s + pnlAmount(t), 0), [yearTx]);
  const gaugeMax = Math.max(totalIncomeYear, totalExpenseYear, 1);

  const expenseByCategory = useMemo(() => {
    const map = {};
    yearTx.filter((t) => t.type === "expense" && isPnlTransaction(t)).forEach((t) => { map[t.categoryId] = (map[t.categoryId] || 0) + pnlAmount(t); });
    return Object.entries(map).map(([catId, amount]) => ({ catId, amount, name: catById(catId)?.name || "بدون دسته" })).sort((a, b) => b.amount - a.amount);
  }, [yearTx, catById]);
  const incomeByCategory = useMemo(() => {
    const map = {};
    yearTx.filter((t) => t.type === "income" && isPnlTransaction(t)).forEach((t) => { map[t.categoryId] = (map[t.categoryId] || 0) + pnlAmount(t); });
    return Object.entries(map).map(([catId, amount]) => ({ catId, amount, name: catById(catId)?.name || "بدون دسته" })).sort((a, b) => b.amount - a.amount);
  }, [yearTx, catById]);

  function groupBy(idField, list) {
    const map = {};
    yearTx.filter((tx) => tx.type === "expense" && tx[idField] && isPnlTransaction(tx)).forEach((tx) => { map[tx[idField]] = (map[tx[idField]] || 0) + pnlAmount(tx); });
    return Object.entries(map).map(([id, amount]) => ({ id, amount, name: list.find((x) => x.id === id)?.name || "—" })).sort((a, b) => b.amount - a.amount);
  }
  const expenseByMember = useMemo(() => groupBy("memberId", members), [yearTx, members]);
  const expenseByEvent = useMemo(() => groupBy("eventId", events), [yearTx, events]);
  const expenseByProject = useMemo(() => groupBy("projectId", projects), [yearTx, projects]);

  // net worth trend: last 8 months
  const netWorthTrend = useMemo(() => {
    const cutoffs = [], labels = [];
    for (let i = 7; i >= 0; i--) { const d = new Date(); d.setMonth(d.getMonth() - i); cutoffs.push(d.toISOString().slice(0, 10)); labels.push(faMonthYear(d).split(" ")[0]); }
    const base = accounts.reduce((s, a) => s + (a.initial || 0), 0);
    const bins = new Array(cutoffs.length).fill(0);       // یک بار عبور از تراکنش‌ها (قبلاً ۸ بار)
    for (const t of transactions) {
      const dlt = t.type === "expense" ? -t.amount : t.type === "income" ? t.amount : 0;
      if (!dlt) continue;
      for (let k = 0; k < cutoffs.length; k++) { if (t.date <= cutoffs[k]) { bins[k] += dlt; break; } }
    }
    let run = base;
    return cutoffs.map((_, k) => { run += bins[k]; return { name: labels[k], مانده: run }; });
  }, [accounts, transactions]);

  // بسته شدن فرم فوری انجام می‌شود؛ محاسبه‌ی سنگین‌ِ گزارش‌ها بعدش و بدون قفل کردن صفحه
  function addTransaction(tx) {
    startTransition(() => setTransactions((p) => [{ ...tx, id: tx.id || uid(), createdAt: tx.createdAt || new Date().toISOString() }, ...p]));
  }
  function updateTransaction(id, patch) {
    startTransition(() => setTransactions((p) => p.map((t) => t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t)));
  }
  function deleteTransaction(id) { startTransition(() => setTransactions((p) => p.filter((t) => t.id !== id))); }
  function addAccount(a) { const item = { ...a, id: a.id || uid() }; setAccounts((p) => [...p, item]); return item.id; }
  function deleteAccount(id) {
    const used = transactions.some((t) => t.accountId === id || t.toAccountId === id) || loans.some((l) => l.accountId === id) || checks.some((c) => c.accountId === id) || bills.some((b) => b.accountId === id) || debts.some((d) => d.accountId === id) || assets.some((a) => a.accountId === id);
    if (used) { setAccounts((p) => p.map((a) => a.id === id ? { ...a, active: false, archivedAt: new Date().toISOString() } : a)); alert("این حساب سابقه مالی دارد و حذف نشد؛ به‌جای حذف، بایگانی شد."); return; }
    setAccounts((p) => p.filter((a) => a.id !== id));
  }
  function updateAccount(id, patch) { setAccounts((p) => p.map((a) => a.id === id ? { ...a, ...patch } : a)); }
  function addCategory(c) { const item = { ...c, id: c.id || uid() }; setCategories((p) => [...p, item]); return item.id; }
  function deleteCategory(id) {
    const used = transactions.some((t) => t.categoryId === id) || budgets.some((b) => b.categoryId === id) || categories.some((c) => c.parentId === id);
    if (used) { setCategories((p) => p.map((c) => c.id === id ? { ...c, active: false, archivedAt: new Date().toISOString() } : c)); alert("این سرفصل سابقه مالی دارد و حذف نشد؛ به‌جای حذف، بایگانی شد."); return; }
    setCategories((p) => p.filter((c) => c.id !== id && c.parentId !== id));
  }
  function updateCategory(id, patch) { setCategories((p) => p.map((c) => c.id === id ? { ...c, ...patch } : c)); }
  function upsertBudget(categoryId, amount) {
    setBudgets((prev) => prev.find((b) => b.categoryId === categoryId)
      ? prev.map((b) => (b.categoryId === categoryId ? { ...b, amount } : b))
      : [...prev, { id: uid(), categoryId, amount }]);
  }
  function toggleFavorite(kind, id) {
    setFavorites((prev) => {
      const list = prev[kind];
      return { ...prev, [kind]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] };
    });
  }

  // نرخ دلار بازار آزاد از TGJU؛ در APK با CapacitorHttp مستقیم به اینترنت وصل می‌شویم.
  // اگر TGJU موقتاً در دسترس نباشد، نرخ قبلی/دستی حفظ می‌شود تا عدد اشتباه نمایش داده نشود.
  async function fetchRates() {
    const url = "https://gem.tgju.org/profile/price_dollar_rl";
    try {
      let html = "";
      if (Capacitor.isNativePlatform()) {
        const r = await CapacitorHttp.get({ url, headers: { Accept: "text/html" } });
        html = String(r?.data || "");
      } else {
        const r = await fetch(url, { cache: "no-store" });
        html = await r.text();
      }
      const patterns = [
        /نرخ فعلی[^0-9]{0,80}([0-9,]{6,})/i,
        /نرخ فعلی\s*:\s*([0-9,]{6,})/i,
        /Last[^0-9]{0,40}([0-9,]{6,})/i,
        /price_dollar_rl[^0-9]{0,120}([0-9,]{6,})/i
      ];
      let irr = 0;
      for (const re of patterns) {
        const m = html.match(re);
        if (m) { irr = Number(String(m[1]).replace(/,/g, "")); if (irr > 0) break; }
      }
      if (!Number.isFinite(irr) || irr <= 0) throw new Error("TGJU dollar rate not found");
      const fetchedAt = new Date().toISOString();
      setRates({ usd: irr, fetchedAt, source: "tgju", sourceLabel: "TGJU · دلار آزاد" });
      setSettings((prev) => ({ ...prev, lastRatesUpdate: fetchedAt }));
    } catch {
      const manual = Number(String(settings.manualUsdRate || "").replace(/,/g, ""));
      setRates((prev) => prev?.usd ? { ...prev, source: prev.source || "cached", fetchedAt: prev.fetchedAt || new Date().toISOString() } : { usd: manual > 0 ? manual : null, fetchedAt: new Date().toISOString(), source: manual > 0 ? "manual" : "failed", sourceLabel: manual > 0 ? "دستی" : "" });
    }
  }
  useEffect(() => { if (loaded) fetchRates(); /* eslint-disable-next-line */ }, [loaded]);
  useEffect(() => {
    if (!loaded || settings.manualUsdRate === undefined) return;
    const manual = Number(String(settings.manualUsdRate || "").replace(/,/g, ""));
    if (manual > 0 && rates?.source === "manual") setRates((r) => ({ ...r, usd: manual }));
  }, [settings.manualUsdRate, loaded]);

  const backupState = { backupVersion: 4, dataVersion: 4, ledgerVersion: 1, exportedAt: new Date().toISOString(), accounts, categories, transactions, journalEntries, budgets, loans, checks, bills, assets, recurring, favorites, settings: withoutPin(settings), shortcuts, members, events, projects, fiscalPeriods, notes, reminders, persons, debts, currencies, goals };
  async function exportBackup() {
    const filename = `rexa-backup-${todayISO()}.json`;
    const json = JSON.stringify(backupState, null, 2);
    if (Capacitor.isNativePlatform()) {
      try {
        const result = await Filesystem.writeFile({ path: filename, data: json, directory: Directory.Cache, encoding: Encoding.UTF8 });
        await Share.share({ title: "پشتیبان Rexa", text: "فایل پشتیبان Rexa", files: [result.uri], dialogTitle: "ذخیره یا ارسال پشتیبان Rexa" });
        return;
      } catch {}
    }
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }
  function applyBackupData(data, { keepSecurity = false } = {}) {
        const migratedTransactions = migrateTransactions(data?.transactions || [], data?.loans || []);
        if (data.accounts) setAccounts(data.accounts);
        if (data.categories) setCategories(data.categories);
        if (data.transactions) setTransactions(migratedTransactions);
        if (data.budgets) setBudgets(data.budgets);
        if (data.loans) setLoans(data.loans);
        if (data.checks) setChecks(data.checks);
        if (data.bills) setBills(data.bills);
        if (data.assets) setAssets(data.assets);
        if (data.recurring) setRecurring(data.recurring);
        if (data.favorites) setFavorites(data.favorites);
        if (data.members) setMembers(data.members);
        if (data.events) setEvents(data.events);
        if (data.projects) setProjects(data.projects);
        if (data.fiscalPeriods) setFiscalPeriods(data.fiscalPeriods);
        if (data.notes) setNotes(data.notes);
        if (data.reminders) setReminders(data.reminders);
        if (data.persons) setPersons(data.persons);
        if (data.debts) setDebts(data.debts);
        if (data.currencies) setCurrencies(data.currencies);
        if (data.goals) setGoals(data.goals);
        if (data.shortcuts) setShortcuts(data.shortcuts);
        if (data.settings) setSettings((s) => ({ ...s, ...withoutPin(data.settings), ...(keepSecurity ? { biometricEnabled: s.biometricEnabled } : {}) }));
  }
  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        applyBackupData(JSON.parse(e.target.result));
        alert("بازیابی اطلاعات با موفقیت انجام شد");
      } catch { alert("فایل پشتیبان نامعتبر است"); }
    };
    reader.readAsText(file);
  }
  const backupRef = useRef(backupState); backupRef.current = backupState;
  const cloud = useGithubSync({
    loaded, getSnapshot: () => backupRef.current, applySnapshot: (d) => applyBackupData(d, { keepSecurity: true }),
    deps: [loaded, accounts, categories, transactions, journalEntries, budgets, loans, checks, bills, assets, recurring, favorites, members, events, projects, fiscalPeriods, notes, reminders, persons, debts, currencies, goals, shortcuts, settings],
  });
  // بررسی نسخه‌ی جدید برنامه از GitHub Releases (فقط در APK)
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateMsg, setUpdateMsg] = useState("");
  async function checkUpdateNow(manual = true) {
    if (!APP_REPO || !APP_BUILD) { if (manual) setUpdateMsg("اطلاعات نسخه در این ساخت موجود نیست (فقط نسخه‌ی ساخته‌شده توسط GitHub Actions)."); return; }
    try {
      const r = await checkLatestRelease(APP_REPO);
      try { localStorage.setItem("rexa:updChk", String(Date.now())); } catch {}
      if (r && r.build > Number(APP_BUILD)) { setUpdateInfo(r); setUpdateMsg(manual ? `نسخه‌ی جدید ${r.name} آماده است.` : ""); }
      else { setUpdateInfo(null); if (manual) setUpdateMsg(r ? `شما آخرین نسخه را دارید (نسخه‌ی شما ${toFaInt(APP_BUILD)}، آخرین منتشرشده ${toFaInt(r.build)}).` : `بررسی انجام نشد (${_updErr || "اینترنت یا دسترسی به ریپو"}).`); }
    } catch { if (manual) setUpdateMsg("بررسی انجام نشد (اینترنت قطع است)."); }
  }
  useEffect(() => {
    if (!loaded || !Capacitor.isNativePlatform()) return;
    // هر بار برنامه باز شود یا از پس‌زمینه برگردد (حداکثر هر ۱۰ دقیقه) نسخه‌ی جدید بررسی می‌شود
    const run = () => { let last = 0; try { last = Number(localStorage.getItem("rexa:updChk") || 0); } catch {} if (Date.now() - last > 10 * 60 * 1000) checkUpdateNow(false); };
    run();
    let h; CapacitorApp.addListener("appStateChange", (st) => { if (st.isActive) run(); }).then((x) => { h = x; }).catch(() => {});
    return () => { try { h?.remove(); } catch {} };
  }, [loaded]);
  function exportExcel() {
    const typeFa = (t) => (t.type === "expense" ? "پرداخت" : t.type === "income" ? "دریافت" : "انتقال");
    const doc = {
      title: `تراکنش‌ها ${todayISO()}`, subtitle: "همه‌ی تراکنش‌ها",
      sections: [{ head: ["نوع", "مبلغ", "تاریخ", "دسته", "حساب", "برچسب", "یادداشت"], rows: transactions.map((t) => [typeFa(t), t.amount, jf(t.date), catById(t.categoryId)?.name || "", accById(t.accountId)?.name || "", (t.tags || []).join("، "), t.note || ""]) }],
    };
    exportDocXlsx(doc).catch((e) => alert("خروجی Excel گرفته نشد: " + (e?.message || e)));
  }

  const performExit = useCallback(async () => {
    if (!window.confirm("آیا از خروج از Rexa مطمئن هستید؟")) return;
    const wantBackup = window.confirm("قبل از خروج پشتیبان‌گیری شود؟\n\nبله = پشتیبان‌گیری و خروج\nخیر = خروج بدون پشتیبان");
    if (wantBackup) { try { await exportBackup(); } catch {} }
    try { if (Capacitor.isNativePlatform()) await CapacitorApp.exitApp(); else window.history.back(); } catch {}
  }, [settings, accounts, categories, transactions, journalEntries, budgets, loans, checks, bills, assets, recurring, favorites, members, events, projects, fiscalPeriods, notes, reminders, shortcuts]);

  useEffect(() => {
    if (!loaded || !Capacitor.isNativePlatform()) return;
    let listener;
    (async () => {
      listener = await CapacitorApp.addListener("backButton", async () => {
        const topOverlay = (window.__rexaBack || [])[(window.__rexaBack || []).length - 1];
        if (topOverlay) { topOverlay(); return; }
        if (showAdd) { setShowAdd(false); setPrefillTx(null); return; }
        if (showQuickAdd) { setShowQuickAdd(false); return; }
        if (showCapture) { setShowCapture(false); return; }
        if (menuOpen) { setMenuOpen(false); return; }
        if (subView) { setSubView(null); return; }
        if (tab !== "home") { setTab("home"); return; }
        await performExit();
      });
    })();
    return () => { listener?.remove?.(); };
  }, [loaded, showAdd, showQuickAdd, showCapture, menuOpen, subView, tab, performExit]);

  const registerVoiceTransaction = useCallback((transcript) => {
    const parsed = parseBankSms(transcript);
    if (!parsed.amount) { alert("مبلغ تشخیص داده نشد. مثال: «امروز ۳۵۰ تومن برای شام دادم»."); return; }
    const sameKind = categories.filter((c) => c.kind === parsed.type);
    const hinted = parsed.categoryHint ? sameKind.find((c) => c.name === parsed.categoryHint) : null;
    const fallback = sameKind.find((c) => c.name === (parsed.type === "expense" ? "متفرقه" : "درآمد متفرقه")) || sameKind[0];
    const accountId = accounts[0]?.id;
    if (!accountId) { alert("برای ثبت صوتی ابتدا یک حساب بسازید."); return; }
    addTransaction({ type: parsed.type, amount: parsed.amount, categoryId: hinted?.id || fallback?.id || "", accountId, date: todayISO(), note: `ثبت صوتی: ${parsed.note}`, tags: ["ثبت صوتی"] });
    alert(`${toFaInt(parsed.amount)} ریال بابت «${hinted?.name || fallback?.name || "بدون دسته"}» ثبت شد.`);
  }, [categories, accounts]);
  const t = THEME[settings.theme] || THEME.light;
  Object.assign(BRAND, COLOR_PRESETS[settings.themeColor] || COLOR_PRESETS.purple);

  if (dailySplash) return <DailySentenceSplash onDone={() => setDailySplash(false)} />;
  if (!loaded) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: BRAND.header, fontFamily: FONT }}>
        <RexaLogo size={84} showWordmark />
        <div style={{ color: "#d8c9e8", fontSize: 13 }}>در حال بارگذاری...</div>
      </div>
    );
  }
  if ((settings.pinHash || settings.pin || settings.biometricEnabled) && !unlocked) {
    return <LockScreen pin={settings.pin} pinHash={settings.pinHash} pinSalt={settings.pinSalt} onUnlock={() => setUnlocked(true)} biometricEnabled={settings.biometricEnabled} />;
  }

  function openWithPrefill(data) {
    setPrefillTx(data);
    setShowAdd(true);
  }

  async function rebuildData() {
    if (!window.confirm("بازسازی اطلاعات انجام شود؟ قبل از بازسازی یک پشتیبان خودکار تهیه می‌شود.")) return;
    await exportBackup();
    const normalize = (arr, defaults = []) => (Array.isArray(arr) ? arr : defaults).map((x) => ({ ...x, id: x?.id || uid() }));
    setAccounts(normalize(accounts, seedAccounts()));
    setCategories(normalize(categories, seedCategories()));
    setTransactions(normalize(transactions));
    setBudgets(normalize(budgets)); setLoans(normalize(loans)); setChecks(normalize(checks));
    setBills(normalize(bills)); setAssets(normalize(assets)); setRecurring(normalize(recurring));
    setMembers(normalize(members)); setEvents(normalize(events)); setProjects(normalize(projects));
    setFiscalPeriods(normalize(fiscalPeriods)); setNotes(normalize(notes)); setReminders(normalize(reminders));
    setPersons(normalize(persons)); setDebts(normalize(debts)); setCurrencies(normalize(currencies)); setGoals(normalize(goals));
    setFavorites({ categories: (favorites?.categories || []).filter((id) => categories.some((c) => c.id === id)), accounts: (favorites?.accounts || []).filter((id) => accounts.some((a) => a.id === id)) });
    alert("بازسازی اطلاعات با موفقیت انجام شد.");
  }

  async function clearAllData() {
    if (!window.confirm("تمام اطلاعات مالی و تراکنش‌ها پاک می‌شود. ابتدا پشتیبان تهیه شود؟")) return;
    await exportBackup();
    if (!window.confirm("تأیید نهایی: اطلاعات مالی این دستگاه خام شود؟ این عملیات پس از اجرا با پشتیبان قابل بازگردانی است.")) return;
    setAccounts(seedAccounts()); setCategories(seedCategories()); setTransactions([]); setBudgets([]); setLoans([]); setChecks([]);
    setBills([]); setAssets([]); setRecurring([]); setFavorites({ categories: [], accounts: [] }); setMembers([]); setEvents([]);
    setProjects([]); setFiscalPeriods([]); setNotes([]); setReminders([]); setPersons([]); setDebts([]); setCurrencies([]); setGoals([]);
    alert("اطلاعات مالی خام شد. پشتیبان قبلی را در صورت نیاز بازیابی کنید.");
  }


  const ctx = {
    accounts, addAccount, deleteAccount, updateAccount, accountBalance, accountEditTarget, setAccountEditTarget, focusId, setFocusId,
    categories, addCategory, deleteCategory, updateCategory,
    budgets, upsertBudget, expenseByCategory, incomeByCategory,
    loans, setLoans, checks, setChecks, bills, setBills, assets, setAssets,
    recurring, setRecurring, favorites, toggleFavorite, shortcuts, setShortcuts,
    settings, setSettings, exportBackup, importBackup, exportExcel,
    transactions, catById, accById, totalBalance, totalAssets,
    members, setMembers, events, setEvents, projects, setProjects,
    persons, setPersons, debts, setDebts, currencies, setCurrencies, goals, setGoals,
    fiscalPeriods, setFiscalPeriods, openWithPrefill,
    notes, setNotes, reminders, setReminders, rates, fetchRates,
    addTransaction, updateTransaction, deleteTransaction, setTransactions, rebuildData, clearAllData,
    cloud, updateInfo, updateMsg, checkUpdateNow,
  };

  return (
    <ThemeCtx.Provider value={t}>
      <div dir="rtl" onClick={handleTripleTap} style={{ fontFamily: FONT, background: t.bg, color: t.text, minHeight: "100vh", maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", position: "relative", paddingBottom: "calc(100px + env(safe-area-inset-bottom, 0px))", boxShadow: "0 0 30px rgba(0,0,0,0.08)", zoom: settings.fontScale || 1 }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700;800&display=swap');
          * { box-sizing: border-box; } html, body, #root { margin: 0; min-height: 100%; width: 100%; } body { overflow-x: hidden; overscroll-behavior-y: none; }
          input, select, textarea, button { font-family: inherit; }
          ::-webkit-scrollbar { width: 0; height: 0; }
          @media print { .no-print { display: none !important; } }
        `}</style>

        {subView ? (
          <Header title={SUBVIEW_TITLES[subView]} back onBack={() => setSubView(null)} />
        ) : (
          <Header title={settings.profile?.name || "alireza shadfar"} onMenu={() => setMenuOpen(true)}
            onMic={registerVoiceTransaction} />
        )}

        {(updateInfo || cloud.state.conflict) && (
          <div style={{ padding: "8px 12px 0", display: "flex", flexDirection: "column", gap: 6 }}>
            {cloud.state.conflict && (
              <div onClick={() => { setMenuOpen(false); setSubView("cloud"); }} style={{ background: "#fff4e0", color: "#8a5a00", border: "1px solid #f0c777", borderRadius: 10, padding: "9px 12px", fontSize: 12.5, fontWeight: 700, lineHeight: 1.8, cursor: "pointer" }}>
                داده‌های گیت‌هاب با این گوشی فرق دارد. برای انتخاب (دریافت یا جایگزینی) اینجا را بزنید.
              </div>
            )}
            {updateInfo && (
              <div style={{ background: "#e8f7ee", color: "#17603a", border: "1px solid #9fd8b4", borderRadius: 10, padding: "9px 12px", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, lineHeight: 1.8 }}>نسخه‌ی جدید Rexa آماده است ({updateInfo.name}).</span>
                <button onClick={() => openExternalUrl(updateInfo.url)} style={{ background: "#17603a", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>دانلود</button>
                <button onClick={() => setUpdateInfo(null)} aria-label="بستن" style={{ background: "none", border: "none", color: "#17603a", cursor: "pointer", display: "flex" }}><X size={16} /></button>
              </div>
            )}
          </div>
        )}

        {subView ? (
          <SubViewContent subView={subView} ctx={ctx} onBack={() => setSubView(null)} />
        ) : (
          <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
            {tab === "home" && (
              <HomeView
                year={year} setYear={setYear}
                totalIncomeYear={totalIncomeYear} totalExpenseYear={totalExpenseYear} gaugeMax={gaugeMax}
                open={open} toggle={toggle}
                accounts={accounts} accountBalance={accountBalance}
                expenseByCategory={expenseByCategory} incomeByCategory={incomeByCategory}
                budgets={budgets} categories={categories} transactions={yearTx} allTransactions={transactions}
                bills={bills} loans={loans} checks={checks} assets={assets} totalAssets={totalAssets} persons={persons} debts={debts}
                openAccounts={() => { setAccountEditTarget(null); setSubView("accounts"); }} onEditAccount={(a) => { setAccountEditTarget(a); setSubView("accounts"); }} openBudgets={() => setSubView("budgets")}
                openBills={() => setSubView("bills")} openLoans={() => setSubView("loans")} openPersons={() => setSubView("persons")} openDebts={() => setSubView("debts")}
                openChecks={() => setSubView("checks")} openAssets={() => setSubView("assets")} openSubView={(k) => setSubView(k)}
                homeDay={homeDay} setHomeDay={setHomeDay} catById={catById}
                settings={settings} setSettings={setSettings} rates={rates} fetchRates={fetchRates}
                onNote={() => setShowNoteModal(true)} onReminder={() => setShowReminderModal(true)}
                shortcuts={shortcuts}
                onRunShortcut={(sc) => { setShowQuickAdd(false); setShowAdd(true); setPrefillTx({ type: sc.type, categoryId: sc.categoryId, accountId: sc.accountId, note: sc.note || `میانبر: ${sc.name}` }); }}
                openShortcuts={() => setSubView("shortcuts")}
                onOpenTransactions={() => setTab("transactions")}
                onOpenItem={(view, id) => { setFocusId(id); setSubView(view); }}
                onEditTransaction={(tx) => { setPrefillTx({ ...tx, _editId: tx.id }); setShowAdd(true); }}
                onDeleteTransaction={deleteTransaction}
                onDeleteAccount={deleteAccount}
                onAddTransaction={(type) => { setPrefillTx(type ? { type } : null); setShowAdd(true); }}
              />
            )}
            {tab === "transactions" && (
              <TransactionsView
                transactions={transactions} catById={catById} accById={accById} checks={checks}
                filter={txFilter} setFilter={setTxFilter} onDelete={deleteTransaction}
                onEdit={(tx) => { setPrefillTx({ ...tx, _editId: tx.id }); setShowAdd(true); }}
                search={txSearch} setSearch={setTxSearch}
              />
            )}
            {tab === "operations" && <OperationsView setSubView={setSubView} onAdd={() => setShowAdd(true)} />}
            {tab === "checks" && <ChecksManager checks={checks} setChecks={setChecks} />}
            {tab === "reports" && (
              <ReportsView
                expenseByCategory={expenseByCategory} incomeByCategory={incomeByCategory}
                totalIncomeYear={totalIncomeYear} totalExpenseYear={totalExpenseYear}
                accounts={accounts} accountBalance={accountBalance}
                netWorthTrend={netWorthTrend} exportExcel={exportExcel}
                expenseByMember={expenseByMember} expenseByEvent={expenseByEvent} expenseByProject={expenseByProject}
                categories={categories} checks={checks} debts={debts} totalAssets={totalAssets} currency={settings.currency} usdRate={rates?.usd}
                transactions={transactions} updateAccount={updateAccount}
                members={members} events={events} projects={projects} loans={loans} assets={assets} bills={bills}
              />
            )}
          </div>
        )}

        <BottomNav
          active={subView ? null : tab}
          setActive={(k) => {
            setShowAdd(false); setPrefillTx(null); setShowQuickAdd(false); setShowCapture(false); setMenuOpen(false); setSubView(null);
            setTab(k);
          }}
          onAdd={() => {
            setShowAdd(false); setPrefillTx(null); setShowCapture(false); setMenuOpen(false); setSubView(null);
            setShowQuickAdd(true);
          }}
        />

        {showQuickAdd && (
          <QuickAddSheet
            onClose={() => setShowQuickAdd(false)}
            onPick={(type) => {
              setShowQuickAdd(false);
              if (type === "check") { setTab("checks"); return; }
              setPrefillTx(type === "expense" ? { type: "expense" } : type === "income" ? { type: "income" } : type === "transfer" ? { type: "transfer" } : null);
              setShowAdd(true);
            }}
          />
        )}

        {showNoteModal && (
          <SimpleTextModal title="یادداشت جدید" placeholder="یادداشتت رو بنویس..."
            onClose={() => setShowNoteModal(false)}
            onSubmit={(text) => { setNotes((p) => [{ id: uid(), text, date: todayISO(), createdAt: new Date().toISOString() }, ...p]); setShowNoteModal(false); }} />
        )}
        {showReminderModal && (
          <ReminderQuickModal onClose={() => setShowReminderModal(false)}
            onSubmit={(r) => { setReminders((p) => [{ id: uid(), ...r }, ...p]); setShowReminderModal(false); }} />
        )}
        {showCapture && (
          <SmartCaptureOverlay
            onClose={() => setShowCapture(false)}
            onParsed={(data) => { setShowCapture(false); openWithPrefill(data); }}
          />
        )}

        {showAdd && (
          <AddTransactionSheet
            accounts={accounts} categories={categories} favorites={favorites}
            onAddAccount={addAccount} onAddCategory={addCategory}
            members={members} events={events} projects={projects}
            initial={prefillTx}
            onClose={() => { setShowAdd(false); setPrefillTx(null); }}
            onSubmit={(tx) => {
              if (prefillTx?._editId) setTransactions((prev) => prev.map((item) => item.id === prefillTx._editId ? { ...item, ...tx, id: item.id, createdAt: item.createdAt } : item));
              else addTransaction(tx);
              setShowAdd(false); setPrefillTx(null);
            }}
          />
        )}
        {menuOpen && <SideMenu onClose={() => setMenuOpen(false)} setSubView={(v) => { setSubView(v); setMenuOpen(false); }} profileName={settings.profile?.name} />}
      </div>
    </ThemeCtx.Provider>
  );
}

/* ---------------------------------------------------------
   Home View
--------------------------------------------------------- */
/* ---------------------------------------------------------
   Home detail helpers (سند باز‌شونده در صفحه اصلی)
--------------------------------------------------------- */
function DetailBox({ lines = [], children }) {
  const t = useT();
  return (
    <div style={{ margin: "2px 0 10px", padding: 12, borderRadius: 12, background: "rgba(127,127,127,0.08)", border: `1px solid ${t.border}`, fontSize: 12 }}>
      {lines.map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: `1px solid ${t.border}` }}>
          <span style={{ color: t.sub }}>{k}</span>
          <strong style={{ color: t.text, textAlign: "left", wordBreak: "break-word" }}>{v}</strong>
        </div>
      ))}
      {children}
    </div>
  );
}
const detailActionBtn = (color, filled) => ({ flex: 1, border: filled ? "none" : `1px solid ${color}`, background: filled ? color : "transparent", color: filled ? "#fff" : color, borderRadius: 9, padding: "8px 10px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" });
// بعد از رفتن به مدیر هر بخش، رکورد انتخاب‌شده را باز و به آن اسکرول می‌کند
function useFocusItem(focusId, setFocusId, openFn) {
  useEffect(() => {
    if (!focusId) return;
    openFn(focusId);
    setTimeout(() => { try { document.getElementById(`item-${focusId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); } catch {} }, 150);
    setFocusId?.(null);
  }, [focusId]);
}

function HomeView({
  year, setYear, totalIncomeYear, totalExpenseYear, gaugeMax, open, toggle,
  accounts, accountBalance, expenseByCategory, incomeByCategory, budgets, categories,
  transactions, allTransactions, bills, loans, checks, assets, totalAssets, persons = [], debts = [],
  openAccounts, onEditAccount, openBudgets, openBills, openLoans, openChecks, openAssets, openPersons, openDebts, openSubView,
  homeDay, setHomeDay, catById, settings, setSettings, rates, fetchRates, onNote, onReminder, onAddTransaction, shortcuts = [], onRunShortcut, openShortcuts, onOpenTransactions,
  onOpenItem, onEditTransaction, onDeleteTransaction, onDeleteAccount
}) {
  const t = useT();
  const [openItem, setOpenItem] = useState(null);   // فقط یک سطر همزمان باز است
  const [openTxId, setOpenTxId] = useState(null);   // فقط یک سند داخل سطر باز است
  const toggleItem = (k) => { setOpenTxId(null); setOpenItem((o) => (o === k ? null : k)); };
  const accNameOf = (id) => accounts.find((a) => a.id === id)?.name || "—";
  const banks = accounts.filter((a) => a.type === "bank");
  const funds = accounts.filter((a) => a.type === "fund");
  const cardAccs = accounts.filter((a) => a.type === "card");
  const net = totalIncomeYear - totalExpenseYear;
  const upcomingBills = bills.filter((b) => !b.paid && daysUntil(b.dueDate) <= 5).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const upcomingChecks = checks.filter((c) => c.status === "pending" && daysUntil(c.dueDate) <= (settings.checkReminderDays || 7)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const currency = settings.currency, usdRate = rates?.usd;
  const layout = settings.homeLayout || "cards";
  const sectionOrder = normalizeHomeSections(settings.homeSections).filter((s) => s.visible);

  const SECTION_META = {
    shortcut: { color: BRAND.mauve, title: "میانبر تراکنش ها", icon: <ArrowLeftRight size={20} /> },
    operations: { color: BRAND.header, title: "عملیات", icon: <Grid3x3 size={20} /> },
    expense: { color: BRAND.header, title: "هزینه ها", icon: <TrendingDown size={20} /> },
    income: { color: BRAND.darkgreen, title: "درآمدها", icon: <TrendingUp size={20} /> },
    banks: { color: BRAND.violet, title: "بانک ها و کارت ها", icon: <Landmark size={20} /> },
    funds: { color: BRAND.teal, title: "صندوق ها", icon: <Save size={20} /> },
    balrep: { color: BRAND.gold, title: "گزارش مانده حساب ها", icon: <FileSpreadsheet size={20} /> },
    budget: { color: BRAND.green, title: "بودجه بندی", icon: <Target size={20} /> },
    loanchk: { color: BRAND.orange, title: "وام ها و چک ها", icon: <Bank size={20} /> },
    contacts: { color: BRAND.violet, title: "اشخاص و بدهی ها", icon: <Users size={20} /> },
    bills: { color: BRAND.crimson, title: "یادآوری قبض ها", icon: <BellRing size={20} /> },
  };

  function txSourceOf(tx) {
    if (tx.loanId) return ["loans", tx.loanId, "وام"];
    if (tx.checkId) return ["checks", tx.checkId, "چک"];
    if (tx.billId) return ["bills", tx.billId, "قبض"];
    if (tx.sourceType === "debt" && tx.sourceId) return ["debts", tx.sourceId, "بدهی/طلب"];
    return null;
  }
  function categoryDocs(kind, color) {
    const list = kind === "expense" ? expenseByCategory : incomeByCategory;
    if (list.length === 0) return <EmptyRow text={kind === "expense" ? "هزینه‌ای ثبت نشده" : "درآمدی ثبت نشده"} />;
    return list.map((e) => {
      const k = `${kind}:${e.catId}`;
      const isOpen = openItem === k;
      const txs = isOpen
        ? transactions.filter((x) => x.type === kind && isPnlTransaction(x) && String(x.categoryId) === String(e.catId))
            .sort((a, b) => `${b.date}${b.time || ""}`.localeCompare(`${a.date}${a.time || ""}`))
        : [];
      return (
        <div key={e.catId}>
          <Row title={e.name} subtitle={isOpen ? `${toFaInt(txs.length)} سند` : "لمس برای مشاهده سندها"} value={formatMoney(e.amount, currency, usdRate)} valueColor={color}
            onClick={() => toggleItem(k)} chevron={isOpen ? "right" : "left"} />
          {isOpen && (
            <div style={{ margin: "0 0 8px", paddingRight: 8 }}>
              {txs.length === 0 && <EmptyRow text="سندی یافت نشد" />}
              {txs.map((x) => {
                const txOpen = openTxId === x.id;
                const src = txSourceOf(x);
                const pnl = pnlAmount(x);
                const lines = [
                  ["مبلغ", formatMoney(x.amount, currency, usdRate)],
                  ...(Number(pnl) !== Number(x.amount) ? [[kind === "expense" ? "سهم در هزینه" : "سهم در درآمد", formatMoney(pnl, currency, usdRate)]] : []),
                  ["تاریخ", `${x.date ? faLongDate(new Date(x.date)) : "—"}${x.time ? ` · ${faDigits(x.time)}` : ""}`],
                  ["دسته", e.name],
                  ["حساب", accNameOf(x.accountId)],
                  ["توضیحات", x.note || "—"],
                ];
                return (
                  <div key={x.id}>
                    <Row title={x.note || e.name} subtitle={x.date ? faLongDate(new Date(x.date)) : undefined} value={formatMoney(pnl, currency, usdRate)} valueColor={color}
                      onClick={() => setOpenTxId((o) => (o === x.id ? null : x.id))} chevron={txOpen ? "right" : "left"} />
                    {txOpen && (
                      <DetailBox lines={lines}>
                        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                          {src ? (
                            <button onClick={() => onOpenItem?.(src[0], src[1])} style={detailActionBtn(BRAND.violet, true)}>مدیریت از بخش {src[2]}</button>
                          ) : (<>
                            <button onClick={() => onEditTransaction?.(x)} style={detailActionBtn(BRAND.violet, true)}>ویرایش</button>
                            <button onClick={() => { if (window.confirm("این تراکنش حذف شود؟")) { onDeleteTransaction?.(x.id); setOpenTxId(null); } }} style={detailActionBtn(BRAND.crimson, false)}>حذف</button>
                          </>)}
                        </div>
                        {src && <div style={{ fontSize: 11, color: t.sub, marginTop: 8, lineHeight: 1.8 }}>این سند از بخش {src[2]} ساخته شده و برای حفظ صحت حساب‌ها فقط از همان بخش قابل اصلاح است.</div>}
                      </DetailBox>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    });
  }
  function accountDoc(a) {
    const k = `acc:${a.id}`;
    const isOpen = openItem === k;
    const bal = accountBalance(a.id);
    const typeLabel = a.type === "card" ? "کارت" : a.type === "bank" ? "بانک" : "صندوق";
    const lines = [
      ["نوع", typeLabel],
      ["موجودی فعلی", formatMoney(bal, currency, usdRate)],
      ["موجودی اولیه", formatMoney(a.initial || 0, currency, usdRate)],
      ...(a.cardNumber ? [["شماره کارت", <span dir="ltr">{String(a.cardNumber).replace(/(\d{4})(?=\d)/g, "$1 ")}</span>]] : a.cardNumberLast4 ? [["شماره کارت", <span dir="ltr">•••• {a.cardNumberLast4}</span>]] : []),
      ...(a.expiryDate ? [["تاریخ انقضا", <span dir="ltr">{expiryFromStored(a.expiryDate)}</span>]] : []),
      ["وضعیت", a.active === false ? "بایگانی‌شده" : "فعال"],
    ];
    return (
      <div key={a.id}>
        <Row title={a.name} subtitle={isOpen ? typeLabel : `${typeLabel} · لمس برای جزئیات`} value={formatMoney(bal, currency, usdRate)} valueColor={bal >= 0 ? t.text : BRAND.crimson}
          onClick={() => toggleItem(k)} chevron={isOpen ? "right" : "left"} />
        {isOpen && (
          <DetailBox lines={lines}>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={() => onEditAccount?.(a)} style={detailActionBtn(BRAND.violet, true)}>ویرایش</button>
              <button onClick={() => { if (window.confirm(`«${a.name}» حذف شود؟ اگر سابقه مالی داشته باشد به‌جای حذف، بایگانی می‌شود.`)) { onDeleteAccount?.(a.id); setOpenItem(null); } }} style={detailActionBtn(BRAND.crimson, false)}>حذف / بایگانی</button>
            </div>
          </DetailBox>
        )}
      </div>
    );
  }

  function sectionBody(key) {
    switch (key) {
      case "shortcut":
        return (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "18px 12px", padding: "16px 4px 14px" }}>
            {shortcuts.map((sc) => <ShortcutTile key={sc.id} sc={sc} onClick={() => onRunShortcut?.(sc)} />)}
            <AddShortcutTile onClick={openShortcuts || (() => {})} />
          </div>
        );
      case "operations": {
        const groups = [
          { title: "حسابداری و مدیریت", items: [
            { key: "coa", title: "حساب‌ها", icon: <Grid3x3 size={17} />, color: BRAND.header },
            { key: "goals", title: "اهداف مالی و پس‌انداز", icon: <Target size={17} />, color: BRAND.green },
            { key: "accounts", title: "حساب‌ها و کارت‌ها", icon: <Landmark size={17} />, color: BRAND.violet },
            { key: "categories", title: "دسته‌بندی‌ها و برچسب‌ها", icon: <Tag size={17} />, color: BRAND.mauve },
            { key: "budgets", title: "بودجه‌بندی", icon: <Save size={17} />, color: BRAND.green },
            { key: "recurring", title: "تراکنش‌های تکرارشونده", icon: <Repeat size={17} />, color: BRAND.teal },
            { key: "checks", title: "چک‌ها", icon: <FileSpreadsheet size={17} />, color: BRAND.gold },
            { key: "loans", title: "وام و اقساط", icon: <Bank size={17} />, color: BRAND.crimson },
            { key: "assets", title: "دارایی‌ها", icon: <Bitcoin size={17} />, color: "#7a5cff" },
            { key: "currencies", title: "واحدهای پولی", icon: <DollarSign size={17} />, color: BRAND.gold },
            { key: "bills", title: "یادآوری قبض‌ها", icon: <BellRing size={17} />, color: BRAND.orange },
            { key: "tags", title: "اعضای منزل، رویداد و پروژه", icon: <Users size={17} />, color: BRAND.violet },
            { key: "periods", title: "دوره مالی", icon: <CalendarDays size={17} />, color: BRAND.darkgreen },
            { key: "calendar", title: "تقویم شمسی", icon: <CalendarDays size={17} />, color: BRAND.header },
          ] },
          { title: "ابزارها", items: [
            { key: "slip", title: "اسکن برگه پوز (دوربین)", icon: <Receipt size={17} />, color: BRAND.fab },
            { key: "shortcuts", title: "میانبرهای تراکنش", icon: <ArrowLeftRight size={17} />, color: BRAND.mauve },
            { key: "sms", title: "پیامک بانکی", icon: <BellRing size={17} />, color: "#666" },
            { key: "calculator", title: "ماشین حساب", icon: <Type size={17} />, color: BRAND.teal },
            { key: "support", title: "پشتیبانی و تیکت", icon: <Bell size={17} />, color: BRAND.header },
          ] },
        ];
        return (<>
          {groups.map((g) => (
            <div key={g.title}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: BRAND.violet, padding: "10px 4px 2px" }}>{g.title}</div>
              {g.items.map((it) => <Row key={it.key} title={it.title} leftIcon={it.icon} leftColor={it.color} onClick={() => openSubView?.(it.key)} />)}
            </div>
          ))}
        </>);
      }
      case "expense":
        return categoryDocs("expense", BRAND.crimson);
      case "income":
        return categoryDocs("income", BRAND.darkgreen);
      case "banks":
        return (<>
          {[...banks, ...cardAccs].length === 0 && <EmptyRow text="حسابی ثبت نشده" />}
          {[...banks, ...cardAccs].map((a) => accountDoc(a))}
          <AddLink text="+ مدیریت حساب‌ها و کارت‌ها" onClick={openAccounts} />
        </>);
      case "funds":
        return funds.length === 0 ? <EmptyRow text="صندوقی ثبت نشده" /> : funds.map((a) => accountDoc(a));
      case "balrep":
        return accounts.map((a) => (
          <Row key={a.id} title={a.name} subtitle={a.type === "bank" ? "بانک" : a.type === "card" ? "کارت" : "صندوق"}
            value={formatMoney(accountBalance(a.id), currency, usdRate)} valueColor={accountBalance(a.id) >= 0 ? BRAND.darkgreen : BRAND.crimson} />
        ));
      case "budget":
        return (<>
          {budgets.length === 0 && <EmptyRow text="بودجه‌ای تعریف نشده" />}
          {budgets.map((b) => {
            const cat = categories.find((c) => c.id === b.categoryId);
            const spent = expenseByCategory.find((e) => e.catId === b.categoryId)?.amount || 0;
            const pct = Math.min(100, Math.round((spent / (b.amount || 1)) * 100));
            return (
              <div key={b.id} style={{ padding: "10px 4px", borderBottom: `1px solid ${t.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>
                  <span>{cat?.name || "—"}</span>
                  <span style={{ color: pct >= 100 ? BRAND.crimson : t.sub }}>{toFaInt(pct)}٪ — {toFaInt(spent)}/{toFaInt(b.amount)}</span>
                </div>
                <div style={{ height: 7, background: t.border, borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: pct >= 100 ? BRAND.crimson : BRAND.green }} />
                </div>
              </div>
            );
          })}
          <AddLink text="+ مدیریت بودجه‌بندی" onClick={openBudgets} />
        </>);
      case "loanchk":
        return (<>
          {loans.length === 0 && checks.length === 0 && <EmptyRow text="موردی ثبت نشده" />}
          {loans.map((l) => (
            <Row key={l.id} title={l.title} subtitle="وام" value={`${toFaInt(l.principal - (l.paidCount || 0) * l.monthlyPayment)} ریال باقی‌مانده`} valueColor={BRAND.crimson} onClick={() => onOpenItem?.("loans", l.id)} />
          ))}
          {checks.filter((c) => c.status === "pending").map((c) => (
            <Row key={c.id} title={`${c.payee} (${c.type === "received" ? "دریافتی" : "پرداختی"})`} subtitle={faLongDate(new Date(c.dueDate))} value={formatMoney(c.amount, currency, usdRate)} onClick={() => onOpenItem?.("checks", c.id)} />
          ))}
          <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 4 }}>
            <AddLink text="+ وام‌ها" onClick={openLoans} />
            <AddLink text="+ چک‌ها" onClick={openChecks} />
            <AddLink text="+ دارایی‌ها" onClick={openAssets} />
          </div>
        </>);
      case "contacts":
        return (<><Row title="اشخاص و طرف حساب‌ها" subtitle={`${toFaInt(persons.length)} نفر`} value="مدیریت" valueColor={BRAND.violet} onClick={openPersons} />
          <Row title="بدهی و طلب" subtitle="مدیریت طرف حساب‌ها" value="مدیریت" valueColor={BRAND.orange} onClick={openDebts} />{debts.filter((d) => !d.settled).map((d) => <Row key={d.id} title={persons.find((p) => p.id === d.personId)?.name || "طرف حساب حذف‌شده"} subtitle={d.kind === "receivable" ? "طلب" : "بدهی"} value={`${toFaInt(d.amount)} ریال`} valueColor={d.kind === "receivable" ? BRAND.darkgreen : BRAND.crimson} onClick={() => onOpenItem?.("debts", d.id)} />)}<Row title="طلب‌های باز" value={`${toFaInt(debts.filter((d) => !d.settled && d.kind === "receivable").reduce((s, d) => s + Number(d.amount || 0), 0))} ریال`} valueColor={BRAND.darkgreen} /><Row title="بدهی‌های باز" value={`${toFaInt(debts.filter((d) => !d.settled && d.kind === "payable").reduce((s, d) => s + Number(d.amount || 0), 0))} ریال`} valueColor={BRAND.crimson} /></>);
      case "bills":
        return (<>
          {bills.length === 0 && <EmptyRow text="قبضی ثبت نشده" />}
          {bills.map((b) => (
            <Row key={b.id} title={b.title} subtitle={faLongDate(new Date(b.dueDate))}
              value={b.paid ? "پرداخت شده" : `${toFaInt(daysUntil(b.dueDate))} روز`}
              valueColor={b.paid ? BRAND.darkgreen : daysUntil(b.dueDate) < 0 ? BRAND.crimson : BRAND.orange} onClick={() => onOpenItem?.("bills", b.id)} />
          ))}
          <AddLink text="+ مدیریت قبض‌ها" onClick={openBills} />
        </>);
      default: return null;
    }
  }

  function sectionAddHandler(key) {
    switch (key) {
      case "shortcut": return undefined;
      case "expense": return () => onAddTransaction("expense");
      case "income": return () => onAddTransaction("income");
      case "banks": return openAccounts;
      case "funds": return openAccounts;
      case "budget": return openBudgets;
      case "contacts": return openPersons;
      case "bills": return openBills;
      default: return undefined;
    }
  }

  return (
    <div style={{ padding: "18px 16px 8px" }}>
      <BankCardCarousel accounts={accounts} accountBalance={accountBalance} currency={currency} usdRate={usdRate} onAddCard={openAccounts} onEditAccount={onEditAccount} />
      <DateQuickBox onNote={onNote} onReminder={onReminder} />
      <IncomeExpenseDayWidget day={homeDay} setDay={setHomeDay} transactions={allTransactions} catById={catById} currency={currency} usdRate={usdRate} bills={bills} checks={checks} onOpenTransactions={onOpenTransactions} />
      <CurrencyRatesStrip rates={rates} fetchRates={fetchRates} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, margin: "18px 0" }}>
        <button onClick={() => setYear((y) => y - 1)} style={navArrowStyle(t)}><ChevronLeft size={16} /></button>
        <div style={{ background: t.card, borderRadius: 20, padding: "6px 18px", fontWeight: 700, color: BRAND.header, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>سال {faDigits(year)}</div>
        <button onClick={() => setYear((y) => y + 1)} style={navArrowStyle(t)}><ChevronRight size={16} /></button>
        <button onClick={() => setSettings((s) => ({ ...s, homeLayout: layout === "cards" ? "icons" : "cards" }))}
          style={{ ...navArrowStyle(t), width: "auto", padding: "0 10px", borderRadius: 16, display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
          {layout === "cards" ? <LayoutGrid size={15} /> : <LayoutList size={15} />}
        </button>
      </div>

      <div style={{ textAlign: "center", marginBottom: 12, fontSize: 13, color: net >= 0 ? BRAND.darkgreen : BRAND.crimson, fontWeight: 700 }}>
        مانده سالانه: {toFaInt(Math.abs(net))} ریال {net >= 0 ? "مثبت" : "منفی"}
      </div>
      {totalAssets > 0 && (
        <div style={{ textAlign: "center", marginBottom: 18, fontSize: 12.5, color: BRAND.orange, fontWeight: 700 }}>
          ارزش دارایی‌های دیجیتال/بورس: {toFaInt(totalAssets)} ریال
        </div>
      )}

      {(upcomingBills.length > 0 || upcomingChecks.length > 0) && (
        <div style={{ background: "#fff6ea", border: "1px solid #f0d9a8", borderRadius: 12, padding: 12, marginBottom: 16, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: BRAND.orange, fontWeight: 700, fontSize: 13 }}><BellRing size={16} /> یادآوری‌های نزدیک</div>
          {upcomingBills.map((b) => (
            <div key={b.id} style={{ fontSize: 12.5, color: "#6b4c14" }}>قبض {b.title} — {daysUntil(b.dueDate) < 0 ? "سررسید گذشته" : `${toFaInt(daysUntil(b.dueDate))} روز مانده`}</div>
          ))}
          {upcomingChecks.map((c) => (
            <div key={c.id} style={{ fontSize: 12.5, color: "#6b4c14" }}>چک {c.type === "received" ? "دریافتی" : "پرداختی"} {c.payee} — {daysUntil(c.dueDate) < 0 ? "سررسید گذشته" : `${toFaInt(daysUntil(c.dueDate))} روز مانده`}</div>
          ))}
        </div>
      )}

      {layout === "cards" ? (
        sectionOrder.map(({ key }) => {
          const m = SECTION_META[key];
          if (!m) return null;
          return (
            <CollapsibleSection key={key} color={m.color} title={m.title} open={!!open[key]} onToggle={() => toggle(key)} onAdd={sectionAddHandler(key)} radius={key === "shortcut" ? 20 : 14}>
              {sectionBody(key)}
            </CollapsibleSection>
          );
        })
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
          {sectionOrder.map(({ key }) => {
            const m = SECTION_META[key];
            if (!m) return null;
            return (
              <button key={key} onClick={() => toggle(key)} style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 8, background: t.card, border: "none",
                borderRadius: 14, padding: "16px 6px", cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.08)"
              }}>
                <span style={{ width: 44, height: 44, borderRadius: 12, background: m.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>{m.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: t.text, textAlign: "center" }}>{m.title}</span>
              </button>
            );
          })}
        </div>
      )}
      {layout === "icons" && sectionOrder.map(({ key }) => {
        const m = SECTION_META[key];
        if (!m || !open[key]) return null;
        return (
          <div key={key} style={{ background: t.card, borderRadius: 14, padding: "10px 14px", marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontWeight: 700, color: m.color, fontSize: 13.5 }}>{m.title}</div>
              {sectionAddHandler(key) && (
                <button onClick={sectionAddHandler(key)} style={{ width: 26, height: 26, borderRadius: "50%", background: m.color, border: "none", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <Plus size={14} />
                </button>
              )}
            </div>
            {sectionBody(key)}
          </div>
        );
      })}
    </div>
  );
}
const navArrowStyle = (t) => ({ width: 30, height: 30, borderRadius: "50%", border: "none", background: t.card, color: BRAND.header, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", cursor: "pointer" });

function CurrencyRatesStrip({ rates, fetchRates }) {
  const t = useT();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 16, fontSize: 12, color: t.sub }}>
      <DollarSign size={13} />
      {rates?.usd ? (
        <span>هر دلار ≈ {toFaInt(Math.round(rates.usd))} ریال {rates.source === "tgju" ? "· بازار آزاد TGJU" : rates.source === "manual" ? "(دستی)" : ""}</span>
      ) : (
        <span>نرخ ارز در دسترس نیست</span>
      )}
      <button onClick={fetchRates} style={{ background: "none", border: "none", cursor: "pointer", color: t.sub, display: "flex" }}><RefreshCw size={13} /></button>
    </div>
  );
}


/* ---------------------------------------------------------
   Transactions View
--------------------------------------------------------- */
function TransactionSummaryChart({ transactions, onSelect }) {
  const t = useT();
  const [selected, setSelected] = useState(null);
  const summary = useMemo(() => {
    const incomeTx = transactions.filter((x) => x.type === "income");
    const expenseTx = transactions.filter((x) => x.type === "expense");
    return [
      { name: "هزینه", amount: expenseTx.reduce((s, x) => s + x.amount, 0), type: "expense", count: expenseTx.length },
      { name: "درآمد", amount: incomeTx.reduce((s, x) => s + x.amount, 0), type: "income", count: incomeTx.length },
    ];
  }, [transactions]);
  if (!summary.some((x) => x.amount > 0)) return null;
  const detail = selected ? summary.find((x) => x.type === selected) : null;
  return <div style={{ background: t.card, borderRadius: 14, padding: 12, margin: "8px 14px 16px", boxShadow: "0 1px 4px rgba(0,0,0,.07)" }}>
    <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 6 }}>خلاصه همه تراکنش‌ها</div>
    <ResponsiveContainer width="100%" height={190}>
      <BarChart data={summary} onClick={(e) => { const p = e?.activePayload?.[0]?.payload; if (p) { setSelected(p.type); onSelect?.(p.type); } }}>
        <XAxis dataKey="name" tick={{ fontFamily: FONT, fontSize: 11 }} />
        <YAxis tick={{ fontFamily: FONT, fontSize: 10 }} width={45} />
        <Tooltip formatter={(v) => `${toFaInt(v)} ریال`} contentStyle={{ fontFamily: FONT, direction: "rtl" }} />
        <Bar dataKey="amount" radius={[8,8,0,0]} cursor="pointer">
          {summary.map((x, i) => <Cell key={i} fill={x.type === "income" ? BRAND.darkgreen : BRAND.crimson} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    {detail ? (
      <div style={{ background: detail.type === "income" ? "#eef8f1" : "#fff0f3", borderRadius: 10, padding: 10, textAlign: "center", fontSize: 12.5, fontWeight: 700, color: detail.type === "income" ? BRAND.darkgreen : BRAND.crimson }}>
        {detail.name}: {toFaInt(detail.amount)} ریال · {toFaInt(detail.count)} تراکنش
      </div>
    ) : <div style={{ textAlign: "center", color: t.sub, fontSize: 11.5 }}>روی ستون درآمد یا هزینه لمس کن تا جزئیات و همان موارد را ببینی.</div>}
  </div>;
}

function TransactionsView({ transactions, catById, accById, checks = [], filter, setFilter, onDelete, onEdit, search, setSearch }) {
  const t = useT();
  const [preview, setPreview] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const checkStatusLabel = { pending: "در انتظار", cashed: "نقد شده", bounced: "برگشتی" };
  const checkPseudo = checks.map((c) => ({
    id: "chk-" + c.id, __isCheck: true, type: "check", amount: c.amount, date: c.dueDate,
    note: `چک ${c.type === "received" ? "دریافتی" : "پرداختی"} — ${c.payee}`, checkStatus: c.status,
  }));
  const combined = [...transactions, ...checkPseudo];
  const filtered = combined.filter((tx) => {
    if (filter !== "all" && tx.type !== filter) return false;
    if (search.trim()) {
      const q = search.trim();
      const hay = `${catById(tx.categoryId)?.name || ""} ${tx.note || ""} ${(tx.tags || []).join(" ")} ${tx.amount}`;
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach((tx) => { (map[tx.date] = map[tx.date] || []).push(tx); });
    return Object.entries(map).sort((a, b) => new Date(b[0]) - new Date(a[0]));
  }, [filtered]);
  const tabs = [{ key: "all", label: "همه" }, { key: "expense", label: "پرداخت ها" }, { key: "income", label: "دریافت ها" }, { key: "transfer", label: "انتقال ها" }, { key: "check", label: "چک ها" }];

  return (
    <div>
      <div style={{ padding: "10px 14px 0" }}>
        <div style={{ position: "relative" }}>
          <Search size={16} color={t.sub} style={{ position: "absolute", top: 12, right: 12 }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجو در تراکنش‌ها، برچسب یا یادداشت..."
            style={{ width: "100%", padding: "10px 36px 10px 12px", borderRadius: 10, border: `1.5px solid ${t.inputBorder}`, background: t.input, color: t.text, fontSize: 13.5, outline: "none", marginBottom: 10 }} />
        </div>
      </div>
      <div style={{ display: "flex", background: BRAND.header, padding: "0 8px 12px", gap: 4 }}>
        {tabs.map((tItem) => (
          <button key={tItem.key} onClick={() => setFilter(tItem.key)} style={{ flex: 1, padding: "8px 4px", border: "none", borderRadius: 8, cursor: "pointer", background: filter === tItem.key ? "rgba(255,255,255,0.18)" : "transparent", color: "#fff", fontWeight: filter === tItem.key ? 700 : 500, fontSize: 12.5 }}>{tItem.label}</button>
        ))}
      </div>
      <div style={{ padding: "12px 14px" }}>
        {grouped.length === 0 && <EmptyRow text="تراکنشی یافت نشد" />}
        {grouped.map(([date, txs]) => {
          const dayTotal = txs.reduce((s, tx) => s + (tx.type === "expense" ? -tx.amount : tx.type === "income" ? tx.amount : 0), 0);
          return (
            <div key={date} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 12.5, color: t.sub, fontWeight: 600 }}>{faLongDate(new Date(date))}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: dayTotal >= 0 ? BRAND.darkgreen : BRAND.crimson }}>{dayTotal >= 0 ? "+" : "-"}{toFaInt(Math.abs(dayTotal))} ریال</span>
              </div>
              {txs.map((tx) => {
                if (tx.__isCheck) {
                  const statusColor2 = { pending: BRAND.gold, cashed: BRAND.darkgreen, bounced: BRAND.crimson }[tx.checkStatus];
                  return (
                    <div key={tx.id} style={{ background: t.card, borderRadius: 12, padding: 14, marginBottom: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", border: `1px dashed ${statusColor2}55` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ display: "flex", gap: 10 }}>
                          <span style={{ width: 38, height: 38, borderRadius: 10, background: statusColor2 + "22", color: statusColor2, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><FileSpreadsheet size={18} /></span>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{tx.note}</div>
                            <div style={{ fontSize: 12, color: t.sub, marginTop: 3 }}>سررسید چک — <StatusBadge text={checkStatusLabel[tx.checkStatus]} color={statusColor2} /></div>
                          </div>
                        </div>
                        <div style={{ textAlign: "left" }}>
                          <div style={{ fontWeight: 800, color: statusColor2, fontSize: 14.5 }}>{toFaInt(tx.amount)}</div>
                          <button onClick={() => setExpandedId(expandedId === tx.id ? null : tx.id)} style={{ marginTop: 6, background: expandedId === tx.id ? BRAND.violet : "#f1eef4", color: expandedId === tx.id ? "#fff" : "#5f566b", border: "none", borderRadius: 7, padding: "5px 9px", fontSize: 11, fontWeight: 700 }}>{expandedId === tx.id ? "بستن" : "جزئیات"}</button>
                        </div>
                      </div>
                      {expandedId === tx.id && (() => {
                        const c = checks.find(x => x.id === tx.id.replace("chk-", ""));
                        return c ? <div style={{ marginTop: 10, padding: 10, borderRadius: 9, background: "#f8f6fa", fontSize: 11.5 }}>
                          {[
                            ["نوع", c.type === "received" ? "چک دریافتی" : "چک پرداختی"],
                            ["طرف حساب", c.payee || "—"], ["مبلغ", `${toFaInt(c.amount)} ریال`],
                            ["شناسه صیادی", c.sayadId || "—"], ["شماره چک", c.checkNumber || "—"],
                            ["حساب", accById(c.accountId)?.name || "—"], ["سررسید", c.dueDate ? faLongDate(new Date(c.dueDate)) : "—"],
                            ["وضعیت", checkStatusLabel[c.status] || "—"], ["یادداشت", c.note || "—"]
                          ].map(([k,v]) => <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", borderBottom: `1px solid ${t.border}` }}><span style={{ color: t.sub }}>{k}</span><strong>{v}</strong></div>)}
                        </div> : null;
                      })()}
                    </div>
                  );
                }
                const cat = catById(tx.categoryId), acc = accById(tx.accountId), toAcc = accById(tx.toAccountId);
                const color = tx.type === "expense" ? BRAND.crimson : tx.type === "income" ? BRAND.darkgreen : BRAND.violet;
                const Icon = tx.type === "expense" ? TrendingDown : tx.type === "income" ? TrendingUp : ArrowLeftRight;
                return (
                  <div key={tx.id} style={{ background: t.card, borderRadius: 12, padding: 14, marginBottom: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ display: "flex", gap: 10 }}>
                        <span style={{ width: 38, height: 38, borderRadius: 10, background: color + "22", color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon size={18} /></span>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{tx.type === "transfer" ? `انتقال به ${toAcc?.name || "—"}` : (cat?.name || "بدون دسته")}</div>
                          <div style={{ fontSize: 12, color: t.sub, marginTop: 3 }}>{tx.type === "expense" ? "از حساب" : tx.type === "income" ? "به حساب" : "از حساب"}: {acc?.name || catById(tx.fromCategoryId)?.name || "—"}</div>
                          {tx.note && <div style={{ fontSize: 12, color: t.sub, marginTop: 2 }}>{tx.note}</div>}
                          {tx.loanId && <span style={{ display: "inline-block", marginTop: 4, marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: "#8a5a00", background: "rgba(245,158,11,.16)", borderRadius: 10, padding: "1px 8px" }}>{tx.loanRole === "receipt" ? "دریافت وام" : "قسط وام"}</span>}
                          {tx.side && <span style={{ display: "inline-block", marginTop: 4, fontSize: 10.5, fontWeight: 700, color: BRAND.violet, background: "rgba(88,39,119,.10)", borderRadius: 10, padding: "1px 8px" }}>{tx.side === "debtor" ? "بدهکار" : "بستانکار"}</span>}
                          {(tx.tags || []).length > 0 && (
                            <div style={{ display: "flex", gap: 5, marginTop: 5, flexWrap: "wrap" }}>
                              {tx.tags.map((tag, i) => <span key={i} style={{ fontSize: 10.5, background: t.border, color: t.sub, padding: "2px 8px", borderRadius: 20 }}>{tag}</span>)}
                            </div>
                          )}
                          {tx.photo && <img src={tx.photo} onClick={() => setPreview(tx.photo)} style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", marginTop: 6, cursor: "pointer" }} />}
                        </div>
                      </div>
                      <div style={{ textAlign: "left" }}>
                        <div style={{ fontWeight: 800, color, fontSize: 14.5 }}>{toFaInt(tx.amount)}</div>
                        <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                          <button onClick={() => setExpandedId(expandedId === tx.id ? null : tx.id)} style={{ background: expandedId === tx.id ? BRAND.violet : "#f1eef4", border: "none", color: expandedId === tx.id ? "#fff" : "#5f566b", cursor: "pointer", padding: "5px 8px", borderRadius: 7, fontSize: 11, fontWeight: 700 }} title="جزئیات">{expandedId === tx.id ? "بستن" : "جزئیات"}</button>
                          <button onClick={() => onEdit?.(tx)} style={{ background: "none", border: "none", color: BRAND.violet, cursor: "pointer", padding: 3 }} title="ویرایش"><Pencil size={15} /></button>
                          <button onClick={() => { if (window.confirm("این تراکنش حذف شود؟")) onDelete(tx.id); }} style={{ background: "none", border: "none", color: BRAND.crimson, cursor: "pointer", padding: 3 }} title="حذف"><Trash2 size={15} /></button>
                        </div>
                      </div>
                    </div>
                    {expandedId === tx.id && (
                      <div style={{ marginTop: 10, padding: 11, borderRadius: 10, background: "#f8f6fa", border: "1px solid #ebe6f0", fontSize: 11.5 }}>
                        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>جزئیات کامل تراکنش</div>
                        {[
                          ["نوع", tx.type === "expense" ? "هزینه / پرداخت" : tx.type === "income" ? "درآمد / دریافت" : "انتقال بین حساب‌ها"],
                          ["مبلغ", `${toFaInt(tx.amount)} ریال`],
                          ["تاریخ", tx.date ? faLongDate(new Date(tx.date)) : "—"],
                          ["ساعت", tx.time || "—"],
                          ["حساب", acc?.name || "—"],
                          ["حساب مقصد", toAcc?.name || "—"],
                          ["دسته‌بندی", cat?.name || "—"],
                          ["شرح", tx.note || "—"],
                          ["برچسب‌ها", (tx.tags || []).join("، ") || "—"],
                          ["طرف حساب", tx.payee || tx.counterparty || "—"],
                          ["عضو / پروژه", tx.project || tx.member || tx.event || "—"],
                          ["منبع ثبت", tx.sourceType || "ثبت دستی"],
                          ["شناسه تراکنش", tx.id || "—"],
                          ["شناسه مرتبط", tx.sourceId || tx.loanId || tx.debtId || tx.billId || tx.assetId || "—"],
                        ].map(([k,v]) => <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", borderBottom: `1px solid ${t.border}` }}><span style={{ color: t.sub }}>{k}</span><strong style={{ textAlign: "left", maxWidth: "65%", wordBreak: "break-word" }}>{v}</strong></div>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <TransactionSummaryChart transactions={transactions} onSelect={(kind) => setFilter(kind)} />
      {preview && (
        <div onClick={() => setPreview(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70, maxWidth: 480, margin: "0 auto" }}>
          <img src={preview} style={{ maxWidth: "88%", maxHeight: "70%", borderRadius: 10 }} />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   Operations View
--------------------------------------------------------- */
function OperationsView({ setSubView, onAdd }) {
  const st = useStyles();
  const items = [
    { title: "اهداف مالی و پس‌انداز", icon: <Target size={17} />, color: BRAND.green, key: "goals" },
    { title: "واحدهای پولی", icon: <DollarSign size={17} />, color: BRAND.gold, key: "currencies" },
    { title: "ماشین حساب", icon: <Type size={17} />, color: BRAND.teal, key: "calculator" },
    { title: "پشتیبانی و تیکت", icon: <Bell size={17} />, color: BRAND.header, key: "support" },
    { title: "حساب‌ها و کارت‌ها", icon: <Landmark size={17} />, color: BRAND.violet, key: "accounts" },
    { title: "دسته‌بندی‌ها و برچسب‌ها", icon: <Tag size={17} />, color: BRAND.mauve, key: "categories" },
    { title: "بودجه‌بندی", icon: <Save size={17} />, color: BRAND.green, key: "budgets" },
    { title: "تراکنش‌های تکرارشونده", icon: <Repeat size={17} />, color: BRAND.teal, key: "recurring" },
    { title: "چک‌ها", icon: <FileSpreadsheet size={17} />, color: BRAND.gold, key: "checks" },
    { title: "وام و اقساط", icon: <Bank size={17} />, color: BRAND.crimson, key: "loans" },
    { title: "یادآوری قبض‌ها", icon: <BellRing size={17} />, color: BRAND.orange, key: "bills" },
    { title: "دارایی‌ها (ارز دیجیتال / بورس)", icon: <Bitcoin size={17} />, color: "#7a5cff", key: "assets" },
    { title: "اعضای منزل، رویداد و پروژه", icon: <Users size={17} />, color: BRAND.violet, key: "tags" },
    { title: "دوره مالی", icon: <CalendarDays size={17} />, color: BRAND.darkgreen, key: "periods" },
    { title: "اسکن برگه پوز (دوربین)", icon: <Receipt size={17} />, color: BRAND.fab, key: "slip" },
    { title: "پیامک بانکی (افزودن نیمه‌خودکار)", icon: <BellRing size={17} />, color: "#666", key: "sms" },
    { title: "تقویم شمسی", icon: <CalendarDays size={17} />, color: BRAND.header, key: "calendar" },
    { title: "اطلاعات کاربری", icon: <Users size={17} />, color: "#444", key: "profile" },
    { title: "تنظیمات و پشتیبان‌گیری", icon: <ShieldCheck size={17} />, color: "#555", key: "settings" },
  ];
  return (
    <div style={{ padding: "10px 16px" }}>
      <div style={{ ...st.card, padding: "4px 12px" }}>
        {items.map((it) => <Row key={it.key} title={it.title} leftIcon={it.icon} leftColor={it.color} onClick={() => setSubView(it.key)} />)}
        <Row title="ثبت تراکنش جدید" leftIcon={<Plus size={17} />} leftColor={BRAND.fab} onClick={onAdd} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Reports View
--------------------------------------------------------- */
const PIE_COLORS = ["#B01E4A", "#6C3FA0", "#4E9AA0", "#A98A3B", "#3E1461", "#1E8449", "#A65475", "#555"];
/* ---------------------------------------------------------
   گزارش‌های جدید: خلاصه، هزینه/درآمد با نمودار، مانده حساب‌ها، صورتحساب، ترازنامه
   هر گزارش یک «سند» می‌سازد که هم روی صفحه نمایش داده می‌شود و هم به Excel و PDF می‌رود.
--------------------------------------------------------- */
const jf = (iso) => { try { return new Intl.DateTimeFormat("fa-IR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)); } catch { return iso; } };
const ACC_TYPE_FA = { bank: "بانک", card: "کارت", fund: "صندوق", cash: "نقد" };
const accTypeFa = (ty) => ACC_TYPE_FA[ty] || "حساب";
const isoOf = (d) => (d ? d.toISOString().slice(0, 10) : todayISO());
function reportRange(kind, from, to) {
  const today = todayISO();
  if (kind === "day") return { from: today, to: today };
  if (kind === "week") return { from: addDays(today, -6), to: today };
  if (kind === "month" || kind === "year") {
    const p = jalaliParts(new Date(today));
    return { from: isoOf(findJalaliMonthStart(p.y, kind === "year" ? 1 : p.m)), to: today };
  }
  const a = from || today, b = to || today;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}
const RANGE_KINDS = [["day", "امروز"], ["week", "هفتگی"], ["month", "ماهیانه"], ["year", "سالیانه"], ["custom", "بازه دلخواه"]];
function useRangeState(initial = "month") {
  const [kind, setKind] = useState(initial);
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  return { kind, setKind, from, setFrom, to, setTo, range: reportRange(kind, from, to) };
}
function txDelta(tx, accId) {
  if (tx.type === "expense" && tx.accountId === accId) return -tx.amount;
  if (tx.type === "income" && tx.accountId === accId) return tx.amount;
  if (tx.type === "transfer") return (tx.accountId === accId ? -tx.amount : 0) + (tx.toAccountId === accId ? tx.amount : 0);
  return 0;
}
const balanceAtDate = (acc, txs, iso) => txs.reduce((b, tx) => (tx.date <= iso ? b + txDelta(tx, acc.id) : b), acc.initial || 0);
function accountFlow(acc, txs, from, to) {
  const f = { income: 0, expense: 0, tin: 0, tout: 0, count: 0 };
  for (const tx of txs) {
    if (tx.date < from || tx.date > to) continue;
    if (tx.type === "income" && tx.accountId === acc.id) { f.income += tx.amount; f.count++; }
    else if (tx.type === "expense" && tx.accountId === acc.id) { f.expense += tx.amount; f.count++; }
    else if (tx.type === "transfer") {
      if (tx.accountId === acc.id) { f.tout += tx.amount; f.count++; }
      if (tx.toAccountId === acc.id) { f.tin += tx.amount; f.count++; }
    }
  }
  return f;
}

function RangePicker({ rs }) {
  const st = useStyles(); const t = useT();
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {RANGE_KINDS.map(([k, l]) => (
          <button key={k} onClick={() => rs.setKind(k)} style={{ padding: "7px 12px", borderRadius: 18, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, background: rs.kind === k ? BRAND.header : t.input, color: rs.kind === k ? "#fff" : t.text }}>{l}</button>
        ))}
      </div>
      {rs.kind === "custom" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><label style={st.label}>از تاریخ</label><JalaliDateInput value={rs.from} onChange={rs.setFrom} style={st.input} /></div>
          <div><label style={st.label}>تا تاریخ</label><JalaliDateInput value={rs.to} onChange={rs.setTo} style={st.input} /></div>
        </div>
      )}
      <div style={{ fontSize: 12, color: t.sub }}>بازه‌ی گزارش: {jf(rs.range.from)} تا {jf(rs.range.to)}</div>
    </div>
  );
}
function AccountPicker({ accounts, value, onChange, allowAll = false, label = "حساب" }) {
  const st = useStyles(); const t = useT(); const [open, setOpen] = useState(false);
  const cur = value === "__all" ? "همه حساب‌ها" : accounts.find((a) => a.id === value)?.name || "انتخاب حساب";
  const options = [...(allowAll ? [{ id: "__all", name: "همه حساب‌ها", sub: "" }] : []), ...accounts.map((a) => ({ id: a.id, name: a.name, sub: accTypeFa(a.type) }))];
  return (
    <>
      <label style={st.label}>{label}</label>
      <button type="button" onClick={() => setOpen(true)} style={{ ...st.input, textAlign: "right", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", fontFamily: "inherit" }}>
        <span>{cur}</span><ChevronDown size={16} />
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 500, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: t.card, width: "100%", maxWidth: 480, maxHeight: "70vh", overflowY: "auto", borderRadius: "20px 20px 0 0", padding: 16 }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>انتخاب حساب (فقط یکی)</div>
            {options.map((o) => {
              const on = o.id === value;
              return (
                <button key={o.id} type="button" onClick={() => { onChange(o.id); setOpen(false); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 6px", border: "none", borderBottom: `1px solid ${t.border}`, background: "transparent", cursor: "pointer", fontFamily: "inherit", color: t.text, textAlign: "right" }}>
                  <span style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${on ? BRAND.header : t.sub}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{on && <span style={{ width: 10, height: 10, borderRadius: "50%", background: BRAND.header }} />}</span>
                  <span style={{ flex: 1, fontSize: 14.5, fontWeight: on ? 800 : 600 }}>{o.name}</span>
                  {o.sub && <span style={{ fontSize: 12, color: t.sub }}>{o.sub}</span>}
                </button>
              );
            })}
            {!options.length && <div style={{ color: t.sub, textAlign: "center", padding: 14 }}>حسابی تعریف نشده است</div>}
          </div>
        </div>
      )}
    </>
  );
}
function ExportBar({ doc }) {
  const st = useStyles(); const [busy, setBusy] = useState(""); const [msg, setMsg] = useState("");
  const run = async (kind) => {
    if (busy || !doc) return;
    setBusy(kind); setMsg("");
    try { await (kind === "xlsx" ? exportDocXlsx : exportDocPdf)(doc); }
    catch (e) { if (!/cancel/i.test(String(e?.message || e))) setMsg("خروجی گرفته نشد: " + (e?.message || e)); }
    setBusy("");
  };
  const b = (bg) => ({ ...st.primaryBtn, background: bg, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: busy ? 0.7 : 1 });
  return (
    <div className="no-print" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => run("xlsx")} style={b(BRAND.green)}><FileSpreadsheet size={16} /> {busy === "xlsx" ? "در حال ساخت..." : "خروجی Excel"}</button>
        <button onClick={() => run("pdf")} style={b("#555")}><Printer size={16} /> {busy === "pdf" ? "در حال ساخت..." : "خروجی PDF"}</button>
      </div>
      {msg && <div style={{ marginTop: 8, fontSize: 12.5, color: BRAND.crimson, fontWeight: 700 }}>{msg}</div>}
    </div>
  );
}
function DocView({ doc, maxRows = 300 }) {
  const t = useT(); const st = useStyles();
  return (
    <>
      {(doc?.sections || []).map((sec, i) => {
        const ncol = sec.head ? sec.head.length : Math.max(1, ...sec.rows.map((r) => r.length));
        const rows = sec.rows.slice(0, maxRows);
        return (
          <div key={i} style={{ ...st.card, padding: 12, marginBottom: 14 }}>
            {sec.title && <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8 }}>{sec.title}</div>}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: ncol > 4 ? ncol * 92 : undefined }}>
                {sec.head && <thead><tr>{sec.head.map((h, k) => <th key={k} style={{ textAlign: "right", padding: "8px 6px", background: t.input, color: t.text, fontWeight: 800, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>}
                <tbody>
                  {rows.map((r, ri) => (
                    <tr key={ri} style={{ borderBottom: `1px solid ${t.border}` }}>
                      {r.map((v, ci) => {
                        const num = typeof v === "number";
                        return <td key={ci} style={{ padding: "8px 6px", textAlign: "right", color: num ? (v < 0 ? BRAND.crimson : BRAND.darkgreen) : t.text, fontWeight: num ? 700 : 500, whiteSpace: num ? "nowrap" : "normal" }}>{num ? toFaInt(v) : v}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!sec.rows.length && <div style={{ textAlign: "center", color: t.sub, fontSize: 12, padding: 10 }}>موردی نیست</div>}
            {sec.rows.length > maxRows && <div style={{ textAlign: "center", color: t.sub, fontSize: 12, padding: 8 }}>{toFaInt(maxRows)} ردیف اول از {toFaInt(sec.rows.length)} نمایش داده شد؛ فایل Excel/PDF همه‌ی ردیف‌ها را دارد.</div>}
          </div>
        );
      })}
    </>
  );
}
function PieBlock({ title, data, color }) {
  const t = useT(); const st = useStyles();
  const total = data.reduce((s, d) => s + d.amount, 0);
  return (
    <div style={{ ...st.card, padding: 12, marginBottom: 14 }}>
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4, color }}>{title}: {toFaInt(total)} ریال</div>
      {!data.length ? <div style={{ textAlign: "center", color: t.sub, fontSize: 12.5, padding: 18 }}>در این بازه موردی نیست</div> : (
        <>
          <ResponsiveContainer width="100%" height={190}>
            <PieChart>
              <Pie data={data} dataKey="amount" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={2} stroke="none" isAnimationActive={false}>
                {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          {data.map((d, i) => (
            <div key={d.name + i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 2px", borderTop: `1px solid ${t.border}` }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{d.name}</span>
              <span style={{ fontSize: 11.5, color: t.sub }}>{faDigits(Math.round((d.amount / total) * 100))}٪</span>
              <span style={{ fontSize: 13, fontWeight: 800, color }}>{toFaInt(d.amount)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
const catTotals = (txs, type, categories) => {
  const map = {};
  txs.forEach((tx) => { if (tx.type === type) { const n = categories.find((c) => c.id === tx.categoryId)?.name || "بدون دسته"; map[n] = (map[n] || 0) + tx.amount; } });
  return Object.entries(map).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
};
const pctText = (v, total) => `${faDigits(total ? Math.round((v / total) * 100) : 0)}٪`;

function SummaryReport({ accounts, transactions, categories }) {
  const st = useStyles(); const t = useT();
  const rs = useRangeState("month");
  const [accId, setAccId] = useState(accounts[0]?.id || null);
  const acc = accounts.find((a) => a.id === accId);
  const { from, to } = rs.range;
  const data = useMemo(() => {
    if (!acc) return null;
    const opening = balanceAtDate(acc, transactions, addDays(from, -1));
    const f = accountFlow(acc, transactions, from, to);
    const closing = opening + f.income + f.tin - f.expense - f.tout;
    const cats = catTotals(transactions.filter((x) => x.accountId === acc.id && x.date >= from && x.date <= to), "expense", categories);
    return { opening, f, closing, cats };
  }, [acc, transactions, categories, from, to]);
  const doc = data && {
    title: `خلاصه گزارش - ${acc.name}`, subtitle: `از ${jf(from)} تا ${jf(to)}`,
    sections: [
      { title: "خلاصه", rows: [["مانده ابتدای دوره", data.opening], ["جمع دریافت‌ها", data.f.income], ["جمع پرداخت‌ها", -data.f.expense], ["انتقال به این حساب", data.f.tin], ["انتقال از این حساب", -data.f.tout], ["مانده پایان دوره", data.closing], ["تعداد تراکنش", toFaInt(data.f.count)]] },
      { title: "هزینه به تفکیک دسته", head: ["دسته", "مبلغ", "درصد"], rows: data.cats.map((c) => [c.name, c.amount, pctText(c.amount, data.f.expense)]) },
    ],
  };
  return (
    <div>
      <ExportBar doc={doc} />
      <div style={{ ...st.card, padding: 14, marginBottom: 14 }}>
        <AccountPicker accounts={accounts} value={accId} onChange={setAccId} />
        <RangePicker rs={rs} />
      </div>
      {data ? (
        <>
          <div style={{ ...st.card, padding: 16, marginBottom: 14, textAlign: "center" }}>
            <div style={{ fontSize: 12, color: t.sub }}>مانده پایان دوره — {acc.name}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: data.closing >= 0 ? BRAND.darkgreen : BRAND.crimson, marginTop: 4 }}>{toFaInt(data.closing)} <span style={{ fontSize: 12 }}>ریال</span></div>
          </div>
          <DocView doc={doc} />
        </>
      ) : <div style={{ textAlign: "center", color: t.sub, padding: 20 }}>ابتدا یک حساب تعریف کنید.</div>}
    </div>
  );
}

function IncomeExpenseReport({ accounts, transactions, categories }) {
  const st = useStyles();
  const rs = useRangeState("month");
  const { from, to } = rs.range;
  const d = useMemo(() => {
    const txs = transactions.filter((x) => x.date >= from && x.date <= to);
    const inc = catTotals(txs, "income", categories), exp = catTotals(txs, "expense", categories);
    const income = inc.reduce((s, x) => s + x.amount, 0), expense = exp.reduce((s, x) => s + x.amount, 0);
    const accRows = accounts.map((a) => { const f = accountFlow(a, transactions, from, to); return [a.name, accTypeFa(a.type), f.income, -f.expense, balanceAtDate(a, transactions, to)]; });
    return { inc, exp, income, expense, accRows };
  }, [accounts, transactions, categories, from, to]);
  const doc = {
    title: "گزارش هزینه و درآمد", subtitle: `از ${jf(from)} تا ${jf(to)}`,
    sections: [
      { title: "خلاصه", rows: [["جمع درآمد", d.income], ["جمع هزینه", -d.expense], ["خالص (سود / زیان)", d.income - d.expense]] },
      { title: "درآمد به تفکیک دسته", head: ["دسته", "مبلغ", "درصد"], rows: d.inc.map((c) => [c.name, c.amount, pctText(c.amount, d.income)]) },
      { title: "هزینه به تفکیک دسته", head: ["دسته", "مبلغ", "درصد"], rows: d.exp.map((c) => [c.name, -c.amount, pctText(c.amount, d.expense)]) },
      { title: "موجودی هر حساب در پایان بازه", head: ["حساب", "نوع", "دریافت", "پرداخت", "موجودی"], rows: d.accRows },
    ],
  };
  return (
    <div>
      <ExportBar doc={doc} />
      <div style={{ ...st.card, padding: 14, marginBottom: 14 }}><RangePicker rs={rs} /></div>
      <DocView doc={{ sections: [doc.sections[0]] }} />
      <PieBlock title="درآمد" data={d.inc} color={BRAND.darkgreen} />
      <PieBlock title="هزینه" data={d.exp} color={BRAND.crimson} />
      <DocView doc={{ sections: [doc.sections[3]] }} />
    </div>
  );
}

function BalancesReport({ accounts, transactions }) {
  const st = useStyles(); const t = useT();
  const rs = useRangeState("day");
  const { from, to } = rs.range;
  const rows = useMemo(() => accounts.map((a) => {
    const opening = balanceAtDate(a, transactions, addDays(from, -1)), f = accountFlow(a, transactions, from, to);
    return [a.name, accTypeFa(a.type), opening, f.income + f.tin, -(f.expense + f.tout), opening + f.income + f.tin - f.expense - f.tout];
  }), [accounts, transactions, from, to]);
  const sum = (i) => rows.reduce((s, r) => s + r[i], 0);
  const doc = {
    title: "گزارش مانده حساب‌ها", subtitle: `از ${jf(from)} تا ${jf(to)}`,
    sections: [{ title: "همه‌ی حساب‌ها", head: ["حساب", "نوع", "مانده ابتدا", "دریافت", "پرداخت", "مانده پایان"], rows: [...rows, ["جمع کل", "", sum(2), sum(3), sum(4), sum(5)]] }],
  };
  return (
    <div>
      <ExportBar doc={doc} />
      <div style={{ ...st.card, padding: 14, marginBottom: 14 }}><RangePicker rs={rs} /></div>
      <div style={{ ...st.card, padding: 16, marginBottom: 14, textAlign: "center" }}>
        <div style={{ fontSize: 12, color: t.sub }}>جمع مانده‌ی همه‌ی حساب‌ها در پایان بازه</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: sum(5) >= 0 ? BRAND.darkgreen : BRAND.crimson, marginTop: 4 }}>{toFaInt(sum(5))} <span style={{ fontSize: 12 }}>ریال</span></div>
      </div>
      <DocView doc={doc} />
    </div>
  );
}

function StatementReport({ accounts, transactions, categories, members, projects, events }) {
  const st = useStyles(); const t = useT();
  const rs = useRangeState("month");
  const [accId, setAccId] = useState("__all");
  const [opt, setOpt] = useState({ note: true, category: false, member: false, project: false, event: false, tags: false });
  const { from, to } = rs.range;
  const single = accId !== "__all" ? accounts.find((a) => a.id === accId) : null;
  const nameOf = (list, id) => list.find((x) => x.id === id)?.name || "";
  const doc = useMemo(() => {
    const txs = transactions
      .filter((x) => x.date >= from && x.date <= to && (!single || x.accountId === single.id || x.toAccountId === single.id))
      .sort((a, b) => (a.date + (a.time || "") + (a.createdAt || "")).localeCompare(b.date + (b.time || "") + (b.createdAt || "")));
    let bal = single ? balanceAtDate(single, transactions, addDays(from, -1)) : 0;
    const opening = bal;
    const head = ["تاریخ", "نوع", ...(single ? [] : ["حساب"]), "مبلغ", ...(single ? ["مانده"] : []),
      ...(opt.note ? ["شرح"] : []), ...(opt.category ? ["دسته"] : []), ...(opt.member ? ["عضو خانواده"] : []),
      ...(opt.project ? ["پروژه"] : []), ...(opt.event ? ["رویداد"] : []), ...(opt.tags ? ["برچسب"] : [])];
    let inc = 0, exp = 0;
    const rows = txs.map((x) => {
      const typeFa = x.type === "income" ? "دریافت" : x.type === "expense" ? "پرداخت" : "انتقال";
      let amount;
      if (single) { const dlt = txDelta(x, single.id); bal += dlt; amount = dlt; if (dlt >= 0) inc += dlt; else exp += -dlt; }
      else { amount = x.type === "income" ? x.amount : x.type === "expense" ? -x.amount : toFaInt(x.amount); if (x.type === "income") inc += x.amount; if (x.type === "expense") exp += x.amount; }
      const accCell = x.type === "transfer" ? `${nameOf(accounts, x.accountId)} ← ${nameOf(accounts, x.toAccountId)}` : nameOf(accounts, x.accountId);
      return [jf(x.date), typeFa, ...(single ? [] : [accCell]), amount, ...(single ? [bal] : []),
        ...(opt.note ? [x.note || ""] : []), ...(opt.category ? [nameOf(categories, x.categoryId)] : []), ...(opt.member ? [nameOf(members, x.memberId)] : []),
        ...(opt.project ? [nameOf(projects, x.projectId)] : []), ...(opt.event ? [nameOf(events, x.eventId)] : []), ...(opt.tags ? [(x.tags || []).join("، ")] : [])];
    });
    const sumRows = single
      ? [["مانده ابتدای دوره", opening], ["جمع ورودی", inc], ["جمع خروجی", -exp], ["مانده پایان دوره", bal], ["تعداد تراکنش", toFaInt(txs.length)]]
      : [["جمع دریافت‌ها", inc], ["جمع پرداخت‌ها", -exp], ["تعداد تراکنش", toFaInt(txs.length)]];
    return {
      title: `صورتحساب - ${single ? single.name : "همه حساب‌ها"}`, subtitle: `از ${jf(from)} تا ${jf(to)}`,
      sections: [{ title: "جمع‌بندی", rows: sumRows }, { title: "ریز تراکنش‌ها", head, rows }],
    };
  }, [transactions, accounts, categories, members, projects, events, single, from, to, opt]);
  const chips = [["note", "شرح"], ["category", "دسته"], ["member", "عضو خانواده"], ["project", "پروژه"], ["event", "رویداد"], ["tags", "برچسب"]];
  return (
    <div>
      <ExportBar doc={doc} />
      <div style={{ ...st.card, padding: 14, marginBottom: 14 }}>
        <AccountPicker accounts={accounts} value={accId} onChange={setAccId} allowAll />
        <RangePicker rs={rs} />
        <div style={{ fontSize: 12.5, fontWeight: 700, color: t.sub, marginBottom: 8 }}>نمایش در صورتحساب (با تیک زدن اضافه می‌شود)</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {chips.map(([k, l]) => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "6px 10px", borderRadius: 16, background: opt[k] ? `${BRAND.header}22` : t.input, cursor: "pointer", fontWeight: 600 }}>
              <input type="checkbox" checked={opt[k]} onChange={() => setOpt((o) => ({ ...o, [k]: !o[k] }))} style={{ accentColor: BRAND.header }} />{l}
            </label>
          ))}
        </div>
      </div>
      <DocView doc={doc} />
    </div>
  );
}

function BalanceSheetReport({ accounts, transactions, assets, debts, loans, checks, bills }) {
  const st = useStyles(); const t = useT();
  const [asOf, setAsOf] = useState(todayISO());
  const doc = useMemo(() => {
    const accRows = accounts.map((a) => [`${a.name} (${accTypeFa(a.type)})`, balanceAtDate(a, transactions, asOf)]);
    const accTotal = accRows.reduce((s, r) => s + r[1], 0);
    const assetRows = (assets || []).map((x) => [x.name || x.title || "دارایی", (Number(x.quantity) * Number(x.currentPrice)) || 0]).filter((r) => r[1]);
    const receivable = (debts || []).filter((d) => !d.settled && d.kind === "receivable").reduce((s, d) => s + Number(d.amount || 0), 0);
    const checksIn = (checks || []).filter((c) => c.status === "pending" && c.type === "received").reduce((s, c) => s + Number(c.amount || 0), 0);
    const assetLines = [...accRows, ...assetRows, ["طلب‌ها (بدهکاران)", receivable], ["چک‌های دریافتی در جریان", checksIn]].filter((r, i) => i < accRows.length || r[1]);
    const totalAssets = accTotal + assetRows.reduce((s, r) => s + r[1], 0) + receivable + checksIn;
    const payable = (debts || []).filter((d) => !d.settled && d.kind === "payable").reduce((s, d) => s + Number(d.amount || 0), 0);
    const loanRows = (loans || []).filter((l) => !l.spent).map((l) => [`وام: ${l.title}`, Math.max(0, Number(l.principal || 0) - (l.paidCount || 0) * Number(l.monthlyPayment || 0))]).filter((r) => r[1]);
    const checksOut = (checks || []).filter((c) => c.status === "pending" && c.type !== "received").reduce((s, c) => s + Number(c.amount || 0), 0);
    const unpaidBills = (bills || []).filter((b) => !b.paid).reduce((s, b) => s + Number(b.amount || 0), 0);
    const liabLines = [["بدهی‌ها (بستانکاران)", payable], ...loanRows, ["چک‌های پرداختی در جریان", checksOut], ["قبض‌های پرداخت‌نشده", unpaidBills]].filter((r) => r[1]);
    const totalLiab = liabLines.reduce((s, r) => s + r[1], 0);
    const spentLoanRows = (loans || []).filter((l) => l.spent).map((l) => [`وام: ${l.title}`, Math.max(0, Number(l.principal || 0) - (l.paidCount || 0) * Number(l.monthlyPayment || 0))]).filter((r) => r[1]);
    return {
      title: "ترازنامه", subtitle: `تا تاریخ ${jf(asOf)}`,
      sections: [
        { title: "دارایی‌ها", head: ["شرح", "مبلغ"], rows: [...assetLines, ["جمع دارایی‌ها", totalAssets]] },
        { title: "بدهی‌ها", head: ["شرح", "مبلغ"], rows: [...liabLines, ["جمع بدهی‌ها", -totalLiab]] },
        { title: "خالص دارایی (حقوق صاحب)", rows: [["دارایی‌ها − بدهی‌ها", totalAssets - totalLiab]] },
        ...(spentLoanRows.length ? [{ title: "وام‌های خرج‌شده (جزو جمع‌ها نیست)", head: ["شرح", "باقی‌مانده"], rows: spentLoanRows }] : []),
      ],
      net: totalAssets - totalLiab,
    };
  }, [accounts, transactions, assets, debts, loans, checks, bills, asOf]);
  return (
    <div>
      <ExportBar doc={doc} />
      <div style={{ ...st.card, padding: 14, marginBottom: 14 }}>
        <label style={st.label}>تا تاریخ</label>
        <JalaliDateInput value={asOf} onChange={setAsOf} style={st.input} />
        {asOf !== todayISO() && <div style={{ fontSize: 11.5, color: t.sub }}>موجودی حساب‌ها تا همین تاریخ حساب می‌شود؛ دارایی‌ها، وام‌ها، چک‌ها و قبض‌ها وضعیت فعلی هستند.</div>}
      </div>
      <div style={{ ...st.card, padding: 16, marginBottom: 14, textAlign: "center" }}>
        <div style={{ fontSize: 12, color: t.sub }}>خالص دارایی</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: doc.net >= 0 ? BRAND.darkgreen : BRAND.crimson, marginTop: 4 }}>{toFaInt(doc.net)} <span style={{ fontSize: 12 }}>ریال</span></div>
      </div>
      <DocView doc={doc} />
    </div>
  );
}

const REPORT_TILES = [
  { key: "summary", title: "خلاصه گزارش", style: { bg: "#EAE7FB", fg: "#6C56C8", icons: [ClipboardList] } },
  { key: "incexp", title: "گزارش هزینه و درآمد", style: { bg: "#B9FFF9", fg: "#14A39B", icons: [BarChart3] } },
  { key: "balances", title: "گزارش مانده حساب‌ها", style: { bg: "#FFF3C8", fg: "#E0A800", icons: [Wallet] } },
  { key: "statement", title: "گزارش صورتحساب", style: { bg: "#DDF4FF", fg: "#2F8FC4", icons: [ScrollText] } },
  { key: "balsheet", title: "گزارش ترازنامه", style: { bg: "#FDE6F3", fg: "#D6489B", icons: [Scale] } },
];
function ReportTiles({ onOpen }) {
  const t = useT();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px 14px", marginBottom: 20 }}>
      {REPORT_TILES.map((x) => (
        <button key={x.key} onClick={() => onOpen(x.key)} style={{ border: 0, background: "transparent", padding: 0, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, cursor: "pointer", fontFamily: "inherit" }}>
          <span style={{ width: "100%", aspectRatio: "1 / 1", borderRadius: 20, background: x.style.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ShortcutGlyph style={x.style} size={38} />
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: t.text, textAlign: "center", lineHeight: 1.6 }}>{x.title}</span>
        </button>
      ))}
    </div>
  );
}

function ReportsView({ members = [], events = [], projects = [], loans = [], assets = [], bills = [], categories = [], expenseByCategory, incomeByCategory, totalIncomeYear, totalExpenseYear, accounts, accountBalance, updateAccount, netWorthTrend, exportExcel, expenseByMember, expenseByEvent, expenseByProject, checks = [], debts = [], totalAssets = 0, currency, usdRate, transactions = [] }) {
  const st = useStyles();
  const [sub, setSub] = useState(null);
  const [period, setPeriod] = useState("year");
  const [selectedAccount, setSelectedAccount] = useState(null); const [selectedMember, setSelectedMember] = useState(null); const [editBalance, setEditBalance] = useState("");
  const periodTx = useMemo(() => {
    const now = new Date(); const today = todayISO();
    if (period === "day") return transactions.filter((x) => x.date === today);
    if (period === "month") return transactions.filter((x) => { const d = new Date(x.date); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); });
    if (period === "week") { const start = new Date(now); start.setDate(now.getDate() - 6); const st = start.toISOString().slice(0,10); return transactions.filter((x) => x.date >= st && x.date <= today); }
    return transactions.filter((x) => jalaliYear(new Date(x.date)) === jalaliYear(now));
  }, [transactions, period]);
  const reportIncome = periodTx.filter((x) => x.type === "income").reduce((s, x) => s + x.amount, 0);
  const reportExpense = periodTx.filter((x) => x.type === "expense").reduce((s, x) => s + x.amount, 0);
  const incomeExpensePie = [{ name: "درآمد", amount: reportIncome }, { name: "هزینه", amount: reportExpense }].filter((d) => d.amount > 0);
  const profit = reportIncome - reportExpense;
  const reportExpenseByCategory = useMemo(() => {
    const map = {};
    periodTx.filter((x) => x.type === "expense").forEach((x) => { map[x.categoryId] = (map[x.categoryId] || 0) + x.amount; });
    return Object.entries(map).map(([catId, amount]) => ({ name: categories.find((c) => c.id === catId)?.name || "بدون دسته", amount, catId })).sort((a,b) => b.amount-a.amount);
  }, [periodTx]);
  const accountDetails = useMemo(() => {
    if (!selectedAccount) return { income: 0, expense: 0, transfersIn: 0, transfersOut: 0, txs: [] };
    const txs = periodTx.filter((x) => x.accountId === selectedAccount.id || x.toAccountId === selectedAccount.id);
    return {
      income: txs.filter((x) => x.type === "income" && x.accountId === selectedAccount.id).reduce((s,x)=>s+x.amount,0),
      expense: txs.filter((x) => x.type === "expense" && x.accountId === selectedAccount.id).reduce((s,x)=>s+x.amount,0),
      transfersIn: txs.filter((x) => x.type === "transfer" && x.toAccountId === selectedAccount.id).reduce((s,x)=>s+x.amount,0),
      transfersOut: txs.filter((x) => x.type === "transfer" && x.accountId === selectedAccount.id).reduce((s,x)=>s+x.amount,0),
      txs
    };
  }, [periodTx, selectedAccount]);
  const memberDetails = useMemo(() => {
    if (!selectedMember) return [];
    return periodTx.filter((x) => x.type === "expense" && x.memberId === selectedMember.id);
  }, [periodTx, selectedMember]);

  const checkStats = useMemo(() => {
    const pending = checks.filter((c) => c.status === "pending").length;
    const cashed = checks.filter((c) => c.status === "cashed").length;
    const bounced = checks.filter((c) => c.status === "bounced").length;
    const resolved = cashed + bounced;
    const pct = resolved > 0 ? (cashed / resolved) * 100 : 0;
    return { pending, cashed, bounced, pct };
  }, [checks]);

  const periodLabel = { day: "روزانه", week: "هفتگی", month: "ماهیانه", year: "سالیانه" }[period];
  const overviewDoc = {
    title: `گزارش مالی ${periodLabel}`, subtitle: faLongDate(new Date()),
    sections: [
      { title: "تراز کلی مالی", rows: [
        ["موجودی حساب‌ها", accounts.reduce((s2, a) => s2 + accountBalance(a.id), 0)], ["دارایی‌ها", totalAssets],
        ["طلب‌ها", debts.filter((d) => !d.settled && d.kind === "receivable").reduce((s2, d) => s2 + Number(d.amount || 0), 0)],
        ["بدهی‌ها", debts.filter((d) => !d.settled && d.kind === "payable").reduce((s2, d) => s2 + Number(d.amount || 0), 0)],
        ["درآمد این دوره", reportIncome], ["هزینه این دوره", -reportExpense], ["سود / زیان خالص", profit]] },
      { title: "هزینه به تفکیک دسته", head: ["دسته", "مبلغ"], rows: reportExpenseByCategory.map((x) => [x.name, x.amount]) },
      { title: "موجودی حساب‌ها", head: ["حساب", "نوع", "موجودی"], rows: accounts.map((a) => [a.name, accTypeFa(a.type), accountBalance(a.id)]) },
      { title: "تراکنش‌های این دوره", head: ["تاریخ", "نوع", "مبلغ", "دسته", "حساب", "یادداشت"], rows: [...periodTx].sort((x, y) => y.date.localeCompare(x.date)).map((x) => [jf(x.date), x.type === "income" ? "دریافت" : x.type === "expense" ? "پرداخت" : "انتقال", x.amount, categories.find((c) => c.id === x.categoryId)?.name || "", accounts.find((a) => a.id === x.accountId)?.name || "", x.note || ""]) },
    ],
  };
  if (sub) {
    const tile = REPORT_TILES.find((x) => x.key === sub);
    const common = { accounts, transactions, categories };
    return (
      <div style={{ padding: "16px" }}>
        <button onClick={() => setSub(null)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 15, fontWeight: 800, color: "inherit", padding: 0, marginBottom: 14 }}>
          <ChevronRight size={22} /> {tile?.title}
        </button>
        {sub === "summary" && <SummaryReport {...common} />}
        {sub === "incexp" && <IncomeExpenseReport {...common} />}
        {sub === "balances" && <BalancesReport {...common} />}
        {sub === "statement" && <StatementReport {...common} members={members} projects={projects} events={events} />}
        {sub === "balsheet" && <BalanceSheetReport {...common} assets={assets} debts={debts} loans={loans} checks={checks} bills={bills} />}
      </div>
    );
  }

  return (
    <div style={{ padding: "16px" }}>
      <ExportBar doc={overviewDoc} />
      <ReportTiles onOpen={setSub} />

      <div className="no-print" style={{ display: "flex", gap: 6, marginBottom: 18, background: "#f1eef4", borderRadius: 10, padding: 4 }}>
        {[{ k: "day", l: "روزانه" }, { k: "week", l: "هفتگی" }, { k: "month", l: "ماهیانه" }, { k: "year", l: "سالیانه" }].map((p) => (
          <button key={p.k} onClick={() => setPeriod(p.k)} style={{ flex: 1, padding: "7px 4px", borderRadius: 7, border: "none", cursor: "pointer", background: period === p.k ? BRAND.header : "transparent", color: period === p.k ? "#fff" : "#3E1461", fontWeight: 700, fontSize: 12 }}>{p.l}</button>
        ))}
      </div>
      {period !== "year" && (
        <div style={{ fontSize: 11.5, color: "#8a8194", marginBottom: 14, textAlign: "center" }}>
          تمام ارقام و جزئیات این گزارش بر اساس بازه انتخاب‌شده محاسبه شده‌اند.
        </div>
      )}

      <SectionTitle text="تراز کلی مالی" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[
            ["موجودی حساب‌ها", accounts.reduce((s,a)=>s+accountBalance(a.id),0), BRAND.violet],
            ["بانک و کارت", accounts.filter(a=>a.type === "bank" || a.type === "card").reduce((s,a)=>s+accountBalance(a.id),0), BRAND.violet],
            ["صندوق‌ها", accounts.filter(a=>a.type === "fund").reduce((s,a)=>s+accountBalance(a.id),0), BRAND.gold],
            ["دارایی‌ها", totalAssets, BRAND.teal],
            ["طلب‌ها", debts.filter(d=>!d.settled && d.kind === "receivable").reduce((s,d)=>s+Number(d.amount||0),0), BRAND.darkgreen],
            ["بدهی‌ها", debts.filter(d=>!d.settled && d.kind === "payable").reduce((s,d)=>s+Number(d.amount||0),0), BRAND.crimson],
            ["درآمد این دوره", reportIncome, BRAND.darkgreen],
            ["هزینه این دوره", reportExpense, BRAND.crimson],
          ].map(([label,val,color]) => <div key={label} style={{ padding: 10, borderRadius: 12, background: "#f8f6fa" }}>
            <div style={{ fontSize: 11.5, color: "#8a8194" }}>{label}</div><div style={{ fontSize: 14, fontWeight: 800, color, marginTop: 4 }}>{formatMoney(val,currency,usdRate)}</div>
          </div>)}
        </div>
      </div>

      <SectionTitle text="سود و زیان سالانه" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <Row title="مجموع درآمد" value={formatMoney(reportIncome, currency, usdRate)} valueColor={BRAND.darkgreen} chevron={null} />
        <Row title="مجموع هزینه" value={formatMoney(reportExpense, currency, usdRate)} valueColor={BRAND.crimson} chevron={null} />
        <Row title="سود / زیان خالص" value={formatMoney(profit, currency, usdRate)} valueColor={profit >= 0 ? BRAND.darkgreen : BRAND.crimson} chevron={null} />
      </div>

      <SectionTitle text="روند دارایی خالص (۸ ماه اخیر)" />
      <div style={{ ...st.card, padding: 12, marginBottom: 18 }}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={netWorthTrend}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontFamily: FONT, fontSize: 11 }} />
            <YAxis tick={{ fontFamily: FONT, fontSize: 10 }} width={44} />
            <Tooltip formatter={(v) => toFaInt(v)} contentStyle={{ fontFamily: FONT, direction: "rtl" }} />
            <Line type="monotone" dataKey="مانده" stroke={BRAND.violet} strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <SectionTitle text="درآمد و هزینه" />
      <div style={{ ...st.card, padding: 12, marginBottom: 18 }}>
        <ExplodingPie data={incomeExpensePie} currency={currency} usdRate={usdRate} />
      </div>

      <SectionTitle text="توزیع هزینه‌ها بر اساس دسته" />
      <div style={{ ...st.card, padding: 12, marginBottom: 18 }}>
        <ExplodingPie data={reportExpenseByCategory} currency={currency} usdRate={usdRate} />
      </div>

      <SectionTitle text="گزارش چک‌ها" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-around", marginBottom: 10 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: BRAND.gold }}>{toFaInt(checkStats.pending)}</div>
            <div style={{ fontSize: 11.5, color: "#8a8194" }}>در جریان وصول</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: BRAND.darkgreen }}>{toFaInt(checkStats.cashed)}</div>
            <div style={{ fontSize: 11.5, color: "#8a8194" }}>وصول شده</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: BRAND.crimson }}>{toFaInt(checkStats.bounced)}</div>
            <div style={{ fontSize: 11.5, color: "#8a8194" }}>برگشت خورده</div>
          </div>
        </div>
        {(checkStats.cashed + checkStats.bounced) > 0 && (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <GaugeSpeedometer pct={checkStats.pct} label="نسبت چک‌های وصول‌شده به کل تسویه‌شده‌ها" />
          </div>
        )}
        {checks.length === 0 && <EmptyRow text="چکی ثبت نشده" />}
      </div>

      <SectionTitle text="گزارش مانده حساب‌ها" />
      <div style={{ ...st.card, padding: "4px 12px", marginBottom: expenseByMember?.length || expenseByEvent?.length || expenseByProject?.length ? 18 : 0 }}>
        {accounts.map((a) => <Row key={a.id} title={a.name} subtitle={`${a.type === "bank" ? "بانک" : a.type === "card" ? "کارت" : "صندوق"} · لمس برای جزئیات`} value={formatMoney(accountBalance(a.id), currency, usdRate)} valueColor={accountBalance(a.id) >= 0 ? BRAND.darkgreen : BRAND.crimson} onClick={() => { setSelectedAccount(a); setEditBalance(String(accountBalance(a.id))); }} />)}
      </div>

      {expenseByMember?.length > 0 && (
        <>
          <SectionTitle text="گزارش هزینه به‌تفکیک اعضای خانواده" />
          <div style={{ ...st.card, padding: "4px 12px", marginBottom: 18 }}>
            {expenseByMember.map((m) => <Row key={m.id} title={m.name} subtitle="لمس برای مشاهده ریز هزینه‌ها" value={formatMoney(m.amount, currency, usdRate)} valueColor={BRAND.crimson} onClick={() => setSelectedMember(m)} />)}
          </div>
        </>
      )}
      {expenseByEvent?.length > 0 && (
        <>
          <SectionTitle text="گزارش هزینه به‌تفکیک رویداد" />
          <div style={{ ...st.card, padding: "4px 12px", marginBottom: 18 }}>
            {expenseByEvent.map((m) => <Row key={m.id} title={m.name} value={formatMoney(m.amount, currency, usdRate)} valueColor={BRAND.crimson} chevron={null} />)}
          </div>
        </>
      )}
      {expenseByProject?.length > 0 && (
        <>
          <SectionTitle text="گزارش هزینه به‌تفکیک پروژه" />
          <div style={{ ...st.card, padding: "4px 12px" }}>
            {expenseByProject.map((m) => <Row key={m.id} title={m.name} value={formatMoney(m.amount, currency, usdRate)} valueColor={BRAND.crimson} chevron={null} />)}
          </div>
        </>
      )}
      {selectedAccount && <div onClick={() => setSelectedAccount(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 310, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: "min(480px,100vw)", maxHeight: "88vh", overflowY: "auto", background: "#fff", borderRadius: "18px 18px 0 0", padding: 18, paddingBottom: "calc(24px + env(safe-area-inset-bottom,0px))" }}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>تراز {selectedAccount.name}</div>
          <div style={{ fontSize: 12, color: "#8a8194", marginBottom: 12 }}>مانده فعلی: {formatMoney(accountBalance(selectedAccount.id), currency, usdRate)}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
            <div style={{ background: "#eef9f0", borderRadius: 10, padding: 10 }}><div style={{fontSize:11,color:"#6b756d"}}>دریافت</div><b style={{color:BRAND.darkgreen}}>{formatMoney(accountDetails.income,currency,usdRate)}</b></div>
            <div style={{ background: "#fff0f3", borderRadius: 10, padding: 10 }}><div style={{fontSize:11,color:"#756b6e"}}>هزینه</div><b style={{color:BRAND.crimson}}>{formatMoney(accountDetails.expense,currency,usdRate)}</b></div>
            <div style={{ background: "#f2eff8", borderRadius: 10, padding: 10 }}><div style={{fontSize:11,color:"#6f6876"}}>انتقال ورودی</div><b>{formatMoney(accountDetails.transfersIn,currency,usdRate)}</b></div>
            <div style={{ background: "#f2eff8", borderRadius: 10, padding: 10 }}><div style={{fontSize:11,color:"#6f6876"}}>انتقال خروجی</div><b>{formatMoney(accountDetails.transfersOut,currency,usdRate)}</b></div>
          </div>
          <SectionTitle text={`ریز تراکنش‌های ${selectedAccount.name}`} />
          <div style={{ ...st.card, padding: "4px 10px", marginBottom: 14 }}>
            {accountDetails.txs.length === 0 ? <EmptyRow text="در این دوره تراکنشی ثبت نشده" /> : accountDetails.txs.slice(0,30).map(tx => <Row key={tx.id} title={categories.find(c=>c.id===tx.categoryId)?.name || (tx.type === "transfer" ? "انتقال" : "بدون دسته")} subtitle={`${tx.date || ""} · ${tx.note || ""}`} value={`${tx.type === "expense" ? "−" : "+"}${toFaInt(tx.amount)} ریال`} valueColor={tx.type === "expense" ? BRAND.crimson : BRAND.darkgreen} chevron={null} />)}
          </div>
          <label style={st.label}>اصلاح مانده حساب</label>
          <AmountInput value={editBalance} onChange={setEditBalance} placeholder="مانده جدید" style={st.input} />
          <button onClick={() => { const target = Number(editBalance || 0); updateAccount?.(selectedAccount.id, { initial: (selectedAccount.initial || 0) + target - accountBalance(selectedAccount.id) }); setSelectedAccount(null); }} style={st.primaryBtn}>ذخیره اصلاح مانده</button>
          <button onClick={() => setSelectedAccount(null)} style={{ ...st.primaryBtn, background: "#eee", color: "#333", marginTop: 8 }}>بستن</button>
        </div>
      </div>}
      {selectedMember && <div onClick={() => setSelectedMember(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 310, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
        <div onClick={(e)=>e.stopPropagation()} style={{ width:"min(480px,100vw)", maxHeight:"82vh", overflowY:"auto", background:"#fff", borderRadius:"18px 18px 0 0", padding:18 }}>
          <div style={{fontWeight:800,fontSize:16,marginBottom:4}}>ریز هزینه‌های {selectedMember.name}</div>
          <div style={{fontSize:12,color:"#8a8194",marginBottom:12}}>جمع: {formatMoney(selectedMember.amount,currency,usdRate)}</div>
          <div style={{ ...st.card, padding:"4px 10px" }}>
            {memberDetails.map(tx => <Row key={tx.id} title={categories.find(c=>c.id===tx.categoryId)?.name || "بدون دسته"} subtitle={`${tx.date || ""} · ${tx.note || ""}`} value={formatMoney(tx.amount,currency,usdRate)} valueColor={BRAND.crimson} chevron={null} />)}
          </div>
          <button onClick={()=>setSelectedMember(null)} style={{...st.primaryBtn,background:"#eee",color:"#333",marginTop:10}}>بستن</button>
        </div>
      </div>}
    </div>
  );
}

/* ---------------------------------------------------------
   SubView Router
--------------------------------------------------------- */
const SUBVIEW_TITLES = { cloud: "همگام‌سازی ابری (گیت‌هاب)", coa: "حساب‌ها", goals: "اهداف مالی و پس‌انداز", persons: "اشخاص و طرف حساب‌ها", debts: "بدهکاران و بستانکاران", currencies: "واحدهای پولی", calculator: "ماشین حساب", support: "پشتیبانی", shortcuts: "میانبرهای تراکنش", accounts: "حساب‌ها و کارت‌ها", categories: "حسابها", budgets: "بودجه‌بندی", recurring: "تراکنش‌های تکرارشونده", checks: "چک‌ها", loans: "وام و اقساط", bills: "یادآوری قبض‌ها", assets: "دارایی‌ها", calendar: "تقویم شمسی", settings: "تنظیمات و امنیت", profile: "ویرایش اطلاعات کاربری", backup: "پشتیبان‌گیری و بازیابی", access: "مدیریت دسترسی", basic: "تنظیمات پایه", tutorial: "آموزش Rexa", share: "ارسال برنامه به دیگران", rate: "امتیاز به برنامه", about: "درباره Rexa", tags: "اعضا، رویداد و پروژه", periods: "دوره مالی", sms: "پیامک بانکی", slip: "اسکن برگه پوز" };
function SubViewContent({ subView, ctx, onBack }) {
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px 112px", paddingTop: "calc(20px + env(safe-area-inset-top, 0px))" }}>
      {subView === "goals" && <GoalsManager {...ctx} />}
      {subView === "coa" && <AccountsTree {...ctx} />}
      {subView === "cloud" && <CloudSyncView {...ctx} />}
      {subView === "persons" && <PersonsManager {...ctx} />}
      {subView === "debts" && <DebtsManager {...ctx} />}
      {subView === "currencies" && <CurrenciesManager {...ctx} />}
      {subView === "calculator" && <CalculatorView {...ctx} />}
      {subView === "support" && <SupportView {...ctx} />}
      {subView === "shortcuts" && <ShortcutsManager {...ctx} />}
      {subView === "accounts" && <AccountsManager {...ctx} />}
      {subView === "categories" && <CategoriesManager {...ctx} />}
      {subView === "budgets" && <BudgetsManager {...ctx} />}
      {subView === "recurring" && <RecurringManager {...ctx} />}
      {subView === "checks" && <ChecksManager {...ctx} />}
      {subView === "loans" && <LoansManager {...ctx} />}
      {subView === "bills" && <BillsManager {...ctx} />}
      {subView === "assets" && <AssetsManager {...ctx} />}
      {subView === "calendar" && <CalendarViewSub {...ctx} />}
      {subView === "settings" && <SettingsView {...ctx} />}
      {subView === "profile" && <ProfileView {...ctx} />}
      {subView === "backup" && <BackupView {...ctx} />}
      {subView === "access" && <AccessView {...ctx} />}
      {subView === "basic" && <BasicSettingsView {...ctx} />}
      {subView === "tutorial" && <TutorialView {...ctx} />}
      {subView === "share" && <ShareAppView {...ctx} />}
      {subView === "rate" && <RateAppView {...ctx} />}
      {subView === "about" && <AboutView {...ctx} />}
      {subView === "tags" && <MembersEventsProjectsManager {...ctx} />}
      {subView === "periods" && <FiscalPeriodsManager {...ctx} />}
      {subView === "sms" && <BankSmsManager {...ctx} onBack={onBack} />}
      {subView === "slip" && <SlipScanView {...ctx} onBack={onBack} />}
    </div>
  );
}

/* ---------------------------------------------------------
   Accounts / Categories / Budgets Managers
--------------------------------------------------------- */
// رنگ پس‌زمینه، رنگ آیکن و آیکن هر میانبر — مطابق تصویر مرجع «میانبر تراکنش‌ها»
const SHORTCUT_STYLES = {
  taxi: { bg: "#FFE8C7", fg: "#E6A912", icons: [CarTaxiFront, Bus] },
  bus: { bg: "#FFE8C7", fg: "#E6A912", icons: [Bus] },
  car: { bg: "#FFF3C8", fg: "#B5A04A", icons: [Car] },
  fuel: { bg: "#FFF3C8", fg: "#B5A04A", icons: [Fuel] },
  food: { bg: "#FFF3C8", fg: "#F2C21B", icons: [ConciergeBell] },
  market: { bg: "#FFF3C8", fg: "#F2C21B", icons: [ShoppingCart] },
  home: { bg: "#FFF3C8", fg: "#9C8A5A", icons: [HomeIcon] },
  water: { bg: "#FFF3C8", fg: "#9C8A5A", icons: [Droplets] },
  electric: { bg: "#FFF3C8", fg: "#9C8A5A", icons: [Zap] },
  repair: { bg: "#FFF3C8", fg: "#9C8A5A", icons: [Wrench] },
  internet: { bg: "#DDF4FF", fg: "#2F8FC4", icons: [Wifi] },
  clothes: { bg: "#C9FBFA", fg: "#0B8E93", icons: [Shirt] },
  salary: { bg: "#B9FFF9", fg: "#14A39B", icons: [HandCoins] },
  bank: { bg: "#F1F3FA", fg: "#7B808C", icons: [Building2] },
  fun: { bg: "#FFE8EC", fg: "#F0546A", icons: [Drama] },
  health: { bg: "#FFE3E3", fg: "#E04B4B", icons: [Pill] },
  gift: { bg: "#FDE6F3", fg: "#D6489B", icons: [Gift] },
  phone: { bg: "#FFDADA", fg: "#E5483F", icons: [Smartphone] },
  loan: { bg: "#FFDADA", fg: "#E5483F", icons: [Banknote] },
  other: { bg: "#EAE7FB", fg: "#6C56C8", icons: [Sparkles] },
};
const SHORTCUT_ICON_KEYS = Object.keys(SHORTCUT_STYLES);
function shortcutStyle(sc) {
  if (sc.icon === "other" && sc.type === "income") return SHORTCUT_STYLES.salary;
  return SHORTCUT_STYLES[sc.icon] || SHORTCUT_STYLES.other;
}
function ShortcutGlyph({ style, size }) {
  const multi = style.icons.length > 1;
  return (
    <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2 }}>
      {style.icons.map((I, i) => (
        <I key={i} size={multi ? Math.round(size * 0.62) : size} color={style.fg} strokeWidth={1.7} fill={style.fg} fillOpacity={0.3} />
      ))}
    </span>
  );
}
function ShortcutTile({ sc, onClick }) {
  const t = useT();
  const s = shortcutStyle(sc);
  return (
    <button onClick={onClick} style={{ border: 0, background: "transparent", padding: 0, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, cursor: onClick ? "pointer" : "default", fontFamily: "inherit" }}>
      <span style={{ width: "100%", aspectRatio: "1 / 1", borderRadius: 20, background: s.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <ShortcutGlyph style={s} size={40} />
      </span>
      <span style={{ fontSize: 12, fontWeight: 500, color: t.text, textAlign: "center", lineHeight: 1.5, wordBreak: "break-word" }}>{sc.name}</span>
    </button>
  );
}
function AddShortcutTile({ onClick }) {
  const t = useT();
  return (
    <button onClick={onClick} style={{ border: 0, background: "transparent", padding: 0, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, cursor: "pointer", fontFamily: "inherit" }}>
      <span style={{ width: "100%", aspectRatio: "1 / 1", borderRadius: 20, background: "#DFF2FE", color: "#0F2F5C", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Plus size={42} strokeWidth={2.4} />
      </span>
      <span style={{ fontSize: 12, fontWeight: 500, color: t.text, textAlign: "center", lineHeight: 1.5 }}>افزودن میانبر</span>
    </button>
  );
}
function ShortcutsManager({ shortcuts, setShortcuts, categories, accounts }) {
  const st = useStyles();
  const [form, setForm] = useState({ name: "", type: "expense", categoryId: "", accountId: accounts[0]?.id || "", note: "", icon: "other" });
  const cats = categories.filter((c) => c.kind === form.type);
  useEffect(() => {
    if (!accounts.some(a => a.id === form.accountId)) setForm(f => ({ ...f, accountId: accounts[0]?.id || "" }));
  }, [accounts, form.accountId]);
  function add() {
    if (!form.name.trim() || !form.categoryId || !form.accountId) return;
    setShortcuts((p) => [...p, { id: uid(), ...form, name: form.name.trim() }]);
    setForm({ ...form, name: "", categoryId: "", note: "", icon: "other" });
  }
  return <div>
    <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
      <div style={{ fontWeight: 800, marginBottom: 10 }}>ساخت میانبر تراکنش</div>
      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="مثلا کرایه تاکسی" style={st.input} />
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button onClick={() => setForm({ ...form, type: "expense", categoryId: "" })} style={pillStyle(form.type === "expense")}>هزینه</button>
        <button onClick={() => setForm({ ...form, type: "income", categoryId: "" })} style={pillStyle(form.type === "income")}>درآمد</button>
      </div>
      <label style={st.label}>آیکن میانبر</label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 10 }}>
        {SHORTCUT_ICON_KEYS.map((key) => {
          const s = SHORTCUT_STYLES[key];
          return (
            <button key={key} type="button" onClick={() => setForm({ ...form, icon: key })}
              style={{ aspectRatio: "1 / 1", borderRadius: 14, border: form.icon === key ? `2px solid ${BRAND.header}` : "2px solid transparent", background: s.bg, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}>
              <ShortcutGlyph style={s} size={24} />
            </button>
          );
        })}
      </div>
      <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} style={st.input}>
        <option value="">دسته‌بندی را انتخاب کنید</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.parentId ? "↳ " : ""}{c.name}</option>)}
      </select>
      <select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} style={st.input}>
        <option value="">حساب پیش‌فرض</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="شرح ثابت (اختیاری)" style={st.input} />
      <button onClick={add} style={st.primaryBtn}>افزودن میانبر</button>
    </div>
    <div style={{ ...st.card, padding: "16px 12px" }}>
      {shortcuts.length === 0 && <EmptyRow text="هنوز میانبری ساخته نشده" />}
      {shortcuts.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "18px 12px" }}>
        {shortcuts.map((sc) => <div key={sc.id} style={{ position: "relative" }}>
          <ShortcutTile sc={sc} />
          <button onClick={() => setShortcuts((p) => p.filter((x) => x.id !== sc.id))} aria-label="حذف میانبر" style={{ position: "absolute", top: -6, right: -4, width: 24, height: 24, borderRadius: "50%", border: "none", background: BRAND.crimson, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Trash2 size={12} /></button>
        </div>)}
      </div>}
    </div>
  </div>;
}

function AccountAveragePanel({ account, transactions = [], accountBalance, onClose }) {
  const st = useStyles();
  const t = useT();
  const [period, setPeriod] = useState("3m");
  const [from, setFrom] = useState(addDays(todayISO(), -89));
  const [to, setTo] = useState(todayISO());
  const [target, setTarget] = useState("");
  const [goalDays, setGoalDays] = useState("90");

  const range = useMemo(() => {
    if (period === "custom") return { from, to: from <= to ? to : from };
    const days = period === "1m" ? 30 : period === "3m" ? 90 : period === "6m" ? 180 : 365;
    return { from: addDays(todayISO(), -(days - 1)), to: todayISO() };
  }, [period, from, to]);

  // بانک مهر ایران معدل را بر مبنای مانده پایان روز در بازه محاسبه می‌کند.
  // این تابع همان منطق را روی اطلاعات ثبت‌شده داخل اپ شبیه‌سازی می‌کند.
  const averageData = useMemo(() => {
    const start = range.from <= range.to ? range.from : range.to;
    const end = range.from <= range.to ? range.to : range.from;
    const rows = [];
    let d = start;
    while (d <= end) {
      rows.push({ date: d, balance: Number(balanceAtDate(account, transactions, d) || 0) });
      d = addDays(d, 1);
    }
    const total = rows.reduce((sum, r) => sum + r.balance, 0);
    const days = rows.length || 1;
    return {
      rows,
      days,
      total,
      average: total / days,
      startBalance: rows[0]?.balance || 0,
      endBalance: rows[rows.length - 1]?.balance || Number(accountBalance(account.id) || 0),
      min: rows.length ? Math.min(...rows.map(r => r.balance)) : 0,
      max: rows.length ? Math.max(...rows.map(r => r.balance)) : 0,
    };
  }, [account, transactions, accountBalance, range.from, range.to]);

  const goal = useMemo(() => {
    const wanted = Number(normalizeDigitsText(String(target)).replace(/[,٬،]/g, ""));
    const days = Math.max(1, Number(goalDays || 90));
    if (!wanted || wanted <= 0) return null;

    // امروز را به عنوان یک روز واقعی با مانده فعلی در نظر می‌گیریم؛
    // از فردا تا پایان هدف، مانده ثابت موردنیاز را به‌صورت سناریوی پایه محاسبه می‌کنیم.
    const current = Number(accountBalance(account.id) || 0);
    const today = todayISO();
    const futureDates = [];
    for (let i = 1; i < days; i++) futureDates.push(addDays(today, i));
    const weightedToday = current;
    const remainingWeight = wanted * days - weightedToday;
    const requiredFutureBalance = futureDates.length ? remainingWeight / futureDates.length : wanted;
    const extraNow = Math.max(0, requiredFutureBalance - current);
    const alreadyAbove = requiredFutureBalance <= current;
    const projectedAverageIfCurrentHeld = (current * days) / days;
    const feasibleWithoutDeposit = current >= wanted;
    return { wanted, days, current, requiredFutureBalance, extraNow, alreadyAbove, projectedAverageIfCurrentHeld, feasibleWithoutDeposit };
  }, [target, goalDays, account, accountBalance]);

  const money = (n) => `${toFaInt(Math.round(n || 0))} ریال`;
  const pct = averageData.average ? Math.min(999, (averageData.endBalance / averageData.average) * 100) : 0;

  return (
    <div style={{ ...st.card, padding: 14, margin: "8px 0 14px", border: `1px solid ${BRAND.violet}33` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 15 }}>معدل حساب · {account.name}</div>
          <div style={{ fontSize: 11.5, color: t.sub, marginTop: 3 }}>محاسبه بر اساس مانده پایان هر روز</div>
        </div>
        <button onClick={onClose} style={{ background: "transparent", border: "none", color: t.sub, cursor: "pointer" }}><X size={18} /></button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {[['1m','۱ ماه'],['3m','۳ ماه'],['6m','۶ ماه'],['1y','۱۲ ماه'],['custom','دلخواه']].map(([k,l]) => (
          <button key={k} onClick={() => setPeriod(k)} style={{ ...pillStyle(period === k), fontSize: 11.5 }}>{l}</button>
        ))}
      </div>
      {period === "custom" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <div><label style={st.label}>از تاریخ</label><JalaliDateInput value={from} onChange={setFrom} style={st.input} /></div>
          <div><label style={st.label}>تا تاریخ</label><JalaliDateInput value={to} onChange={setTo} style={st.input} /></div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <div style={{ background: `${BRAND.violet}12`, borderRadius: 12, padding: 12, textAlign: "center" }}>
          <div style={{ fontSize: 11, color: t.sub }}>معدل حساب</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: BRAND.violet, marginTop: 3 }}>{money(averageData.average)}</div>
        </div>
        <div style={{ background: `${BRAND.darkgreen}12`, borderRadius: 12, padding: 12, textAlign: "center" }}>
          <div style={{ fontSize: 11, color: t.sub }}>مانده فعلی</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: BRAND.darkgreen, marginTop: 3 }}>{money(averageData.endBalance)}</div>
        </div>
        <div style={{ padding: 10, border: `1px solid ${t.border}`, borderRadius: 10 }}><span style={{ fontSize: 11, color: t.sub }}>کمترین مانده</span><div style={{ fontWeight: 800 }}>{money(averageData.min)}</div></div>
        <div style={{ padding: 10, border: `1px solid ${t.border}`, borderRadius: 10 }}><span style={{ fontSize: 11, color: t.sub }}>بیشترین مانده</span><div style={{ fontWeight: 800 }}>{money(averageData.max)}</div></div>
      </div>

      <div style={{ fontSize: 11.5, color: t.sub, lineHeight: 1.9, marginBottom: 14 }}>
        این عدد از جمع مانده پایان {toFaInt(averageData.days)} روز تقسیم بر تعداد روزهای بازه به‌دست آمده است. هر روزی که پول مدت بیشتری در حساب بماند، اثر بیشتری روی معدل دارد.
      </div>

      <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 14 }}>
        <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 4 }}>🎯 رسیدن به معدل هدف</div>
        <div style={{ fontSize: 11.5, color: t.sub, marginBottom: 10 }}>هدف معدل و مدت موردنظر را وارد کن تا حداقل مانده پیشنهادی برای رسیدن به آن محاسبه شود.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr .7fr", gap: 8 }}>
          <AmountInput value={target} onChange={setTarget} placeholder="معدل هدف (ریال)" style={st.input} />
          <select value={goalDays} onChange={e => setGoalDays(e.target.value)} style={st.input}>
            <option value="30">۳۰ روز</option><option value="60">۶۰ روز</option><option value="90">۹۰ روز</option><option value="180">۱۸۰ روز</option><option value="365">۳۶۵ روز</option>
          </select>
        </div>
        {goal && (
          <div style={{ marginTop: 10, background: goal.alreadyAbove ? `${BRAND.darkgreen}12` : `${BRAND.gold}18`, borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 900, color: goal.alreadyAbove ? BRAND.darkgreen : BRAND.header }}>
              {goal.alreadyAbove ? "با حفظ مانده فعلی، رسیدن به این معدل امکان‌پذیر است." : `برای رسیدن به معدل هدف، مانده روزانه را حدود ${money(goal.requiredFutureBalance)} نگه دار.`}
            </div>
            {!goal.alreadyAbove && goal.extraNow > 0 && <div style={{ fontSize: 12, lineHeight: 1.9, marginTop: 6 }}>در سناریوی ثابت، حدود <b>{money(goal.extraNow)}</b> افزایش نسبت به مانده فعلی لازم است؛ بعد از آن بهتر است مانده حساب زیر این سطح نیاید.</div>}
            {goal.alreadyAbove && <div style={{ fontSize: 12, lineHeight: 1.9, marginTop: 6 }}>اگر مانده فعلی تا پایان دوره حفظ شود، معدل هدف از نظر ریاضی پوشش داده می‌شود. برداشت‌های بزرگ می‌توانند این نتیجه را تغییر دهند.</div>}
            <div style={{ marginTop: 8, fontSize: 11, color: t.sub }}>محاسبه برنامه‌ریزی است و به تراکنش‌های آینده یا تصمیم نهایی بانک متصل نیست.</div>
          </div>
        )}
      </div>
    </div>
  );
}

function AccountsManager({ accounts, addAccount, deleteAccount, updateAccount, accountBalance, favorites, toggleFavorite, initialEditAccount, setAccountEditTarget, transactions = [] }) {
  const st = useStyles();
  const [name, setName] = useState("");
  const [type, setType] = useState("bank");
  const [initial, setInitial] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [averageAccountId, setAverageAccountId] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", initial: "", cardNumber: "", expiryDate: "" });

  useEffect(() => {
    if (!initialEditAccount) return;
    setEditingId(initialEditAccount.id);
    setEditForm({
      name: initialEditAccount.name || "",
      initial: String(initialEditAccount.initial || 0),
      cardNumber: String(initialEditAccount.cardNumber || ""),
      expiryDate: expiryFromStored(initialEditAccount.expiryDate),
    });
    setAccountEditTarget?.(null);
  }, [initialEditAccount]);

  function openEdit(a) {
    setEditingId(a.id);
    setEditForm({ name: a.name || "", initial: String(a.initial || 0), cardNumber: String(a.cardNumber || ""), expiryDate: expiryFromStored(a.expiryDate) });
  }
  function saveEdit(a) {
    if (!editForm.name.trim()) return;
    const cleanCard = editForm.cardNumber.replace(/\D/g, "").slice(0, 16);
    updateAccount?.(a.id, {
      name: editForm.name.trim(),
      initial: Number(editForm.initial || 0),
      ...(a.type === "bank" || a.type === "card" ? { cardNumber: cleanCard || undefined, cardNumberLast4: cleanCard ? cleanCard.slice(-4) : a.cardNumberLast4, expiryDate: editForm.expiryDate.trim() || undefined } : {}),
    });
    setEditingId(null);
  }
  function add() {
    if (!name.trim()) return;
    const cleanCard = cardNumber.replace(/\D/g, "").slice(0, 16);
    addAccount({ name: name.trim(), type, initial: Number(initial || 0), cardNumber: cleanCard || undefined, cardNumberLast4: cleanCard ? cleanCard.slice(-4) : undefined, expiryDate: expiryDate.trim() || undefined });
    setName(""); setInitial(""); setCardNumber(""); setExpiryDate("");
  }

  const bankAccounts = accounts.filter(a => a.type === "bank" || a.type === "card");

  return <div>
    <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>افزودن حساب / کارت جدید</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button onClick={() => setType("bank")} style={pillStyle(type === "bank")}>بانک</button>
        <button onClick={() => setType("fund")} style={pillStyle(type === "fund")}>صندوق</button>
        <button onClick={() => setType("card")} style={pillStyle(type === "card")}>کارت</button>
      </div>
      <input placeholder="نام حساب" value={name} onChange={(e) => setName(e.target.value)} style={st.input} />
      <AmountInput placeholder="موجودی اولیه (ریال)" value={initial} onChange={setInitial} style={st.input} />
      {(type === "bank" || type === "card") && <>
        <KeypadInput kind="digits" digitsMax={16} placeholder="شماره کارت ۱۶ رقمی" value={cardNumber} onChange={(e) => setCardNumber(e.target.value.replace(/[^0-9۰-۹]/g, "").replace(/[۰-۹]/g, d => "0123456789"["۰۱۲۳۴۵۶۷۸۹".indexOf(d)]).slice(0, 16))} style={st.input} inputMode="numeric" maxLength={16} />
        <KeypadInput kind="digits" digitsMax={4} placeholder="تاریخ انقضا، مثلا 04/08" value={expiryDate} onChange={(e) => setExpiryDate(fmtExpiry4(e.target.value))} style={st.input} inputMode="numeric" maxLength={5} />
      </>}
      <button onClick={add} style={st.primaryBtn}>افزودن</button>
    </div>
    <div style={{ ...st.card, padding: "4px 12px" }}>
      {accounts.length === 0 && <EmptyRow text="حسابی ثبت نشده" />}
      {accounts.map((a) => <div key={a.id}>
        <Row title={<>{a.name} {a.active === false && <span style={{fontSize:10,color:BRAND.crimson}}>· بایگانی</span>}</>} subtitle={`${a.type === "bank" ? "بانک" : a.type === "card" ? "کارت" : "صندوق"} · موجودی: ${toFaInt(accountBalance(a.id))} ریال`}
          extra={<div style={{ display: "flex", gap: 4 }}>
            {(a.type === "bank" || a.type === "card") && <button onClick={(e) => { e.stopPropagation(); setAverageAccountId(averageAccountId === a.id ? null : a.id); }} style={{ ...miniBtn, color: BRAND.header, fontWeight: 800, fontSize: 11, width: "auto", padding: "0 7px" }} title="معدل حساب">معدل</button>}
            <button onClick={(e) => { e.stopPropagation(); openEdit(a); }} style={{ ...miniBtn, color: BRAND.violet }} title="ویرایش حساب"><Pencil size={13} /></button>
            <button onClick={(e) => { e.stopPropagation(); toggleFavorite("accounts", a.id); }} style={{ background: "none", border: "none", cursor: "pointer" }}><Star size={16} fill={favorites.accounts.includes(a.id) ? "#f5b301" : "none"} color="#f5b301" /></button>
          </div>}
          leftIcon={<Trash2 size={15} />} leftColor={BRAND.crimson} onClick={() => deleteAccount(a.id)} chevron={null} />
        {averageAccountId === a.id && <AccountAveragePanel account={a} transactions={transactions} accountBalance={accountBalance} onClose={() => setAverageAccountId(null)} />}
        {editingId === a.id && <div style={{ background: "#f7f4fa", borderRadius: 12, padding: 10, margin: "2px 0 10px" }}>
          <input value={editForm.name} onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))} placeholder="نام حساب" style={{ ...st.input, marginBottom: 7 }} />
          <AmountInput value={editForm.initial} onChange={(v) => setEditForm(f => ({ ...f, initial: v }))} placeholder="موجودی اولیه" style={{ ...st.input, marginBottom: 7 }} />
          {(a.type === "bank" || a.type === "card") && <>
            <KeypadInput kind="digits" digitsMax={16} value={editForm.cardNumber} onChange={(e) => setEditForm(f => ({ ...f, cardNumber: e.target.value.replace(/[^0-9۰-۹]/g, "").replace(/[۰-۹]/g, d => "0123456789"["۰۱۲۳۴۵۶۷۸۹".indexOf(d)]).slice(0, 16) }))} placeholder="شماره کارت ۱۶ رقمی" style={{ ...st.input, marginBottom: 7 }} inputMode="numeric" maxLength={16} />
            <KeypadInput kind="digits" digitsMax={4} value={editForm.expiryDate} onChange={(e) => setEditForm(f => ({ ...f, expiryDate: fmtExpiry4(e.target.value) }))} placeholder="تاریخ انقضا، مثلا 04/08" style={{ ...st.input, marginBottom: 7 }} inputMode="numeric" maxLength={5} />
          </>}
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={(e) => { e.stopPropagation(); saveEdit(a); }} style={{ ...st.primaryBtn, flex: 1 }}>ذخیره اصلاحات</button>
            <button onClick={(e) => { e.stopPropagation(); setEditingId(null); }} style={{ ...st.primaryBtn, flex: 0.55, background: "#eee8f2", color: "#5c5064" }}>انصراف</button>
          </div>
        </div>}
      </div>)}
    </div>
    {bankAccounts.length > 0 && <div style={{ fontSize: 11, color: t.sub, margin: "10px 4px 0", lineHeight: 1.8 }}>دکمه «معدل» کنار هر بانک/کارت، معدل همان حساب را از روی تراکنش‌های ثبت‌شده در اپ محاسبه می‌کند.</div>}
  </div>;
}

function CategoriesManager({ categories, addCategory, deleteCategory, updateCategory, favorites, toggleFavorite }) {
  const st = useStyles();
  const [name, setName] = useState(""); const [kind, setKind] = useState("expense");
  const [subFormFor, setSubFormFor] = useState(null);
  const [subName, setSubName] = useState("");
  const topLevel = (list) => list.filter((c) => !c.parentId);
  const childrenOf = (id) => categories.filter((c) => c.parentId === id);
  const groupDefs = [
    { kind: "expense", label: "هزینه‌ها" }, { kind: "income", label: "درآمدها" },
    { kind: "fund", label: "صندوق‌ها" }, { kind: "bank", label: "بانک‌ها و کارت‌ها" },
    { kind: "asset", label: "دارائی‌ها" }, { kind: "liability", label: "بدهی‌ها" },
    { kind: "person", label: "اشخاص" }, { kind: "receivable", label: "بدهکاران" },
    { kind: "payable", label: "بستانکاران" }, { kind: "capital", label: "سرمایه" }, { kind: "other", label: "غیره" },
  ];

  function addSub(parentId, parentKind) {
    if (!subName.trim()) return;
    addCategory({ name: subName.trim(), kind: parentKind, parentId });
    setSubName(""); setSubFormFor(null);
  }

  function renderGroup(list) {
    return list.map((c) => (
      <div key={c.id}>
        <CatRow c={c} onDelete={deleteCategory} onUpdate={updateCategory} fav={favorites.categories.includes(c.id)} onFav={() => toggleFavorite("categories", c.id)}
          onAddSub={() => setSubFormFor(subFormFor === c.id ? null : c.id)} onTwoWay={() => updateCategory(c.id, { twoWay: !c.twoWay })} />
        {childrenOf(c.id).map((sub) => (
          <div key={sub.id} style={{ paddingRight: 22 }}>
            <CatRow c={sub} isSub onDelete={deleteCategory} onUpdate={updateCategory} fav={favorites.categories.includes(sub.id)} onFav={() => toggleFavorite("categories", sub.id)} />
          </div>
        ))}
        {subFormFor === c.id && (
          <div style={{ display: "flex", gap: 6, padding: "8px 4px 8px 22px" }}>
            <input autoFocus placeholder={`زیرمجموعه‌ی ${c.name}`} value={subName} onChange={(e) => setSubName(e.target.value)} style={{ ...st.input, margin: 0, flex: 1 }} />
            <button onClick={() => addSub(c.id, c.kind)} style={{ ...st.primaryBtn, width: "auto", padding: "0 16px" }}>افزودن</button>
          </div>
        )}
      </div>
    ));
  }

  return (
    <div>
      <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>افزودن سرفصل حساب</div>
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={st.input}>
          {groupDefs.map(g => <option key={g.kind} value={g.kind}>{g.label}</option>)}
        </select>
        <input placeholder="نام سرفصل" value={name} onChange={(e) => setName(e.target.value)} style={st.input} />
        <button onClick={() => { if (!name.trim()) return; addCategory({ name: name.trim(), kind }); setName(""); }} style={st.primaryBtn}>افزودن</button>
      </div>
      <div style={{ fontSize: 11.5, color: "#8a8194", margin: "0 4px 12px", lineHeight: 1.9 }}>هر سرفصل می‌تواند زیرمجموعه داشته باشد؛ مثلاً خودرو ← بنزین. زیرمجموعه همان موردی است که هنگام ثبت هزینه یا درآمد انتخاب می‌شود.</div>
      {groupDefs.map((g) => {
        const rows = topLevel(categories.filter(c => c.kind === g.kind || (c.twoWay && DEBT_GROUPS.includes(g.kind))));
        return <div key={g.kind}>
          <SectionTitle text={g.label} />
          <div style={{ ...st.card, padding: "4px 12px", marginBottom: 16 }}>
            {rows.length === 0 ? <EmptyRow text={`هنوز ${g.label} ثبت نشده`} /> : renderGroup(rows)}
          </div>
        </div>;
      })}
    </div>
  );
}
function CatRow({ c, onDelete, onUpdate, fav, onFav, onAddSub, isSub, onTwoWay }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(c.name);
  if (editing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 4px", borderBottom: `1px solid ${t.border}` }}>
        <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} style={{ flex: 1, padding: "6px 10px", borderRadius: 7, border: `1.5px solid ${t.inputBorder}`, background: t.input, color: t.text, fontSize: 13 }} />
        <button onClick={() => { if (val.trim()) onUpdate(c.id, { name: val.trim() }); setEditing(false); }} style={{ background: BRAND.green, border: "none", borderRadius: 7, color: "#fff", padding: "6px 10px", cursor: "pointer" }}><Check size={14} /></button>
        <button onClick={() => { setVal(c.name); setEditing(false); }} style={{ background: "none", border: "none", color: t.sub, cursor: "pointer" }}><X size={14} /></button>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 4px", borderBottom: `1px solid ${t.border}` }}>
      <span style={{ fontSize: isSub ? 13 : 14, fontWeight: isSub ? 500 : 600, color: isSub ? t.sub : t.text }}>{isSub && "↳ "}{c.name}{c.twoWay && <span style={{ marginRight: 6, fontSize: 10.5, fontWeight: 700, color: BRAND.violet, background: "rgba(88,39,119,.10)", borderRadius: 10, padding: "1px 7px" }}>↔ دو طرفه</span>}</span>
      <div style={{ display: "flex", gap: 8 }}>
        {onTwoWay && <button onClick={onTwoWay} title="دو طرفه (هم بدهکار هم بستانکار)" style={{ background: "none", border: "none", cursor: "pointer", color: c.twoWay ? BRAND.violet : t.sub, opacity: c.twoWay ? 1 : 0.55 }}><ArrowLeftRight size={15} /></button>}
        <button onClick={onFav} style={{ background: "none", border: "none", cursor: "pointer" }}><Star size={15} fill={fav ? "#f5b301" : "none"} color="#f5b301" /></button>
        <button onClick={() => setEditing(true)} style={{ background: "none", border: "none", color: BRAND.violet, cursor: "pointer" }}><Pencil size={15} /></button>
        {onAddSub && <button onClick={onAddSub} style={{ background: "none", border: "none", color: BRAND.green, cursor: "pointer" }}><Plus size={15} /></button>}
        <button onClick={() => onDelete(c.id)} style={{ background: "none", border: "none", color: BRAND.crimson, cursor: "pointer" }}><Trash2 size={15} /></button>
      </div>
    </div>
  );
}

function BudgetsManager({ categories, budgets, upsertBudget, addCategory }) {
  const st = useStyles();
  const expenseCats = categories.filter((c) => c.kind === "expense");
  const [newName, setNewName] = useState("");
  return (
    <div>
      <div style={{ ...st.card, padding: 14, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>افزودن آیتم بودجه جدید</div>
        <div style={{ display: "flex", gap: 6 }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="مثلا آموزش" style={{ ...st.input, margin: 0, flex: 1 }} />
          <button onClick={() => { if (!newName.trim()) return; addCategory?.({ name: newName.trim(), kind: "expense" }); setNewName(""); }} style={{ ...st.primaryBtn, width: "auto", padding: "0 14px" }}>افزودن</button>
        </div>
      </div>
      <div style={{ ...st.card, padding: "8px 12px" }}>
      {expenseCats.length === 0 && <EmptyRow text="ابتدا یک دسته هزینه بسازید" />}
      {expenseCats.map((c) => {
        const b = budgets.find((bb) => bb.categoryId === c.id);
        return <BudgetRow key={c.id} category={c} budget={b} upsertBudget={upsertBudget} st={st} />;
      })}
      </div>
    </div>
  );
}
function BudgetRow({ category, budget, upsertBudget, st }) {
  const [val, setVal] = useState(budget ? String(budget.amount) : "");
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 4px", borderBottom: "1px solid #f0eef3", gap: 10 }}>
      <span style={{ fontSize: 13.5, fontWeight: 600, flexShrink: 0 }}>{category.name}</span>
      <AmountInput placeholder="بودجه ماهانه" value={val} onChange={(v) => { setVal(v); upsertBudget(category.id, Number(v || 0)); }} style={{ ...st.input, margin: 0, width: 150 }} />
    </div>
  );
}

/* ---------------------------------------------------------
   Recurring Manager
--------------------------------------------------------- */
function RecurringManager({ recurring, setRecurring, categories, accounts }) {
  const st = useStyles();
  const emptyForm = {
    type: "expense",
    amount: "",
    categoryId: "",
    accountId: accounts[0]?.id || "",
    interval: "monthly",
    startDate: todayISO(),
    note: ""
  };
  const [form, setForm] = useState(emptyForm);
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);

  function resetForm() {
    setForm({ ...emptyForm, accountId: accounts[0]?.id || "" });
  }

  function add() {
    if (!form.amount || Number(form.amount) <= 0 || !form.categoryId || !form.accountId) return;
    setRecurring((p) => [
      ...p,
      {
        id: uid(),
        ...form,
        amount: Number(form.amount),
        nextDate: form.startDate,
        active: true,
        createdAt: new Date().toISOString()
      }
    ]);
    resetForm();
  }

  function startEdit(r) {
    setEditingId(r.id);
    setExpandedId(r.id);
    setEditForm({
      type: r.type || "expense",
      amount: String(r.amount ?? ""),
      categoryId: r.categoryId || "",
      accountId: r.accountId || accounts[0]?.id || "",
      interval: r.interval || "monthly",
      startDate: r.startDate || r.nextDate || todayISO(),
      note: r.note || ""
    });
  }

  function saveEdit() {
    if (!editingId || !editForm.amount || Number(editForm.amount) <= 0 || !editForm.categoryId || !editForm.accountId) return;
    setRecurring((p) => p.map((r) => {
      if (r.id !== editingId) return r;
      return {
        ...r,
        ...editForm,
        amount: Number(editForm.amount),
        startDate: editForm.startDate,
        nextDate: r.nextDate || editForm.startDate
      };
    }));
    setEditingId(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function remove(id) {
    if (expandedId === id) setExpandedId(null);
    if (editingId === id) setEditingId(null);
    setRecurring((p) => p.filter((x) => x.id !== id));
  }

  return (
    <div>
      <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>افزودن تراکنش تکرارشونده (مثل حقوق یا اجاره)</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button onClick={() => setForm({ ...form, type: "expense", categoryId: "" })} style={pillStyle(form.type === "expense")}>هزینه</button>
          <button onClick={() => setForm({ ...form, type: "income", categoryId: "" })} style={pillStyle(form.type === "income")}>درآمد</button>
        </div>
        <AmountInput placeholder="مبلغ" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} style={st.input} />
        <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} style={st.input}>
          <option value="">دسته را انتخاب کنید</option>
          {categories.filter((c) => c.kind === form.type).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} style={st.input}>
          <option value="">حساب را انتخاب کنید</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button onClick={() => setForm({ ...form, interval: "monthly" })} style={pillStyle(form.interval === "monthly")}>ماهانه</button>
          <button onClick={() => setForm({ ...form, interval: "weekly" })} style={pillStyle(form.interval === "weekly")}>هفتگی</button>
        </div>
        <label style={st.label}>تاریخ شروع</label>
        <JalaliDateInput value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} style={st.input} />
        <input placeholder="یادداشت (اختیاری)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={st.input} />
        <button onClick={add} style={st.primaryBtn}>افزودن</button>
      </div>

      <div style={{ ...st.card, padding: "4px 12px" }}>
        {recurring.length === 0 && <EmptyRow text="موردی ثبت نشده" />}
        {recurring.map((r) => {
          const category = categories.find((c) => c.id === r.categoryId);
          const account = accounts.find((a) => a.id === r.accountId);
          const isExpanded = expandedId === r.id;
          const isEditing = editingId === r.id;
          return (
            <React.Fragment key={r.id}>
              <Row
                title={category?.name || "—"}
                subtitle={`${r.interval === "monthly" ? "ماهانه" : "هفتگی"} · تراکنش بعدی: ${faLongDate(new Date(r.nextDate || r.startDate))}`}
                value={`${toFaInt(r.amount)} ریال`}
                extra={
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRecurring((p) => p.map((x) => x.id === r.id ? { ...x, active: !x.active } : x));
                    }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: r.active ? BRAND.green : "#aaa", fontSize: 11, fontWeight: 700 }}
                  >
                    {r.active ? "فعال" : "غیرفعال"}
                  </button>
                }
                leftIcon={<Trash2 size={15} />}
                leftColor={BRAND.crimson}
                onClick={() => setExpandedId(isExpanded ? null : r.id)}
                chevron={null}
              />

              {isExpanded && (
                <div style={{ padding: "4px 8px 14px", borderBottom: "1px solid #eee" }}>
                  {isEditing ? (
                    <div style={{ ...st.card, margin: 0, padding: 12, background: "#fafafa" }}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>ویرایش تراکنش تکرارشونده</div>
                      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                        <button onClick={() => setEditForm({ ...editForm, type: "expense", categoryId: "" })} style={pillStyle(editForm.type === "expense")}>هزینه</button>
                        <button onClick={() => setEditForm({ ...editForm, type: "income", categoryId: "" })} style={pillStyle(editForm.type === "income")}>درآمد</button>
                      </div>
                      <AmountInput placeholder="مبلغ" value={editForm.amount} onChange={(v) => setEditForm({ ...editForm, amount: v })} style={st.input} />
                      <select value={editForm.categoryId} onChange={(e) => setEditForm({ ...editForm, categoryId: e.target.value })} style={st.input}>
                        <option value="">دسته را انتخاب کنید</option>
                        {categories.filter((c) => c.kind === editForm.type).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <select value={editForm.accountId} onChange={(e) => setEditForm({ ...editForm, accountId: e.target.value })} style={st.input}>
                        <option value="">حساب را انتخاب کنید</option>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                        <button onClick={() => setEditForm({ ...editForm, interval: "monthly" })} style={pillStyle(editForm.interval === "monthly")}>ماهانه</button>
                        <button onClick={() => setEditForm({ ...editForm, interval: "weekly" })} style={pillStyle(editForm.interval === "weekly")}>هفتگی</button>
                      </div>
                      <JalaliDateInput value={editForm.startDate} onChange={(v) => setEditForm({ ...editForm, startDate: v })} style={st.input} />
                      <input placeholder="یادداشت (اختیاری)" value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} style={st.input} />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={saveEdit} style={st.primaryBtn}>ذخیره تغییرات</button>
                        <button onClick={cancelEdit} style={{ ...st.secondaryBtn, flex: 1 }}>انصراف</button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12.5 }}>
                        <div><b>نوع:</b> {r.type === "income" ? "درآمد" : "هزینه"}</div>
                        <div><b>مبلغ:</b> {toFaInt(r.amount)} ریال</div>
                        <div><b>دسته:</b> {category?.name || "—"}</div>
                        <div><b>حساب:</b> {account?.name || "—"}</div>
                        <div><b>دوره:</b> {r.interval === "monthly" ? "ماهانه" : "هفتگی"}</div>
                        <div><b>وضعیت:</b> {r.active ? "فعال" : "غیرفعال"}</div>
                        <div><b>تاریخ شروع:</b> {r.startDate ? faLongDate(new Date(r.startDate)) : "—"}</div>
                        <div><b>تراکنش بعدی:</b> {r.nextDate ? faLongDate(new Date(r.nextDate)) : "—"}</div>
                      </div>
                      {r.note && <div style={{ marginTop: 8, fontSize: 12.5 }}><b>یادداشت:</b> {r.note}</div>}
                      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                        <button onClick={() => startEdit(r)} style={st.secondaryBtn}>ویرایش</button>
                        <button onClick={() => remove(r.id)} style={{ ...st.secondaryBtn, color: BRAND.crimson }}>حذف</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Checks Manager
--------------------------------------------------------- */
function ChecksManager({ checks, setChecks, accounts = [], setTransactions, focusId, setFocusId }) {
  const st = useStyles();
  const [expandedId, setExpandedId] = useState(null);
  useFocusItem(focusId, setFocusId, setExpandedId);
  const [form, setForm] = useState({ type: "received", payee: "", amount: "", dueDate: todayISO(), note: "", sayadId: "", checkNumber: "", accountId: "" });
  function add() {
    if (!form.payee || !form.amount || !form.checkNumber || form.sayadId.length < 16 || form.sayadId.length > 20) return;
    setChecks((p) => [{ id: uid(), ...form, amount: Number(form.amount), status: "pending", createdAt: new Date().toISOString() }, ...p]);
    setForm({ ...form, payee: "", amount: "", note: "", sayadId: "", checkNumber: "" });
  }
  const canAdd = form.payee && form.amount && form.checkNumber && form.accountId && form.sayadId.length >= 16 && form.sayadId.length <= 20;
  const statusColor = { pending: BRAND.gold, cashed: BRAND.darkgreen, paid: BRAND.darkgreen, bounced: BRAND.crimson };
  const statusLabel = { pending: "در انتظار", cashed: "وصول شده", paid: "پرداخت شده", bounced: "برگشتی" };
  const sorted = [...checks].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const dueSoon = sorted.filter((c) => c.status === "pending" && daysUntil(c.dueDate) <= 7);
  return (
    <div>
      {dueSoon.length > 0 && (
        <div style={{ background: "#fff6ea", border: "1px solid #f0d9a8", borderRadius: 10, padding: 12, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: BRAND.orange, fontWeight: 700, fontSize: 13, marginBottom: 6 }}><BellRing size={16} /> یادآوری سررسید چک‌ها</div>
          {dueSoon.map((c) => (
            <div key={c.id} style={{ fontSize: 12.5, color: "#6b4c14" }}>
              {c.payee} — {toFaInt(c.amount)} ریال — {daysUntil(c.dueDate) < 0 ? "سررسید گذشته" : daysUntil(c.dueDate) === 0 ? "امروز سررسید است" : `${toFaInt(daysUntil(c.dueDate))} روز مانده`}
            </div>
          ))}
        </div>
      )}
      <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>ثبت چک جدید</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button onClick={() => setForm({ ...form, type: "received" })} style={pillStyle(form.type === "received")}>دریافتی</button>
          <button onClick={() => setForm({ ...form, type: "paid" })} style={pillStyle(form.type === "paid")}>پرداختی</button>
        </div>
        <input placeholder="نام طرف حساب" value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} style={st.input} />
        <AmountInput placeholder="مبلغ" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} style={st.input} />
        <label style={st.label}>شناسه صیادی (۱۶ رقم)</label>
        <KeypadInput kind="digits" digitsMax={16} placeholder="شناسه ۱۶ رقمی روی چک" value={form.sayadId}
          onChange={(e) => setForm({ ...form, sayadId: e.target.value.replace(/[^0-9]/g, "").slice(0, 20) })}
          style={{ ...st.input, direction: "ltr", textAlign: "right", borderColor: form.sayadId && form.sayadId.length < 16 ? BRAND.crimson : st.input.border }} inputMode="numeric" maxLength={20} />
        {form.sayadId && form.sayadId.length < 16 && <div style={{ fontSize: 11, color: BRAND.crimson, marginTop: -6, marginBottom: 10 }}>شناسه صیادی باید حداقل ۱۶ رقم باشد ({toFaInt(form.sayadId.length)}/۱۶)</div>}
        <label style={st.label}>شماره چک</label>
        <input placeholder="شماره سریال چک" value={form.checkNumber} onChange={(e) => setForm({ ...form, checkNumber: e.target.value })} style={{ ...st.input, direction: "ltr", textAlign: "right" }} />
        <label style={st.label}>حساب مقصد / پرداخت</label>
        <select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} style={st.input}><option value="">انتخاب حساب</option>{accounts.filter(a => a.active !== false).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <label style={st.label}>تاریخ سررسید</label>
        <JalaliDateInput value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} style={st.input} />
        <input placeholder="یادداشت (اختیاری)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={st.input} />
        <button onClick={add} disabled={!canAdd} style={{ ...st.primaryBtn, opacity: canAdd ? 1 : 0.5 }}>ثبت چک</button>
      </div>
      <div style={{ ...st.card, padding: "4px 12px" }}>
        {checks.length === 0 && <EmptyRow text="چکی ثبت نشده" />}
        {sorted.map((c) => {
          const d = daysUntil(c.dueDate);
          const urgent = c.status === "pending" && d <= 7;
          return (
          <div key={c.id} id={`item-${c.id}`} style={{ padding: "12px 4px", borderBottom: "1px solid #f0eef3" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{c.payee} ({c.type === "received" ? "دریافتی" : "پرداختی"})</span>
              <span style={{ fontWeight: 700 }}>{toFaInt(c.amount)} ریال</span>
            </div>
            {(c.sayadId || c.checkNumber) && (
              <div style={{ fontSize: 11, color: "#8a8194", marginBottom: 4, direction: "ltr", textAlign: "right" }}>
                {c.sayadId && `شناسه صیادی: ${c.sayadId}`}{c.sayadId && c.checkNumber ? " · " : ""}{c.checkNumber && `شماره چک: ${c.checkNumber}`}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: urgent ? (d < 0 ? BRAND.crimson : BRAND.orange) : "#8a8194", fontWeight: urgent ? 700 : 400 }}>
                سررسید: {faLongDate(new Date(c.dueDate))}{c.status === "pending" ? ` (${d < 0 ? "گذشته" : d === 0 ? "امروز" : `${toFaInt(d)} روز مانده`})` : ""}
              </span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <StatusBadge text={statusLabel[c.status]} color={statusColor[c.status]} />
                <button onClick={() => setExpandedId(expandedId === c.id ? null : c.id)} style={{ background: expandedId === c.id ? BRAND.violet : "#f1eef4", color: expandedId === c.id ? "#fff" : "#5f566b", border: "none", borderRadius: 7, padding: "5px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  {expandedId === c.id ? "بستن جزئیات" : "جزئیات"}
                </button>
                <select value={c.status} onChange={(e) => {
                  const next = e.target.value;
                  setChecks((p) => p.map((x) => x.id === c.id ? { ...x, status: next, ...(next === "pending" ? { linkedTransactionId: "" } : {}) } : x));
                  setTransactions?.((prev) => {
                    let list = prev.filter((t) => !(t.sourceType === "check" && t.sourceId === c.id));
                    if (next === "cashed" && c.accountId) list = postOnce(list, { type: "income", amount: c.amount, accountId: c.accountId, date: c.dueDate, time: "12:00", note: `وصول چک ${c.checkNumber || c.sayadId} - ${c.payee}`, sourceType: "check", sourceId: c.id, checkId: c.id, categoryId: "cat-check-received", isPnlExcluded: true });
                    if (next === "bounced") return list;
                    if (next === "paid" && c.accountId) list = postOnce(list, { type: "expense", amount: c.amount, accountId: c.accountId, date: c.dueDate, time: "12:00", note: `پرداخت چک ${c.checkNumber || c.sayadId} - ${c.payee}`, sourceType: "check", sourceId: c.id, checkId: c.id, categoryId: "cat-check-paid", isPnlExcluded: true });
                    return list;
                  });
                }} style={{ fontSize: 11, borderRadius: 6, border: "1px solid #ddd" }}>
                  <option value="pending">در انتظار</option>{c.type === "received" ? <option value="cashed">وصول شده</option> : <option value="paid">پرداخت شده</option>}<option value="bounced">برگشتی</option>
                </select>
                <button onClick={() => { setChecks((p) => p.filter((x) => x.id !== c.id)); setTransactions?.((p) => p.filter((t) => !(t.sourceType === "check" && t.sourceId === c.id))); }} style={{ background: "none", border: "none", color: BRAND.crimson, cursor: "pointer" }}><Trash2 size={15} /></button>
              </div>
            </div>
            {expandedId === c.id && (
              <div style={{ margin: "8px 0 2px", padding: 12, borderRadius: 10, background: "#f8f6fa", border: "1px solid #ebe6f0", fontSize: 12 }}>
                <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 9 }}>جزئیات کامل چک</div>
                {[
                  ["نوع", c.type === "received" ? "چک دریافتی" : "چک پرداختی"],
                  ["طرف حساب", c.payee || "—"],
                  ["مبلغ", `${toFaInt(c.amount)} ریال`],
                  ["شناسه صیادی", c.sayadId || "—"],
                  ["شماره چک", c.checkNumber || "—"],
                  ["حساب", accounts.find(a => a.id === c.accountId)?.name || "انتخاب نشده"],
                  ["تاریخ سررسید", c.dueDate ? faLongDate(new Date(c.dueDate)) : "—"],
                  ["وضعیت", statusLabel[c.status] || "—"],
                  ["وضعیت سررسید", c.status === "pending" ? (d < 0 ? "سررسید گذشته" : d === 0 ? "امروز" : `${toFaInt(d)} روز مانده`) : "تعیین تکلیف شده"],
                  ["یادداشت", c.note || "—"],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: "1px solid #ece8ef" }}>
                    <span style={{ color: "#81788c" }}>{k}</span><strong style={{ textAlign: "left", direction: k === "شناسه صیادی" || k === "شماره چک" ? "ltr" : "rtl" }}>{v}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Loans Manager
--------------------------------------------------------- */
/* وام‌ها به حساب بانکی وصل‌اند: دریافت وام = افزایش موجودی، هر قسط = کاهش موجودی (به‌صورت تراکنش‌های واقعی با برچسب «وام») */
const LOAN_CAT_RECEIPT = "cat-loan-receipt", LOAN_CAT_INSTALL = "cat-loan-installment";
const loanReceiptTx = (l, id, createdAt) => ({ id: id || uid(), type: "income", amount: l.principal, categoryId: LOAN_CAT_RECEIPT, accountId: l.accountId, date: l.startDate, time: "08:00", note: `دریافت وام «${l.title}»`, tags: ["وام"], loanId: l.id, loanRole: "receipt", isFinancing: true, pnlAmount: 0, sourceType: "loan_receipt", sourceId: l.id, contraAccount: "ledger:loan-liability", createdAt: createdAt || new Date().toISOString() });
const loanInstallmentTx = (l, seq) => {
  const totalInterest = Math.max(0, Number(l.installments || 0) * Number(l.monthlyPayment || 0) - Number(l.principal || 0));
  const interestPerInstallment = l.installments ? totalInterest / Number(l.installments) : 0;
  const principalPart = Math.max(0, Number(l.monthlyPayment || 0) - interestPerInstallment);
  return { id: uid(), type: "expense", amount: l.monthlyPayment, pnlAmount: interestPerInstallment, categoryId: LOAN_CAT_INSTALL, accountId: l.accountId, date: todayISO(), time: new Date().toTimeString().slice(0, 5), note: `قسط ${seq} از ${l.installments} وام «${l.title}»`, tags: ["وام", "قسط"], loanId: l.id, loanRole: "installment", loanSeq: seq, isFinancing: true, principalPart, interestPart: interestPerInstallment, sourceType: "loan_installment", sourceId: `${l.id}:${seq}`, contraAccount: "ledger:loan-liability", createdAt: new Date().toISOString() };
};
function LoansManager({ loans, setLoans, accounts = [], categories = [], addCategory, setTransactions, focusId, setFocusId }) {
  const st = useStyles();
  const [expandedId, setExpandedId] = useState(null);
  useFocusItem(focusId, setFocusId, setExpandedId);
  const emptyForm = () => ({ title: "", principal: "", installments: "", monthlyPayment: "", startDate: todayISO(), spent: false, accountId: "" });
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const ensureLoanCats = () => {
    if (!categories.some((c) => c.id === LOAN_CAT_RECEIPT)) addCategory?.({ id: LOAN_CAT_RECEIPT, name: "دریافت وام", kind: "liability" });
    if (!categories.some((c) => c.id === LOAN_CAT_INSTALL)) addCategory?.({ id: LOAN_CAT_INSTALL, name: "قسط وام", kind: "liability" });
  };
  const accName = (id) => accounts.find((a) => a.id === id)?.name || "";
  function submit() {
    if (!form.title || !form.principal || !form.installments || !form.monthlyPayment) return;
    const base = { title: form.title.trim(), principal: Number(form.principal), installments: Number(form.installments), monthlyPayment: Number(form.monthlyPayment), startDate: form.startDate, spent: !!form.spent, accountId: form.accountId || "" };
    ensureLoanCats();
    if (editingId) {
      const old = loans.find((x) => x.id === editingId); if (!old) return;
      const next = { ...old, ...base, paidCount: Math.min(old.paidCount || 0, base.installments) };
      setLoans((p) => p.map((x) => x.id === old.id ? next : x));
      setTransactions?.((prev) => {
        const oldReceipt = prev.find((t) => t.loanId === old.id && t.loanRole === "receipt");
        let list = prev.filter((t) => !(t.loanId === old.id && t.loanRole === "receipt") && !(t.loanId === old.id && t.loanRole === "installment" && t.loanSeq > next.paidCount));
        list = list.map((t) => t.loanId === old.id && t.loanRole === "installment" ? { ...t, ...(next.accountId ? { accountId: next.accountId } : {}), note: `قسط ${t.loanSeq} از ${next.installments} وام «${next.title}»` } : t);
        if (!next.spent && next.accountId) list = [loanReceiptTx(next, oldReceipt?.id, oldReceipt?.createdAt), ...list];   // وام قدیمی/خرج‌شده موجودی را زیاد نمی‌کند
        return list;
      });
      setEditingId(null);
    } else {
      const loan = { id: uid(), ...base, paidCount: 0 };
      setLoans((p) => [...p, loan]);
      if (!loan.spent && loan.accountId) setTransactions?.((prev) => [loanReceiptTx(loan), ...prev]);
    }
    setForm(emptyForm());
  }
  function startEdit(l) {
    setForm({ title: l.title, principal: String(l.principal), installments: String(l.installments), monthlyPayment: String(l.monthlyPayment), startDate: l.startDate, spent: !!l.spent, accountId: l.accountId || "" });
    setEditingId(l.id);
    setTimeout(() => { try { document.getElementById("loan-form")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch {} }, 60);
  }
  function removeLoan(l) {
    if (!window.confirm(`وام «${l.title}» با تراکنش‌های دریافت و اقساط مرتبطش حذف شود؟`)) return;
    setLoans((p) => p.filter((x) => x.id !== l.id));
    setTransactions?.((prev) => prev.filter((t) => t.loanId !== l.id));
    if (editingId === l.id) { setEditingId(null); setForm(emptyForm()); }
  }
  function payInstallment(l) {
    if (l.paidCount >= l.installments) return;
    const seq = l.paidCount + 1;
    ensureLoanCats();
    setLoans((p) => p.map((x) => x.id === l.id ? { ...x, paidCount: seq } : x));
    if (l.accountId) setTransactions?.((prev) => [loanInstallmentTx(l, seq), ...prev]);
  }
  function undoLast(l) {
    if (!l.paidCount) return;
    if (!window.confirm(`قسط شماره ${l.paidCount} برگردانده شود؟${l.accountId ? " مبلغ آن به حساب بانکی برمی‌گردد." : ""}`)) return;
    setLoans((p) => p.map((x) => x.id === l.id ? { ...x, paidCount: x.paidCount - 1 } : x));
    setTransactions?.((prev) => prev.filter((t) => !(t.loanId === l.id && t.loanRole === "installment" && t.loanSeq === l.paidCount)));
  }
  return (
    <div>
      <div id="loan-form" style={{ ...st.card, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>{editingId ? "ویرایش وام" : "ثبت وام جدید"}</div>
        <input placeholder="عنوان وام (مثلا وام خودرو)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={st.input} />
        <AmountInput placeholder="مبلغ اصل وام" value={form.principal} onChange={(v) => setForm({ ...form, principal: v })} style={st.input} />
        <KeypadInput kind="digits" placeholder="تعداد اقساط" value={form.installments} onChange={(e) => setForm({ ...form, installments: e.target.value.replace(/[^0-9]/g, "") })} style={st.input} inputMode="numeric" />
        <AmountInput placeholder="مبلغ هر قسط" value={form.monthlyPayment} onChange={(v) => setForm({ ...form, monthlyPayment: v })} style={st.input} />
        <label style={st.label}>تاریخ شروع (تاریخ دریافت وام)</label>
        <JalaliDateInput value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} style={st.input} />
        <label style={st.label}>حساب بانکی</label>
        <SourceAccountField accounts={accounts} categories={categories} accountId={form.accountId} fromCategoryId="" allowTwoWay={false} title="انتخاب حساب بانکی" onChange={(v) => setForm({ ...form, accountId: v.accountId })} st={st} />
        <div style={{ fontSize: 11.5, color: "#8a8194", lineHeight: 1.9, margin: "-2px 0 8px" }}>دریافت وام به موجودی این حساب اضافه و هر قسط از آن کم می‌شود. اگر انتخاب نکنی، تراکنشی در حساب بانکی ثبت نمی‌شود.</div>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, margin: "4px 0 14px", fontSize: 13, fontWeight: 700, lineHeight: 1.9, cursor: "pointer" }}>
          <input type="checkbox" checked={!!form.spent} onChange={(e) => setForm({ ...form, spent: e.target.checked })} style={{ width: 20, height: 20, marginTop: 4, flexShrink: 0 }} />
          <span>مبلغ این وام قبلاً دریافت و خرج شده است (وام قدیمی)<br /><span style={{ fontWeight: 500, fontSize: 11.5, color: "#8a8194" }}>موجودی بانک را افزایش نمی‌دهد و در ترازنامه ناترازی ایجاد نمی‌کند؛ اقساط بعدی همچنان از حساب کم می‌شود.</span></span>
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={submit} style={st.primaryBtn}>{editingId ? "ذخیره تغییرات" : "ثبت وام"}</button>
          {editingId && <button onClick={() => { setEditingId(null); setForm(emptyForm()); }} style={{ ...st.primaryBtn, background: "#e9e5ef", color: "#3E1461", width: "auto", padding: "0 18px" }}>انصراف</button>}
        </div>
      </div>
      <div style={{ ...st.card, padding: "4px 12px" }}>
        {loans.length === 0 && <EmptyRow text="وامی ثبت نشده" />}
        {loans.map((l) => {
          const remaining = l.principal - l.paidCount * l.monthlyPayment;
          const nextDue = addMonths(l.startDate, l.paidCount);
          return (
            <div key={l.id} id={`item-${l.id}`} style={{ padding: "12px 4px", borderBottom: "1px solid #f0eef3" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{l.title}{l.spent && <span style={{ marginRight: 8, fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: "#f1eef4", color: "#6b6377" }}>خرج‌شده</span>}</span>
                <span style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => setExpandedId(expandedId === l.id ? null : l.id)} aria-label="جزئیات" title="جزئیات کامل" style={{ background: expandedId === l.id ? BRAND.violet : "#f1eef4", color: expandedId === l.id ? "#fff" : "#5f566b", border: "none", borderRadius: 7, padding: "5px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{expandedId === l.id ? "بستن" : "جزئیات"}</button>
                  <button onClick={() => startEdit(l)} aria-label="ویرایش" style={{ background: "none", border: "none", color: BRAND.violet, cursor: "pointer" }}><Pencil size={15} /></button>
                  <button onClick={() => removeLoan(l)} aria-label="حذف" style={{ background: "none", border: "none", color: BRAND.crimson, cursor: "pointer" }}><Trash2 size={15} /></button>
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: "#8a8194", marginBottom: 4 }}>قسط {toFaInt(l.paidCount)} از {toFaInt(l.installments)} پرداخت شده — سررسید بعدی: {l.paidCount < l.installments ? faLongDate(new Date(nextDue)) : "تسویه شده"}</div>
              <div style={{ fontSize: 12, color: "#8a8194", marginBottom: 6 }}>{l.accountId && accName(l.accountId) ? `حساب بانکی: ${accName(l.accountId)}` : "بدون اتصال به حساب بانکی"}</div>
              {expandedId === l.id && (() => {
                const totalPaid = Number(l.paidCount || 0) * Number(l.monthlyPayment || 0);
                const totalInterest = Math.max(0, Number(l.installments || 0) * Number(l.monthlyPayment || 0) - Number(l.principal || 0));
                const remainingInstallments = Math.max(0, Number(l.installments || 0) - Number(l.paidCount || 0));
                return (
                  <div style={{ margin: "8px 0 10px", padding: 12, borderRadius: 10, background: "#f8f6fa", border: "1px solid #ebe6f0", fontSize: 12 }}>
                    <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 9 }}>جزئیات کامل وام</div>
                    {[
                      ["اصل وام", `${toFaInt(l.principal)} ریال`],
                      ["مبلغ هر قسط", `${toFaInt(l.monthlyPayment)} ریال`],
                      ["کل اقساط", toFaInt(l.installments)],
                      ["اقساط پرداخت‌شده", toFaInt(l.paidCount)],
                      ["اقساط باقی‌مانده", toFaInt(remainingInstallments)],
                      ["مجموع پرداخت‌شده", `${toFaInt(totalPaid)} ریال`],
                      ["سود/هزینه تأمین مالی", `${toFaInt(totalInterest)} ریال`],
                      ["مانده بدهی", `${toFaInt(Math.max(remaining, 0))} ریال`],
                      ["حساب بانکی", accName(l.accountId) || "انتخاب نشده"],
                      ["تاریخ شروع", l.startDate ? faLongDate(new Date(l.startDate)) : "—"],
                      ["سررسید بعدی", l.paidCount < l.installments ? faLongDate(new Date(nextDue)) : "تسویه شده"],
                      ["وضعیت", l.paidCount >= l.installments ? "تسویه شده" : (l.spent ? "وام قدیمی / خرج‌شده" : "فعال")],
                    ].map(([k, v]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: "1px solid #ece8ef" }}>
                        <span style={{ color: "#81788c" }}>{k}</span><strong>{v}</strong>
                      </div>
                    ))}
                  </div>
                );
              })()}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, color: remaining > 0 ? BRAND.crimson : BRAND.darkgreen }}>باقی‌مانده: {toFaInt(Math.max(remaining, 0))} ریال</span>
                <span style={{ display: "flex", gap: 6 }}>
                  {l.paidCount > 0 && <button onClick={() => undoLast(l)} style={{ background: "#f1eef4", color: BRAND.header, border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>اصلاح آخرین قسط</button>}
                  {l.paidCount < l.installments && <button onClick={() => payInstallment(l)} style={{ background: BRAND.green, color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>ثبت پرداخت قسط</button>}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Bills Manager
--------------------------------------------------------- */
const BILL_CATS = ["آب", "برق", "گاز", "اینترنت", "تلفن", "سایر"];
function BillsManager({ bills, setBills, accounts = [], setTransactions, focusId, setFocusId }) {
  const st = useStyles();
  const [expandedId, setExpandedId] = useState(null);
  useFocusItem(focusId, setFocusId, setExpandedId);
  const [form, setForm] = useState({ title: "آب", amount: "", dueDate: todayISO(), recurringMonthly: true, accountId: "" });
  function add() {
    setBills((p) => [...p, { id: uid(), title: form.title, amount: Number(form.amount || 0), dueDate: form.dueDate, recurringMonthly: form.recurringMonthly, accountId: form.accountId || "", paid: false, createdAt: new Date().toISOString() }]);
    setForm({ ...form, amount: "" });
  }
  function markPaid(b) {
    if (!b.amount || !b.accountId) { alert("برای ثبت پرداخت، مبلغ و حساب پرداخت را مشخص کنید."); return; }
    const tx = { id: uid(), type: "expense", amount: Number(b.amount), accountId: b.accountId, date: todayISO(), time: new Date().toTimeString().slice(0,5), note: `پرداخت قبض ${b.title}`, sourceType: "bill", sourceId: `${b.id}:${Date.now()}`, billId: b.id, categoryId: "cat-bill-payment", isPnlExcluded: false };
    setTransactions?.((prev) => postOnce(prev, tx));
    setBills((prev) => prev.map((x) => x.id === b.id ? (x.recurringMonthly ? { ...x, dueDate: addMonths(x.dueDate, 1), paid: false, lastPaymentTxId: tx.id } : { ...x, paid: true, lastPaymentTxId: tx.id }) : x));
  }
  return (
    <div>
      <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>افزودن قبض</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {BILL_CATS.map((c) => <button key={c} onClick={() => setForm({ ...form, title: c })} style={{ ...pillStyle(form.title === c), flex: "none", padding: "7px 12px" }}>{c}</button>)}
        </div>
        <AmountInput placeholder="مبلغ (اختیاری)" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} style={st.input} />
        <label style={st.label}>حساب مقصد / پرداخت</label>
        <select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} style={st.input}><option value="">انتخاب حساب</option>{accounts.filter(a => a.active !== false).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <label style={st.label}>تاریخ سررسید</label>
        <JalaliDateInput value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} style={st.input} />
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 12 }}>
          <input type="checkbox" checked={form.recurringMonthly} onChange={(e) => setForm({ ...form, recurringMonthly: e.target.checked })} /> یادآوری ماهانه تکرار شود
        </label>
        <button onClick={add} style={st.primaryBtn}>افزودن قبض</button>
      </div>
      <div style={{ ...st.card, padding: "4px 12px" }}>
        {bills.length === 0 && <EmptyRow text="قبضی ثبت نشده" />}
        {[...bills].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((b) => {
          const d = daysUntil(b.dueDate);
          return (
            <div key={b.id} id={`item-${b.id}`}>
            <div onClick={() => setExpandedId(expandedId === b.id ? null : b.id)} style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 4px", borderBottom: "1px solid #f0eef3" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{b.title}{b.amount ? ` — ${toFaInt(b.amount)} ریال` : ""}</div>
                <div style={{ fontSize: 12, color: b.paid ? BRAND.darkgreen : d < 0 ? BRAND.crimson : "#8a8194" }}>
                  {faLongDate(new Date(b.dueDate))} · {b.paid ? "پرداخت شده" : d < 0 ? "سررسید گذشته" : `${toFaInt(d)} روز مانده`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {!b.paid && <button onClick={(e) => { e.stopPropagation(); markPaid(b); }} style={{ background: BRAND.green, color: "#fff", border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>ثبت پرداخت</button>}
                <button onClick={(e) => { e.stopPropagation(); setBills((p) => p.filter((x) => x.id !== b.id)); setTransactions?.((p) => p.filter((t) => !(t.sourceType === "bill" && (t.billId === b.id || String(t.sourceId || "").startsWith(`${b.id}:`))))); }} style={{ background: "none", border: "none", color: BRAND.crimson, cursor: "pointer" }}><Trash2 size={15} /></button>
              </div>
            </div>
            {expandedId === b.id && (
              <DetailBox lines={[
                ["نوع قبض", b.title],
                ["مبلغ", b.amount ? `${toFaInt(b.amount)} ریال` : "ثبت نشده"],
                ["سررسید", b.dueDate ? faLongDate(new Date(b.dueDate)) : "—"],
                ["وضعیت", b.paid ? "پرداخت شده" : d < 0 ? "سررسید گذشته" : `${toFaInt(d)} روز مانده`],
                ["تکرار ماهانه", b.recurringMonthly ? "بله" : "خیر"],
                ["حساب پرداخت", accounts.find((a) => a.id === b.accountId)?.name || "انتخاب نشده"],
              ]} />
            )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Assets Manager
--------------------------------------------------------- */
function AssetPriceEdit({ asset, setAssets, st }) {
  const [val, setVal] = useState(String(asset.currentPrice));
  return (
    <AmountInput value={val} onChange={(v) => { setVal(v); setAssets((p) => p.map((x) => x.id === asset.id ? { ...x, currentPrice: Number(v || 0) } : x)); }} style={{ ...st.input, margin: 0, width: 110 }} />
  );
}
function AssetsManager({ assets, setAssets, accounts = [], setTransactions }) {
  const [refreshing, setRefreshing] = useState(false);
  const st = useStyles();
  const [form, setForm] = useState({ kind: "crypto", symbol: "", quantity: "", avgPrice: "", currentPrice: "", accountId: "" });
  const total = assets.reduce((s, a) => s + a.quantity * a.currentPrice, 0);
  function add() {
    if (!form.symbol || !form.quantity) return;
    const assetId = uid();
    const qty = Number(form.quantity), avg = Number(form.avgPrice || 0), cost = qty * avg;
    setAssets((p) => [...p, { id: assetId, kind: form.kind, symbol: form.symbol, quantity: qty, avgPrice: avg, currentPrice: Number(form.currentPrice || avg || 0), accountId: form.accountId || "", createdAt: new Date().toISOString() }]);
    if (cost > 0 && form.accountId) setTransactions?.((prev) => postOnce(prev, { type: "expense", amount: cost, accountId: form.accountId, date: todayISO(), time: new Date().toTimeString().slice(0,5), note: `خرید دارایی ${form.symbol}`, sourceType: "asset_purchase", sourceId: assetId, assetId, categoryId: "cat-asset-purchase", isPnlExcluded: true }));
    setForm({ ...form, symbol: "", quantity: "", avgPrice: "", currentPrice: "" });
  }
  return (
    <div>
      <div style={{ background: "#eef8f1", border: "1px solid #cde7d4", borderRadius: 10, padding: 10, marginBottom: 14, fontSize: 12, color: "#28633a", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span>قیمت دارایی‌های شناخته‌شده ارز دیجیتال را می‌توانی لحظه‌ای بروزرسانی کنی.</span>
        <button disabled={refreshing} onClick={async () => {
          setRefreshing(true);
          try {
            const ids = { BTC: "bitcoin", ETH: "ethereum", USDT: "tether", BNB: "binancecoin", XRP: "ripple", SOL: "solana" };
            for (const a of assets.filter((x) => x.kind === "crypto")) {
              const coin = ids[String(a.symbol).toUpperCase()]; if (!coin) continue;
              const data = Capacitor.isNativePlatform()
                ? (await CapacitorHttp.get({ url: `https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=irr` })).data
                : await (await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=irr`)).json();
              const price = Number(data?.[coin]?.irr);
              if (price > 0) setAssets((p) => p.map((x) => x.id === a.id ? { ...x, currentPrice: price, priceUpdatedAt: new Date().toISOString() } : x));
            }
          } catch {} finally { setRefreshing(false); }
        }} style={{ ...miniBtn, width: 38, height: 38, background: BRAND.green, color: "#fff" }}><RefreshCw size={15} /></button>
      </div>
      <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>افزودن دارایی</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button onClick={() => setForm({ ...form, kind: "crypto" })} style={pillStyle(form.kind === "crypto")}>ارز دیجیتال</button>
          <button onClick={() => setForm({ ...form, kind: "stock" })} style={pillStyle(form.kind === "stock")}>بورس</button>
        </div>
        <input placeholder="نماد (مثلا BTC یا فولاد)" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} style={st.input} />
        <KeypadInput kind="decimal" placeholder="تعداد / مقدار" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} style={st.input} inputMode="decimal" />
        <AmountInput placeholder="قیمت خرید (ریال)" value={form.avgPrice} onChange={(v) => setForm({ ...form, avgPrice: v })} style={st.input} />
        <select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} style={st.input}><option value="">حساب پرداخت خرید (اختیاری)</option>{accounts.filter(a => a.active !== false).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <AmountInput placeholder="قیمت فعلی (ریال)" value={form.currentPrice} onChange={(v) => setForm({ ...form, currentPrice: v })} style={st.input} />
        <button onClick={add} style={st.primaryBtn}>افزودن دارایی</button>
      </div>
      <SectionTitle text={`ارزش کل: ${toFaInt(total)} ریال`} />
      <div style={{ ...st.card, padding: "4px 12px" }}>
        {assets.length === 0 && <EmptyRow text="دارایی‌ای ثبت نشده" />}
        {assets.map((a) => (
          <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 4px", borderBottom: "1px solid #f0eef3" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{a.symbol} <span style={{ fontSize: 11, color: "#8a8194" }}>({a.kind === "crypto" ? "ارز دیجیتال" : "بورس"})</span></div>
              <div style={{ fontSize: 12, color: "#8a8194" }}>تعداد: {a.quantity} · ارزش: {toFaInt(a.quantity * a.currentPrice)} ریال</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <AssetPriceEdit asset={a} setAssets={setAssets} st={st} />
              <button onClick={() => { setAssets((p) => p.filter((x) => x.id !== a.id)); setTransactions?.((p) => p.filter((t) => !(t.sourceType === "asset_purchase" && t.sourceId === a.id))); }} style={{ background: "none", border: "none", color: BRAND.crimson, cursor: "pointer" }}><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Members / Events / Projects Manager (تگ‌گذاری اعضای خانواده، رویداد و پروژه)
--------------------------------------------------------- */
function MembersEventsProjectsManager({ members, setMembers, events, setEvents, projects, setProjects }) {
  const st = useStyles();
  const [tab, setTab] = useState("members");
  const [name, setName] = useState("");
  const map = {
    members: { list: members, setList: setMembers, label: "عضو خانواده", color: BRAND.violet },
    events: { list: events, setList: setEvents, label: "رویداد", color: BRAND.teal },
    projects: { list: projects, setList: setProjects, label: "پروژه", color: BRAND.gold },
  };
  const cur = map[tab];
  function add() {
    if (!name.trim()) return;
    cur.setList((p) => [...p, { id: uid(), name: name.trim() }]);
    setName("");
  }
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setTab("members")} style={pillStyle(tab === "members")}>اعضای خانواده</button>
        <button onClick={() => setTab("events")} style={pillStyle(tab === "events")}>رویدادها</button>
        <button onClick={() => setTab("projects")} style={pillStyle(tab === "projects")}>پروژه‌ها</button>
      </div>
      <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>افزودن {cur.label}</div>
        <input placeholder={`نام ${cur.label}`} value={name} onChange={(e) => setName(e.target.value)} style={st.input} />
        <button onClick={add} style={st.primaryBtn}>افزودن</button>
      </div>
      <div style={{ ...st.card, padding: "4px 12px" }}>
        {cur.list.length === 0 && <EmptyRow text={`${cur.label}ی ثبت نشده`} />}
        {cur.list.map((m) => (
          <Row key={m.id} title={m.name} leftIcon={<Trash2 size={15} />} leftColor={BRAND.crimson}
            onClick={() => cur.setList((p) => p.filter((x) => x.id !== m.id))} chevron={null} />
        ))}
      </div>
      <div style={{ fontSize: 12, color: "#8a8194", marginTop: 12 }}>
        این موارد را می‌توانید هنگام ثبت تراکنش (بخش «بیشتر») به هر پرداخت یا دریافت نسبت دهید تا در گزارش‌ها به‌تفکیک عضو، رویداد یا پروژه ببینید.
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Fiscal Periods Manager (دوره مالی)
--------------------------------------------------------- */
function FiscalPeriodsManager({ fiscalPeriods, setFiscalPeriods }) {
  const st = useStyles();
  const [form, setForm] = useState({ title: "", startDate: todayISO(), endDate: todayISO() });
  function add() {
    if (!form.title) return;
    setFiscalPeriods((p) => [...p, { id: uid(), ...form }]);
    setForm({ title: "", startDate: todayISO(), endDate: todayISO() });
  }
  return (
    <div>
      <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>تعریف دوره مالی جدید</div>
        <div style={{ fontSize: 12, color: "#8a8194", marginBottom: 10 }}>مثلا «سال مالی ۱۴۰۴» یا «فصل بهار». در گزارش‌ها می‌توانید بر اساس این بازه فیلتر کنید.</div>
        <input placeholder="عنوان دوره" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={st.input} />
        <label style={st.label}>تاریخ شروع</label>
        <JalaliDateInput value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} style={st.input} />
        <label style={st.label}>تاریخ پایان</label>
        <JalaliDateInput value={form.endDate} onChange={(v) => setForm({ ...form, endDate: v })} style={st.input} />
        <button onClick={add} style={st.primaryBtn}>افزودن دوره</button>
      </div>
      <div style={{ ...st.card, padding: "4px 12px" }}>
        {fiscalPeriods.length === 0 && <EmptyRow text="دوره‌ای ثبت نشده" />}
        {fiscalPeriods.map((p) => (
          <Row key={p.id} title={p.title} subtitle={`${faLongDate(new Date(p.startDate))} تا ${faLongDate(new Date(p.endDate))}`}
            leftIcon={<Trash2 size={15} />} leftColor={BRAND.crimson}
            onClick={() => setFiscalPeriods((prev) => prev.filter((x) => x.id !== p.id))} chevron={null} />
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Bank SMS quick-add (پیامک بانکی)
--------------------------------------------------------- */
function BankSmsManager({ openWithPrefill, onBack, categories, accounts, addTransaction }) {
  const st = useStyles();
  const t = useT();
  const [text, setText] = useState("");
  const parsed = text.trim() ? parseBankSms(text) : null;
  const isNative = typeof Capacitor !== "undefined" && Capacitor.isNativePlatform && Capacitor.isNativePlatform();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [suggestions, setSuggestions] = useState([]); // [{ id, body, date, parsed }]
  const [confirmedIds, setConfirmedIds] = useState([]);
  const defaultAccountId = accounts[0]?.id;

  async function syncFromPhone() {
    setSyncing(true);
    setSyncError("");
    try {
      const mod = await import("capacitor-sms-inbox");
      const plugin = mod.SMSInboxReader || mod.SmsInboxReader || mod.SMSInbox || mod.SmsInbox || mod.default;
      if (!plugin) throw new Error("پلاگین پیامک در این نسخه پیدا نشد");
      let perm = await plugin.checkPermissions();
      if (perm.sms !== "granted") perm = await plugin.requestPermissions();
      if (perm.sms !== "granted") { setSyncError("اجازه‌ی دسترسی به پیامک‌ها داده نشد."); setSyncing(false); return; }
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const { smsList } = await plugin.getSMSList({ filter: { minDate: thirtyDaysAgo, maxCount: 100 } });
      const candidates = (smsList || [])
        .map((m) => ({ id: String(m.id), body: m.body || "", date: m.date, parsed: parseBankSms(m.body || "") }))
        .filter((m) => m.parsed.amount && /بانک|کارت|حساب|واریز|برداشت|خرید|پرداخت|انتقال/.test(m.body));
      setSuggestions(candidates);
      if (candidates.length === 0) setSyncError("پیامک بانکی جدیدی پیدا نشد (یا همه قبلاً بررسی شده‌اند).");
    } catch (e) {
      setSyncError("خواندن پیامک‌ها ممکن نشد. این قابلیت فقط در اپلیکیشن نصب‌شده (APK) کار می‌کند، نه در مرورگر.");
    }
    setSyncing(false);
  }

  function confirmSuggestion(s) {
    if (!defaultAccountId) { alert("اول یک حساب بانکی بساز."); return; }
    const catMatch = categories.find((c) => c.name === s.parsed.categoryHint && c.kind === s.parsed.type);
    addTransaction({
      type: s.parsed.type, amount: s.parsed.amount, categoryId: catMatch?.id || "",
      accountId: defaultAccountId, date: new Date(s.date).toISOString().slice(0, 10),
      note: s.body.slice(0, 140), tags: ["پیامک بانکی"],
    });
    setConfirmedIds((p) => [...p, s.id]);
  }

  return (
    <div>
      <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
          <BellRing size={16} color={BRAND.header} /> همگام‌سازی خودکار از پیامک‌های گوشی
        </div>
        {!isNative && (
          <div style={{ fontSize: 12, color: "#8a8194", marginBottom: 10 }}>
            این بخش فقط داخل اپلیکیشن نصب‌شده (APK) روی گوشی کار می‌کند، چون به مجوز خواندن پیامک نیاز داره — الان داری از پیش‌نمایش مرورگر استفاده می‌کنی.
          </div>
        )}
        <button onClick={syncFromPhone} disabled={syncing} style={{ ...st.primaryBtn, opacity: syncing ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <RefreshCw size={16} /> {syncing ? "در حال بررسی پیامک‌ها..." : "بررسی پیامک‌های بانکی گوشی"}
        </button>
        {syncError && <div style={{ fontSize: 12, color: BRAND.crimson, marginTop: 8 }}>{syncError}</div>}
      </div>

      {suggestions.length > 0 && (
        <>
          <SectionTitle text={`${toFaInt(suggestions.filter((s) => !confirmedIds.includes(s.id)).length)} تراکنش پیشنهادی از پیامک`} />
          <div style={{ ...st.card, padding: "4px 12px", marginBottom: 16 }}>
            {suggestions.map((s) => {
              const done = confirmedIds.includes(s.id);
              return (
                <div key={s.id} style={{ padding: "10px 4px", borderBottom: `1px solid ${t.border}`, opacity: done ? 0.45 : 1 }}>
                  <div style={{ fontSize: 12.5, marginBottom: 4 }}>{s.body.slice(0, 90)}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: s.parsed.type === "income" ? BRAND.darkgreen : BRAND.crimson }}>
                      {toFaInt(s.parsed.amount)} ریال — {s.parsed.type === "income" ? "دریافت" : "پرداخت"}
                    </span>
                    {!done ? (
                      <button onClick={() => confirmSuggestion(s)} style={{ background: BRAND.green, color: "#fff", border: "none", borderRadius: 8, padding: "5px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>ثبت کن</button>
                    ) : (
                      <span style={{ fontSize: 11.5, color: BRAND.darkgreen, fontWeight: 700 }}>✓ ثبت شد</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <SectionTitle text="یا متن پیامک را دستی بچسبان" />
      <div style={{ ...st.card, padding: 14 }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="مثلا: از حساب شما مبلغ 250,000 ریال بابت خرید کسر شد..." rows={4}
          style={{ ...st.input, resize: "vertical", fontFamily: "inherit" }} />
        {parsed && (
          <div style={{ fontSize: 12.5, marginBottom: 10, color: "#8a8194" }}>
            تشخیص داده شده: {parsed.amount ? `${toFaInt(parsed.amount)} ریال` : "مبلغی یافت نشد"} — نوع: {parsed.type === "income" ? "دریافت" : "پرداخت"}
          </div>
        )}
        <button
          disabled={!parsed || !parsed.amount}
          onClick={() => { openWithPrefill({ amount: parsed.amount, type: parsed.type, note: parsed.note, categoryHint: parsed.categoryHint }); onBack(); }}
          style={{ ...st.primaryBtn, opacity: parsed && parsed.amount ? 1 : 0.5 }}>
          ادامه و تکمیل ثبت تراکنش
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Calendar View
--------------------------------------------------------- */
/* ---------------------------------------------------------
   Jalali date picker — replaces native <input type="date">,
   which always shows the Gregorian calendar regardless of the
   phone's language. This renders a Persian-calendar popup instead.
--------------------------------------------------------- */
function JalaliDateInput({ value, onChange, style }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const d = value ? new Date(value) : new Date();
  const [viewY, setViewY] = useState(jalaliYear(d));
  const [viewM, setViewM] = useState(jalaliParts(d).m);
  const cells = useMemo(() => getJalaliMonthCells(viewY, viewM), [viewY, viewM]);
  function prevMonth() { if (viewM === 1) { setViewM(12); setViewY((y) => y - 1); } else setViewM((m) => m - 1); }
  function nextMonth() { if (viewM === 12) { setViewM(1); setViewY((y) => y + 1); } else setViewM((m) => m + 1); }
  const weekDays = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
  return (
    <div style={{ position: "relative", marginBottom: 10 }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={{ ...style, margin: 0, textAlign: "right", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>{value ? faLongDate(new Date(value)) : "انتخاب تاریخ"}</span>
        <CalendarDays size={15} />
      </button>
      {open && (
        <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", zIndex: 40, top: "100%", marginTop: 6, right: 0, background: t.card, borderRadius: 12, padding: 12, boxShadow: "0 6px 20px rgba(0,0,0,0.25)", width: 260 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <button type="button" onClick={prevMonth} style={navArrowStyle(t)}><ChevronLeft size={14} /></button>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{cells[0] ? faMonthYear(cells[0].date) : ""}</div>
            <button type="button" onClick={nextMonth} style={navArrowStyle(t)}><ChevronRight size={14} /></button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
            {weekDays.map((w) => <div key={w} style={{ textAlign: "center", fontSize: 10, color: t.sub, fontWeight: 700 }}>{w}</div>)}
            {cells[0] && Array.from({ length: cells[0].weekday }).map((_, i) => <div key={"b" + i} />)}
            {cells.map((c) => {
              const iso = c.date.toISOString().slice(0, 10);
              const selected = value === iso;
              return (
                <button type="button" key={c.day} onClick={() => { onChange(iso); setOpen(false); }} style={{
                  aspectRatio: "1", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 11,
                  background: selected ? BRAND.header : "transparent", color: selected ? "#fff" : t.text
                }}>{toFaInt(c.day)}</button>
              );
            })}
          </div>
          <button type="button" onClick={() => { onChange(todayISO()); setOpen(false); }} style={{ marginTop: 8, width: "100%", background: "none", border: "none", color: BRAND.header, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>امروز</button>
        </div>
      )}
    </div>
  );
}

function CalendarViewSub({ transactions, catById }) {
  const t = useT();
  const now = new Date();
  const [jy, setJy] = useState(jalaliYear(now));
  const [jm, setJm] = useState(jalaliParts(now).m);
  const [selDay, setSelDay] = useState(null);
  const cells = useMemo(() => getJalaliMonthCells(jy, jm), [jy, jm]);
  const dayTx = (d) => transactions.filter((tx) => tx.date === d.date.toISOString().slice(0, 10));
  function prevMonth() { if (jm === 1) { setJm(12); setJy((y) => y - 1); } else setJm((m) => m - 1); setSelDay(null); }
  function nextMonth() { if (jm === 12) { setJm(1); setJy((y) => y + 1); } else setJm((m) => m + 1); setSelDay(null); }
  const weekDays = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 16 }}>
        <button onClick={prevMonth} style={navArrowStyle(t)}><ChevronLeft size={16} /></button>
        <div style={{ fontWeight: 700 }}>{cells[0] ? faMonthYear(cells[0].date) : ""}</div>
        <button onClick={nextMonth} style={navArrowStyle(t)}><ChevronRight size={16} /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 8 }}>
        {weekDays.map((w) => <div key={w} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: t.sub }}>{w}</div>)}
        {cells[0] && Array.from({ length: cells[0].weekday }).map((_, i) => <div key={"b" + i} />)}
        {cells.map((c) => {
          const txs = dayTx(c);
          const isSel = selDay && selDay.day === c.day;
          return (
            <button key={c.day} onClick={() => setSelDay(c)} style={{
              aspectRatio: "1", borderRadius: 9, border: "none", cursor: "pointer",
              background: isSel ? BRAND.header : t.card, color: isSel ? "#fff" : t.text,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative", fontSize: 13, fontWeight: 600
            }}>
              {toFaInt(c.day)}
              {txs.length > 0 && <span style={{ width: 5, height: 5, borderRadius: "50%", background: isSel ? "#fff" : BRAND.crimson, position: "absolute", bottom: 5 }} />}
            </button>
          );
        })}
      </div>
      {selDay && (
        <div style={{ marginTop: 16 }}>
          <SectionTitle text={faLongDate(selDay.date)} />
          {dayTx(selDay).length === 0 && <EmptyRow text="تراکنشی در این روز نیست" />}
          {dayTx(selDay).map((tx) => (
            <Row key={tx.id} title={catById(tx.categoryId)?.name || (tx.type === "transfer" ? "انتقال" : "—")} value={`${toFaInt(tx.amount)} ریال`}
              valueColor={tx.type === "expense" ? BRAND.crimson : tx.type === "income" ? BRAND.darkgreen : BRAND.violet} chevron={null} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   Settings View
--------------------------------------------------------- */
function SettingsView({ settings, setSettings, exportBackup, importBackup, rebuildData, clearAllData }) {
  const st = useStyles();
  const t = useT();
  const fileRef = useRef();
  const [pinInput, setPinInput] = useState("");
  const [profile, setProfile] = useState(settings.profile || { name: "", phone: "", email: "" });
  return (
    <div>
      <SectionTitle text="اطلاعات کاربری" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <input placeholder="نام و نام خانوادگی" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} style={st.input} />
        <input placeholder="شماره تماس" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} style={st.input} />
        <input placeholder="ایمیل (اختیاری)" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} style={st.input} />
        <button onClick={() => setSettings((s) => ({ ...s, profile }))} style={st.primaryBtn}>ذخیره اطلاعات کاربری</button>
      </div>

      <SectionTitle text="رنگ‌بندی برنامه" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {Object.entries(COLOR_PRESETS).map(([key, p]) => (
            <button key={key} onClick={() => setSettings((s) => ({ ...s, themeColor: key }))}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer" }}>
              <span style={{
                width: 42, height: 42, borderRadius: "50%", background: p.header,
                border: settings.themeColor === key ? `3px solid ${p.fab}` : "3px solid transparent",
                boxShadow: settings.themeColor === key ? "0 0 0 2px #fff, 0 0 0 3px " + p.header : "none",
                display: "flex", alignItems: "center", justifyContent: "center"
              }}>
                {settings.themeColor === key && <Check size={18} color="#fff" />}
              </span>
              <span style={{ fontSize: 10.5, color: t.text }}>{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      <SectionTitle text="ظاهر برنامه" />
      <div style={{ ...st.card, padding: "4px 12px", marginBottom: 18 }}>
        <Row title="تم روشن / تاریک" leftIcon={settings.theme === "dark" ? <Moon size={16} /> : <Sun size={16} />} leftColor={BRAND.header}
          extra={<button onClick={() => setSettings((s) => ({ ...s, theme: s.theme === "dark" ? "light" : "dark" }))} style={{ background: BRAND.green, color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{settings.theme === "dark" ? "روشن کن" : "تاریک کن"}</button>}
          chevron={null} />
      </div>

      <SectionTitle text="اندازه فونت" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {[{ v: 0.9, l: "کوچک" }, { v: 1, l: "معمولی" }, { v: 1.15, l: "بزرگ" }, { v: 1.3, l: "خیلی بزرگ" }].map((o) => (
            <button key={o.v} onClick={() => setSettings((s) => ({ ...s, fontScale: o.v }))} style={pillStyle(settings.fontScale === o.v)}>{o.l}</button>
          ))}
        </div>
      </div>

      <SectionTitle text="تقویم و واحد پول" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: "#8a8194", marginBottom: 8 }}>تقویم</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button onClick={() => setSettings((s) => ({ ...s, calendarMode: "jalali" }))} style={pillStyle(settings.calendarMode !== "gregorian")}>شمسی</button>
          <button onClick={() => setSettings((s) => ({ ...s, calendarMode: "gregorian" }))} style={pillStyle(settings.calendarMode === "gregorian")}>میلادی</button>
        </div>
        <div style={{ fontSize: 11.5, color: "#8a8194", marginBottom: 14 }}>در این نسخه فقط قالب تاریخ تغییر می‌کند؛ متن رابط کاربری همچنان فارسی می‌ماند.</div>
        <div style={{ fontSize: 12, color: "#8a8194", marginBottom: 8 }}>واحد نمایش پول</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button onClick={() => setSettings((s) => ({ ...s, currency: "rial" }))} style={pillStyle(settings.currency === "rial")}>ریال</button>
          <button onClick={() => setSettings((s) => ({ ...s, currency: "toman" }))} style={pillStyle(settings.currency === "toman")}>تومان</button>
          <button onClick={() => setSettings((s) => ({ ...s, currency: "usd" }))} style={pillStyle(settings.currency === "usd")}>دلار</button>
        </div>
        {settings.currency === "usd" && (
          <>
            <div style={{ fontSize: 11.5, color: "#8a8194", marginBottom: 8 }}>اگر نرخ آنلاین در دسترس نبود، نرخ هر دلار به ریال را خودتان وارد کنید:</div>
            <AmountInput placeholder="مثلا 600000" value={settings.manualUsdRate} onChange={(v) => setSettings((s) => ({ ...s, manualUsdRate: v }))} style={st.input} />
          </>
        )}
      </div>

      <SectionTitle text="یادآوری‌ها و اعلان‌ها" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <label style={st.label}>هشدار سررسید چک چند روز قبل؟</label>
        <KeypadInput kind="digits" digitsMax={3} value={settings.checkReminderDays} onChange={(e) => setSettings((s) => ({ ...s, checkReminderDays: Number(e.target.value.replace(/[^0-9]/g, "") || 0) }))} style={st.input} inputMode="numeric" />
        <Row title="اعلان سررسید چک، قبض، قسط و یادآوری‌ها" leftIcon={<BellRing size={16} />} leftColor={BRAND.orange}
          extra={<button onClick={async () => {
            const next = settings.dueNotif === false;
            if (next && Capacitor.isNativePlatform()) {
              try {
                let p = await LocalNotifications.checkPermissions();
                if (p.display !== "granted") p = await LocalNotifications.requestPermissions();
                if (p.display !== "granted") { alert("اجازه‌ی اعلان داده نشد. از تنظیمات گوشی > برنامه‌ها > Rexa > اعلان‌ها آن را فعال کنید."); return; }
              } catch {}
            }
            setSettings((s) => ({ ...s, dueNotif: next }));
          }} style={{ background: settings.dueNotif !== false ? BRAND.green : "#aaa", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{settings.dueNotif !== false ? "فعال" : "غیرفعال"}</button>}
          chevron={null} />
        <Row title="اعلان تشخیص پیامک بانکی" leftIcon={<Bell size={16} />} leftColor={BRAND.orange}
          extra={<button onClick={() => setSettings((s) => ({ ...s, smsNotif: !s.smsNotif }))} style={{ background: settings.smsNotif ? BRAND.green : "#aaa", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{settings.smsNotif ? "فعال" : "غیرفعال"}</button>}
          chevron={null} />
        <button onClick={async () => {
          try {
            const mod = await import("capacitor-sms-inbox");
            const plugin = mod.SMSInboxReader || mod.SmsInboxReader || mod.SMSInbox || mod.SmsInbox || mod.default;
            const result = await plugin?.requestPermissions?.();
            if (result?.sms === "granted") { setSettings((s) => ({ ...s, smsAutoRead: true })); alert("مجوز خواندن پیامک فعال شد."); }
            else alert("مجوز خواندن پیامک داده نشد.");
          } catch { alert("این قابلیت فقط در APK اندروید در دسترس است."); }
        }} style={{ ...st.primaryBtn, background: BRAND.header, marginTop: 10 }}>فعال‌سازی دسترسی پیامک گوشی</button>
        <div style={{ fontSize: 11.5, color: "#8a8194", marginTop: 6 }}>Rexa برای خواندن پیامک‌های بانکی به مجوز Android نیاز دارد. این دسترسی برای APK مستقیم قابل استفاده است؛ انتشار در Google Play تابع سیاست‌های SMS آن فروشگاه است.</div>
      </div>

      <SectionTitle text="امنیت" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <div style={{ fontSize: 12.5, color: "#8a8194", marginBottom: 10 }}>اول یک رمز عددی تنظیم کن؛ اثر انگشت به‌عنوان راه سریع‌تر بازکردن، علاوه بر رمز عددی کار می‌کند (رمز عددی همیشه به‌عنوان جایگزین در دسترس می‌ماند).</div>
        <KeypadInput kind="digits" digitsMax={6} placeholder="رمز عددی جدید (خالی = بدون قفل)" value={pinInput} onChange={(e) => setPinInput(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))} style={st.input} inputMode="numeric" />
        <button onClick={async () => {
          if (pinInput && pinInput.length < 4) { alert("رمز عددی باید حداقل ۴ رقم باشد."); return; }
          if (!pinInput) { setSettings((s) => ({ ...s, pin: "", pinHash: "", pinSalt: "" })); clearPinLock(); return; }
          const rec = await makePinRecord(pinInput);
          setSettings((s) => ({ ...s, pin: "", ...rec }));
          clearPinLock(); setPinInput("");
          alert("رمز عددی تنظیم شد.");
        }} style={{ ...st.primaryBtn, marginBottom: 14 }}>{pinInput ? "تنظیم رمز" : "حذف رمز"}</button>
        <Row title="باز کردن با اثر انگشت" leftIcon={<Fingerprint size={16} />} leftColor={BRAND.violet}
          extra={<button onClick={() => {
            if (!settings.biometricEnabled && !(settings.pinHash || settings.pin)) { alert("ابتدا یک رمز عددی تنظیم کنید تا قفل امن Rexa فعال شود."); return; }
            setSettings((s) => ({ ...s, biometricEnabled: !s.biometricEnabled }));
          }} style={{ background: settings.biometricEnabled ? BRAND.green : "#aaa", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{settings.biometricEnabled ? "فعال" : "غیرفعال"}</button>}
          chevron={null} />
        <div style={{ fontSize: 11, color: "#8a8194", marginTop: 6 }}>این گزینه از اثر انگشت یا Face ID واقعی گوشی استفاده می‌کند و فقط وقتی برنامه به‌صورت APK نصب شده باشد کار می‌کند (نه در پیش‌نمایش وب).</div>
      </div>

      <SectionTitle text="حساب مشترک خانوادگی" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <div style={{ fontSize: 12.5, color: "#8a8194", marginBottom: 10 }}>
          با روشن‌کردن این گزینه، اطلاعات مالی (حساب‌ها، تراکنش‌ها، بودجه و...) به‌صورت مشترک ذخیره می‌شود و هر کسی که به همین برنامه دسترسی داشته باشد آن را می‌بیند. این حالت جایگزین ورود واقعی چند کاربره نیست، صرفاً یک دفتر مشترک است.
        </div>
        <Row title="فعال‌سازی حساب مشترک" leftIcon={<Users size={16} />} leftColor={BRAND.violet}
          extra={<button onClick={() => setSettings((s) => ({ ...s, sharedFamily: !s.sharedFamily }))} style={{ background: settings.sharedFamily ? BRAND.crimson : BRAND.green, color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{settings.sharedFamily ? "غیرفعال کن" : "فعال کن"}</button>}
          chevron={null} />
      </div>

      <SectionTitle text="پشتیبان‌گیری و بازیابی" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <button onClick={exportBackup} style={{ ...st.primaryBtn, background: BRAND.header, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 10 }}><Download size={16} /> دریافت فایل پشتیبان</button>
        <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => e.target.files[0] && importBackup(e.target.files[0])} />
        <button onClick={() => fileRef.current.click()} style={{ ...st.primaryBtn, background: BRAND.gold, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Upload size={16} /> بازیابی از فایل پشتیبان</button>
      </div>

      <SectionTitle text="نگهداری و تعمیر اطلاعات" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18 }}>
        <button onClick={rebuildData} style={{ ...st.primaryBtn, background: BRAND.violet, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 10 }}><RotateCcw size={16} /> بازسازی اطلاعات</button>
        <button onClick={clearAllData} style={{ ...st.primaryBtn, background: BRAND.crimson, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Eraser size={16} /> خام کردن اطلاعات</button>
        <div style={{ fontSize: 11.5, color: "#8a8194", marginTop: 9, lineHeight: 1.8 }}>قبل از هر دو عملیات پشتیبان تهیه می‌شود. «خام کردن» اطلاعات مالی این دستگاه را پاک و حساب‌های پایه را دوباره ایجاد می‌کند.</div>
      </div>

      <SectionTitle text="درباره همگام‌سازی با Google Drive" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18, fontSize: 12.5, color: "#8a8194" }}>
        اتصال مستقیم به Google Drive نیازمند ورود واقعی به حساب گوگل است که در این محیط در دسترس نیست. برای انتقال اطلاعات بین دستگاه‌ها از «دریافت فایل پشتیبان» استفاده کنید و همان فایل را در Drive خودتان نگه دارید یا در دستگاه دیگر «بازیابی» کنید.
      </div>

      <SectionTitle text="شخصی‌سازی نمای صفحه اول" />
      <div style={{ ...st.card, padding: "8px 12px", marginBottom: 18 }}>
        <div style={{ fontSize: 11.5, color: "#8a8194", padding: "6px 4px 10px" }}>هر بخش را می‌توانید نمایش/مخفی کنید یا با فلش‌ها ترتیبش را عوض کنید.</div>
        {normalizeHomeSections(settings.homeSections).map((sec, i, arr) => {
          const meta = HOME_SECTION_LABELS[sec.key] || sec.key;
          function move(dir) {
            const idx = i + dir;
            if (idx < 0 || idx >= arr.length) return;
            const copy = [...arr];
            [copy[i], copy[idx]] = [copy[idx], copy[i]];
            setSettings((s) => ({ ...s, homeSections: copy }));
          }
          return (
            <div key={sec.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 4px", borderBottom: "1px solid #f0eef3" }}>
              <span style={{ fontSize: 13, fontWeight: 600, opacity: sec.visible ? 1 : 0.4 }}>{meta}</span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button onClick={() => move(-1)} style={miniBtn}><ArrowUp size={13} /></button>
                <button onClick={() => move(1)} style={miniBtn}><ArrowDown size={13} /></button>
                <button onClick={() => setSettings((s) => ({ ...s, homeSections: arr.map((x) => x.key === sec.key ? { ...x, visible: !x.visible } : x) }))}
                  style={{ ...miniBtn, background: sec.visible ? BRAND.green : "#aaa", color: "#fff" }}>
                  {sec.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <SectionTitle text="آموزش" />
      <div style={{ ...st.card, padding: 14, marginBottom: 18, fontSize: 13, lineHeight: 2, color: t.text }}>
        <div>• برای ثبت سریع تراکنش، دکمه‌ی سبز + پایین صفحه را بزن.</div>
        <div>• سه‌بار پشت‌سرهم روی هر جای صفحه بزن تا کادر «ثبت سریع» باز شود؛ هرچی تایپ کنی خودش تشخیص می‌ده هزینه بوده یا درآمد.</div>
        <div>• آیکون میکروفون بالای صفحه برای ثبت با صدا است (اگر گوشی‌ات پشتیبانی کند).</div>
        <div>• روی کارت‌های بانکی بالای صفحه چپ‌وراست بکش تا همه‌ی حساب‌هایت را ببینی.</div>
        <div>• از «شخصی‌سازی نمای صفحه اول» بالاتر همین صفحه، می‌توانی ترتیب و نمایش بخش‌های خانه را عوض کنی.</div>
      </div>

      <SectionTitle text="ارسال برنامه به دیگران" />
      <div style={{ ...st.card, padding: 14 }}>
        <button
          onClick={async () => {
            const text = "برنامه حسابداری Rexa رو امتحان کن!";
            if (navigator.share) { try { await navigator.share({ title: "Rexa", text }); } catch {} }
            else { try { await navigator.clipboard.writeText(text); alert("متن معرفی کپی شد."); } catch { alert(text); } }
          }}
          style={{ ...st.primaryBtn, background: BRAND.violet, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Users size={16} /> اشتراک‌گذاری برنامه
        </button>
      </div>
    </div>
  );
}
const miniBtn = { width: 26, height: 26, borderRadius: 7, border: "none", background: "#eee", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
const HOME_SECTION_LABELS = {
  shortcut: "میانبر تراکنش‌ها", operations: "عملیات", expense: "هزینه‌ها", income: "درآمدها", banks: "بانک‌ها و کارت‌ها",
  funds: "صندوق‌ها", balrep: "گزارش مانده حساب‌ها", budget: "بودجه‌بندی", loanchk: "وام‌ها و چک‌ها", contacts: "اشخاص و بدهی‌ها", bills: "یادآوری قبض‌ها",
};

/* ---------------------------------------------------------
   Add Transaction Sheet
--------------------------------------------------------- */
/* ---------------------------------------------------------
   Quick-add action sheet (opened from the center + button)
--------------------------------------------------------- */
function QuickAddSheet({ onClose, onPick }) {
  const st = useStyles();
  const options = [
    { key: "expense", label: "ثبت هزینه", icon: <TrendingDown size={20} />, color: BRAND.crimson },
    { key: "income", label: "ثبت درآمد", icon: <TrendingUp size={20} />, color: BRAND.darkgreen },
    { key: "transfer", label: "انتقال بین حساب‌ها", icon: <ArrowLeftRight size={20} />, color: BRAND.violet },
    { key: "check", label: "ثبت چک", icon: <FileSpreadsheet size={20} />, color: BRAND.gold },
  ];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end", zIndex: 400, maxWidth: 480, margin: "0 auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: "100%", borderRadius: "18px 18px 0 0", padding: "20px 18px calc(env(safe-area-inset-bottom, 0px) + 20px)" }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, textAlign: "center" }}>چی می‌خوای ثبت کنی؟</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          {options.map((o) => (
            <button key={o.key} onClick={() => onPick(o.key)} style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "18px 8px",
              borderRadius: 14, border: "none", background: "#f7f5fa", cursor: "pointer"
            }}>
              <span style={{ width: 44, height: 44, borderRadius: 12, background: o.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>{o.icon}</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#241a30" }}>{o.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Simple text modal (used for the quick "یادداشت" note capture)
--------------------------------------------------------- */
function SimpleTextModal({ title, placeholder, onClose, onSubmit }) {
  const st = useStyles();
  const [text, setText] = useState("");
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end", zIndex: 400, maxWidth: 480, margin: "0 auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: "100%", borderRadius: "18px 18px 0 0", padding: "20px 18px calc(env(safe-area-inset-bottom, 0px) + 20px)" }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{title}</div>
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} rows={4}
          style={{ ...st.input, resize: "vertical", fontFamily: "inherit" }} />
        <button disabled={!text.trim()} onClick={() => onSubmit(text.trim())} style={{ ...st.primaryBtn, opacity: text.trim() ? 1 : 0.5 }}>ذخیره</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Reminder quick modal
--------------------------------------------------------- */
function ReminderQuickModal({ onClose, onSubmit, initial = null }) {
  const st = useStyles();
  const [text, setText] = useState(initial?.text || "");
  const [date, setDate] = useState(initial?.date || todayISO());
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end", zIndex: 400, maxWidth: 480, margin: "0 auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: "100%", borderRadius: "18px 18px 0 0", padding: "20px 18px calc(env(safe-area-inset-bottom, 0px) + 20px)" }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>یادآوری جدید</div>
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="مثلا: تماس با بانک" style={st.input} />
        <label style={st.label}>تاریخ</label>
        <JalaliDateInput value={date} onChange={(v) => setDate(v)} style={st.input} />
        <button disabled={!text.trim()} onClick={() => onSubmit({ text: text.trim(), date, done: false })} style={{ ...st.primaryBtn, opacity: text.trim() ? 1 : 0.5 }}>ذخیره یادآوری</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Smart capture overlay — opened by triple-tap anywhere on the
   screen. Semi-transparent so the page behind stays visible.
   Text is parsed locally (same engine as the SMS/voice parser).
--------------------------------------------------------- */
function SmartCaptureOverlay({ onClose, onParsed }) {
  const st = useStyles();
  const [text, setText] = useState("");
  const parsed = text.trim() ? parseBankSms(text) : null;
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(20,10,30,0.4)", backdropFilter: "blur(2px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 90
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "88%", maxWidth: 380, background: "rgba(255,255,255,0.92)", borderRadius: 18, padding: 18,
        boxShadow: "0 8px 30px rgba(0,0,0,0.3)"
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 14, color: BRAND.header }}>
            <Sparkles size={17} /> ثبت سریع
          </div>
          <VoiceCaptureButton dark onResult={(t) => setText((prev) => (prev ? prev + " " : "") + t)} />
        </div>
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3}
          placeholder="بنویس یا میکروفن رو بزن و بگو چی خرج شد یا چی دریافت کردی..." style={{ ...st.input, resize: "vertical", fontFamily: "inherit", background: "rgba(255,255,255,0.7)" }} />
        {parsed && (
          <div style={{ fontSize: 12, color: "#6a6275", marginBottom: 10 }}>
            تشخیص: {parsed.amount ? `${toFaInt(parsed.amount)} ریال` : "مبلغی پیدا نشد"} — {parsed.type === "income" ? "دریافت" : "پرداخت"}{parsed.categoryHint ? ` — ${parsed.categoryHint}` : ""}
          </div>
        )}
        <button disabled={!parsed?.amount} onClick={() => onParsed(parsed)} style={{ ...st.primaryBtn, opacity: parsed?.amount ? 1 : 0.5 }}>ادامه ثبت</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   حساب‌ها: درخت حساب‌ها (هزینه‌ها، درآمدها، صندوق‌ها، بانک‌ها، اشخاص، بدهکاران،
   بستانکاران، دارائی‌ها، بدهی‌ها، سرمایه) همراه با جستجو.
   هم به‌عنوان صفحه‌ی مدیریت استفاده می‌شود و هم به‌عنوان انتخاب‌گر در ثبت تراکنش.
--------------------------------------------------------- */
const ACCOUNT_GROUPS = [
  { kind: "expense", label: "هزینه‌ها" }, { kind: "income", label: "درآمدها" },
  { kind: "fund", label: "صندوق‌ها" }, { kind: "bank", label: "بانک‌ها" },
  { kind: "person", label: "اشخاص" }, { kind: "receivable", label: "بدهکاران" },
  { kind: "payable", label: "بستانکاران" }, { kind: "asset", label: "دارائی‌ها" },
  { kind: "liability", label: "بدهی‌ها" }, { kind: "capital", label: "سرمایه" },
];
const DEBT_GROUPS = ["receivable", "payable"]; // حساب «دو طرفه» در هر دو گروه بدهکاران و بستانکاران دیده می‌شود
const faKey = (x = "") => String(x).replace(/ي/g, "ی").replace(/ك/g, "ک").toLowerCase().trim();
function accountPath(categories, c) {
  const names = [c.name]; let p = c; let guard = 0;
  while (p?.parentId && guard++ < 8) { p = categories.find((x) => x.id === p.parentId); if (p) names.unshift(p.name); }
  return [ACCOUNT_GROUPS.find((g) => g.kind === c.kind)?.label || "سایر", ...names];
}
function AccountsTree({ categories = [], transactions = [], addCategory, deleteCategory, updateCategory, favorites, toggleFavorite, mode = "manage", value, onPick, selectable, onBlocked, defaultExpanded }) {
  const st = useStyles();
  const t = useT();
  const picking = mode === "pick";
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(defaultExpanded || {});
  const [addFor, setAddFor] = useState(null);
  const [addName, setAddName] = useState("");
  const [editId, setEditId] = useState(null);
  const [editVal, setEditVal] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newKind, setNewKind] = useState("expense");
  const [newName, setNewName] = useState("");
  const [newTwoWay, setNewTwoWay] = useState(false);
  const [editTwoWay, setEditTwoWay] = useState(false);
  const favIds = favorites?.categories || [];
  const q = faKey(query);

  const hasParent = (c) => c.parentId && categories.some((x) => x.id === c.parentId);
  const childrenOf = (id) => categories.filter((c) => c.parentId === id);
  const rootsOf = (kind) => categories.filter((c) => !hasParent(c) && (c.kind === kind || (c.twoWay && DEBT_GROUPS.includes(kind))));
  // جمع بدهکار / بستانکار یک حساب دو طرفه (به‌همراه زیرمجموعه‌هایش)
  const twoWayTotals = (c) => {
    const ids = new Set([c.id, ...categories.filter((x) => x.parentId === c.id).map((x) => x.id)]);
    let debit = 0, credit = 0;
    transactions.forEach((tx) => {
      if (!ids.has(tx.categoryId)) return;
      const side = tx.side || (tx.type === "income" ? "creditor" : "debtor");
      if (side === "creditor") credit += Number(tx.amount || 0); else debit += Number(tx.amount || 0);
    });
    return { debit, credit };
  };
  const toggle = (k) => setExpanded((e) => ({ ...e, [k]: !e[k] }));

  function create(kind, parentId, name, twoWay = false) {
    const nm = String(name || "").trim(); if (!nm) return;
    const id = uid();
    addCategory?.({ id, name: nm, kind, ...(parentId ? { parentId } : {}), ...(twoWay ? { twoWay: true } : {}) });
    setExpanded((e) => ({ ...e, [parentId || `g:${kind}`]: true }));
    if (picking) onPick?.(id);
  }
  function renderAddForm(kind, parentId, depth) {
    return (
      <div style={{ display: "flex", gap: 6, padding: "8px 4px", paddingRight: 4 + depth * 18 }}>
        <input autoFocus value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="نام مورد جدید" style={{ ...st.input, margin: 0, flex: 1 }} />
        <button onClick={() => { const nm = addName; setAddName(""); setAddFor(null); create(kind, parentId, nm); }} style={{ ...st.primaryBtn, width: "auto", padding: "0 16px" }}>افزودن</button>
      </div>
    );
  }
  const smallBtn = (color) => ({ background: "none", border: "none", color, cursor: "pointer", padding: 3, display: "flex" });
  const arrowIcon = (open, color) => <ChevronLeft size={19} color={color || t.sub} style={{ transform: open ? "rotate(-90deg)" : "none", transition: "transform .15s", flexShrink: 0 }} />;

  function renderNode(c, depth, flat) {
    const kids = flat ? [] : childrenOf(c.id);
    const isOpen = !!expanded[c.id];
    const selected = picking && c.id === value;
    const locked = !!(picking && selectable && !selectable(c));   // نمایش داده می‌شود ولی قابل انتخاب نیست
    const path = flat ? accountPath(categories, c).slice(0, -1).join(" / ") : "";
    return (
      <div key={c.id}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "9px 4px", paddingRight: 4 + depth * 18, borderBottom: `1px solid ${t.border}`, background: selected ? "rgba(88,39,119,.08)" : "transparent", opacity: locked ? 0.42 : 1 }}>
          {editId === c.id ? (<>
            <input autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value)} style={{ flex: 1, padding: "6px 10px", borderRadius: 7, border: `1.5px solid ${t.inputBorder}`, background: t.input, color: t.text, fontSize: 13 }} />
            <button onClick={() => { if (editVal.trim()) updateCategory?.(c.id, { name: editVal.trim(), ...(depth === 0 ? { twoWay: editTwoWay } : {}) }); setEditId(null); }} style={{ background: BRAND.green, border: "none", borderRadius: 7, color: "#fff", padding: "6px 10px", cursor: "pointer" }}><Check size={14} /></button>
            <button onClick={() => setEditId(null)} style={smallBtn(t.sub)}><X size={14} /></button>
          </>) : (<>
            <div onClick={picking ? (locked ? () => { if (kids.length) toggle(c.id); else onBlocked?.(c); } : () => onPick?.(c.id)) : kids.length ? () => toggle(c.id) : undefined} style={{ flex: 1, minWidth: 0, cursor: picking || kids.length ? "pointer" : "default" }}>
              <div style={{ fontSize: depth ? 13 : 14, fontWeight: selected ? 800 : depth ? 500 : 600, color: t.text }}>{depth > 0 && "↳ "}{c.name}{c.twoWay && <span style={{ marginRight: 6, fontSize: 10.5, fontWeight: 700, color: BRAND.violet, background: "rgba(88,39,119,.10)", borderRadius: 10, padding: "1px 7px" }}>↔ دو طرفه</span>}</div>
              {c.twoWay && !picking && !flat && (() => { const tt = twoWayTotals(c); return (tt.debit || tt.credit) ? <div style={{ fontSize: 11, color: t.sub, marginTop: 2 }}>بدهکار: {toFaInt(tt.debit)} · بستانکار: {toFaInt(tt.credit)} · مانده: {toFaInt(Math.abs(tt.debit - tt.credit))} {tt.debit >= tt.credit ? "بدهکار" : "بستانکار"}</div> : null; })()}
              {flat && path && <div style={{ fontSize: 11, color: t.sub, marginTop: 2 }}>{path}</div>}
            </div>
            {selected && <Check size={16} color={BRAND.darkgreen} />}
            {!picking && toggleFavorite && <button onClick={() => toggleFavorite("categories", c.id)} style={smallBtn("#f5b301")}><Star size={15} fill={favIds.includes(c.id) ? "#f5b301" : "none"} color="#f5b301" /></button>}
            {!picking && <button onClick={() => { setEditId(c.id); setEditVal(c.name); setEditTwoWay(!!c.twoWay); }} style={smallBtn(BRAND.violet)}><Pencil size={15} /></button>}
            {!selectable && <button onClick={() => { setAddFor(addFor?.parentId === c.id ? null : { kind: c.kind, parentId: c.id }); setAddName(""); setExpanded((e) => ({ ...e, [c.id]: true })); }} style={smallBtn(BRAND.green)}><Plus size={15} /></button>}
            {!picking && <button onClick={() => { if (window.confirm(`«${c.name}»${childrenOf(c.id).length ? " و زیرمجموعه‌هایش" : ""} حذف شود؟`)) deleteCategory?.(c.id); }} style={smallBtn(BRAND.crimson)}><Trash2 size={15} /></button>}
            {kids.length > 0 ? <button onClick={() => toggle(c.id)} style={smallBtn(t.sub)}>{arrowIcon(isOpen)}</button> : <span style={{ width: 25, flexShrink: 0 }} />}
          </>)}
        </div>
        {editId === c.id && depth === 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px 10px", fontSize: 12.5, fontWeight: 700, color: t.text, cursor: "pointer" }}>
            <input type="checkbox" checked={editTwoWay} onChange={(e) => setEditTwoWay(e.target.checked)} style={{ width: 18, height: 18 }} />
            دو طرفه (هم بدهکار هم بستانکار — مثل بیمه)
          </label>
        )}
        {isOpen && kids.map((k) => renderNode(k, depth + 1))}
        {addFor?.parentId === c.id && renderAddForm(c.kind, c.id, depth + 1)}
      </div>
    );
  }

  function renderGroup(g) {
    const key = `g:${g.kind}`;
    const isOpen = !!expanded[key];
    const roots = rootsOf(g.kind);
    const addingHere = addFor && addFor.kind === g.kind && !addFor.parentId;
    return (
      <div key={g.kind} style={{ ...st.card, marginBottom: 10, overflow: "hidden" }}>
        <div onClick={() => toggle(key)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 12px", cursor: "pointer" }}>
          <span style={{ fontWeight: 800, fontSize: 14.5, color: t.text }}>{g.label}</span>
          {arrowIcon(isOpen, BRAND.header)}
        </div>
        {isOpen && (
          <div style={{ padding: "0 8px 8px", borderTop: `1px solid ${t.border}` }}>
            {roots.length === 0 && <EmptyRow text={`هنوز موردی در «${g.label}» ثبت نشده`} />}
            {roots.map((c) => renderNode(c, 0))}
            {addingHere && renderAddForm(g.kind, null, 0)}
            {!selectable && (<div onClick={() => { setAddFor(addingHere ? null : { kind: g.kind, parentId: null }); setAddName(""); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 4px", cursor: "pointer", color: BRAND.header, fontWeight: 700, fontSize: 13 }}>
              <span style={{ width: 24, height: 24, borderRadius: "50%", background: BRAND.header, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={14} /></span>
              مورد جدید در «{g.label}»
            </div>)}
          </div>
        )}
      </div>
    );
  }

  const results = q ? categories.filter((c) => faKey(accountPath(categories, c).join(" ")).includes(q)) : [];
  return (
    <div>
      <div style={{ position: "relative", marginBottom: 12 }}>
        <Search size={16} color={t.sub} style={{ position: "absolute", top: 13, right: 12 }} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جستجو در حساب‌ها..." style={{ ...st.input, marginBottom: 0, paddingRight: 36 }} />
      </div>
      {q ? (
        <div style={{ ...st.card, padding: "4px 8px", marginBottom: 12 }}>
          {results.length === 0 ? <EmptyRow text="موردی پیدا نشد" /> : results.map((c) => renderNode(c, 0, true))}
        </div>
      ) : ACCOUNT_GROUPS.map(renderGroup)}
      {!selectable && (<div style={{ ...st.card, padding: 12, marginTop: 4, border: `1.5px dashed ${t.inputBorder}`, boxShadow: "none" }}>
        <div onClick={() => setShowNew((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: BRAND.header, fontWeight: 800, fontSize: 13.5 }}>
          <span style={{ width: 26, height: 26, borderRadius: "50%", background: BRAND.header, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={15} /></span>
          ایجاد حساب جدید
        </div>
        {showNew && (
          <div style={{ marginTop: 12 }}>
            <select value={newKind} onChange={(e) => setNewKind(e.target.value)} style={st.input}>
              {ACCOUNT_GROUPS.map((g) => <option key={g.kind} value={g.kind}>{g.label}</option>)}
            </select>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="نام حساب" style={st.input} />
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 12.5, fontWeight: 700, color: t.text, cursor: "pointer" }}>
              <input type="checkbox" checked={newTwoWay} onChange={(e) => setNewTwoWay(e.target.checked)} style={{ width: 18, height: 18 }} />
              دو طرفه (هم بدهکار هم بستانکار — مثل بیمه)
            </label>
            <button onClick={() => { const nm = newName, tw = newTwoWay; setNewName(""); setNewTwoWay(false); setShowNew(false); create(newKind, null, nm, tw); }} style={st.primaryBtn}>افزودن</button>
          </div>
        )}
      </div>)}
    </div>
  );
}
function BankAccountField({ accounts, value, onChange, st }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const sel = accounts.find((a) => a.id === value);
  return <>
    <button type="button" onClick={() => setOpen(true)} style={{ width: "100%", minHeight: 46, marginBottom: 8, padding: "9px 12px", borderRadius: 10, border: `1.5px solid ${t.inputBorder}`, background: t.input, color: sel ? t.text : t.sub, display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "inherit", cursor: "pointer", textAlign: "right" }}>
      <span style={{ fontSize: 13.5, fontWeight: sel ? 700 : 500 }}>{sel ? sel.name : "انتخاب حساب بانکی"}</span><ChevronLeft size={17} style={{ transform: "rotate(90deg)", flexShrink: 0 }} />
    </button>
    {open && toBody(<div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 700, display: "flex", alignItems: "flex-end", justifyContent: "center", maxWidth: 480, margin: "0 auto", fontFamily: FONT, direction: "rtl" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: t.bg || t.card, width: "100%", maxHeight: "70vh", overflowY: "auto", borderRadius: "18px 18px 0 0", padding: "16px 14px calc(18px + env(safe-area-inset-bottom, 0px))" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <button type="button" onClick={() => setOpen(false)} style={{ border: 0, background: "transparent", color: t.sub, padding: 5 }}><X size={21} /></button>
          <div style={{ fontWeight: 800, fontSize: 15 }}>انتخاب حساب بانکی</div><span style={{ width: 31 }} />
        </div>
        {accounts.map((a) => {
          const on = a.id === value;
          return (
            <button key={a.id} type="button" onClick={() => { onChange(a.id); setOpen(false); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 6px", border: "none", borderBottom: `1px solid ${t.border}`, background: "transparent", cursor: "pointer", fontFamily: "inherit", color: t.text, textAlign: "right" }}>
              <span style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${on ? BRAND.header : t.sub}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{on && <span style={{ width: 10, height: 10, borderRadius: "50%", background: BRAND.header }} />}</span>
              <span style={{ flex: 1, fontSize: 14.5, fontWeight: on ? 800 : 600 }}>{a.name}</span>
              <span style={{ fontSize: 12, color: t.sub }}>{accTypeFa(a.type)}</span>
            </button>
          );
        })}
        {!accounts.length && <div style={{ color: t.sub, textAlign: "center", padding: 14 }}>حسابی تعریف نشده است</div>}
      </div>
    </div>)}
  </>;
}
function AccountPickerField({ categories, value, onChange, addCategory, st }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const selected = categories.find((c) => c.id === value);
  const display = selected ? accountPath(categories, selected).join(" / ") : "انتخاب حساب";
  return <>
    <button type="button" onClick={() => setOpen(true)} style={{ width: "100%", minHeight: 46, marginBottom: 8, padding: "9px 12px", borderRadius: 10, border: `1.5px solid ${t.inputBorder}`, background: t.input, color: selected ? t.text : t.sub, display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "inherit", cursor: "pointer", textAlign: "right" }}>
      <span style={{ fontSize: 13.5, fontWeight: selected ? 700 : 500 }}>{display}</span><ChevronLeft size={17} style={{ transform: "rotate(90deg)", flexShrink: 0 }} />
    </button>
    {open && toBody(<div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 500, display: "flex", alignItems: "flex-end", justifyContent: "center", maxWidth: 480, margin: "0 auto", fontFamily: FONT, direction: "rtl" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: t.bg || t.card, width: "100%", maxHeight: "86vh", overflowY: "auto", borderRadius: "18px 18px 0 0", padding: "16px 14px calc(18px + env(safe-area-inset-bottom, 0px))" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <button type="button" onClick={() => setOpen(false)} style={{ border: 0, background: "transparent", color: t.sub, padding: 5 }}><X size={21} /></button>
          <div style={{ fontWeight: 800, fontSize: 15 }}>حساب‌ها</div><span style={{ width: 31 }} />
        </div>
        <AccountsTree mode="pick" categories={categories} addCategory={addCategory} value={value} onPick={(id) => { onChange(id); setOpen(false); }} />
      </div>
    </div>)}
  </>;
}

// «از حساب / به حساب»: همان درخت حساب‌ها؛ همه نمایش داده می‌شوند ولی فقط «بانک‌ها» و «حساب‌های دو طرفه» قابل انتخابند.
// برای وصل شدن به موجودی واقعی، نام حساب بانکی در درخت باید با نام آن در «حساب‌ها و کارت‌ها» یکسان باشد.
function SourceAccountField({ accounts, categories, accountId, fromCategoryId, onChange, st, allowTwoWay = true, title = "انتخاب حساب" }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const byId = (id) => categories.find((c) => c.id === id);
  const twoWayAnc = (c) => { let p = c, g = 0; while (p && g++ < 8) { if (p.twoWay) return true; p = byId(p.parentId); } return false; };
  const selectable = (c) => c.kind === "bank" || (allowTwoWay && twoWayAnc(c));
  const accSel = accounts.find((a) => a.id === accountId);
  const catSel = fromCategoryId ? byId(fromCategoryId) : null;
  const label = catSel ? accountPath(categories, catSel).join(" / ") : accSel ? accSel.name : "";
  const treeValue = fromCategoryId || categories.find((c) => c.kind === "bank" && accSel && faKey(c.name) === faKey(accSel.name))?.id;
  function resolve(c) {
    if (c.kind === "bank") {
      let p = c, g = 0;
      while (p && g++ < 8) {
        const acc = accounts.find((a) => faKey(a.name) === faKey(p.name));
        if (acc) return { accountId: acc.id, fromCategoryId: "" };
        p = byId(p.parentId);
      }
      return { error: `نام «${c.name}» با هیچ حسابی در «حساب‌ها و کارت‌ها» یکسان نیست؛ برای وصل شدن به موجودی بانک، نام‌ها را یکی کنید.` };
    }
    return { accountId: "", fromCategoryId: c.id };
  }
  function pick(id) {
    const c = byId(id); if (!c) return;
    const r = resolve(c);
    if (r.error) { window.alert(r.error); return; }
    onChange(r); setOpen(false);
  }
  return <>
    <button type="button" onClick={() => setOpen(true)} style={{ width: "100%", minHeight: 46, marginBottom: 8, padding: "9px 12px", borderRadius: 10, border: `1.5px solid ${t.inputBorder}`, background: t.input, color: label ? t.text : t.sub, display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "inherit", cursor: "pointer", textAlign: "right" }}>
      <span style={{ fontSize: 13.5, fontWeight: label ? 700 : 500 }}>{label || title}</span><ChevronLeft size={17} style={{ transform: "rotate(90deg)", flexShrink: 0 }} />
    </button>
    {open && toBody(<div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 700, display: "flex", alignItems: "flex-end", justifyContent: "center", maxWidth: 480, margin: "0 auto", fontFamily: FONT, direction: "rtl" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: t.bg || t.card, width: "100%", maxHeight: "80vh", overflowY: "auto", borderRadius: "18px 18px 0 0", padding: "16px 14px calc(18px + env(safe-area-inset-bottom, 0px))" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <button type="button" onClick={() => setOpen(false)} style={{ border: 0, background: "transparent", color: t.sub, padding: 5 }}><X size={21} /></button>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{title}</div><span style={{ width: 31 }} />
        </div>
        <div style={{ fontSize: 11.5, color: t.sub, lineHeight: 1.9, marginBottom: 10 }}>{allowTwoWay ? "فقط حساب‌های بانکی و حساب‌های دو طرفه قابل انتخاب‌اند؛ بقیه کم‌رنگ هستند." : "فقط حساب‌های بانکی قابل انتخاب‌اند؛ بقیه کم‌رنگ هستند."}</div>
        <AccountsTree mode="pick" categories={categories} value={treeValue} selectable={selectable} defaultExpanded={{ "g:bank": true }} onPick={pick} onBlocked={() => window.alert(allowTwoWay ? "این حساب قابل انتخاب نیست. فقط «بانک‌ها» و حساب‌های «دو طرفه» انتخاب می‌شوند." : "این حساب قابل انتخاب نیست. فقط «بانک‌ها» انتخاب می‌شوند.")} />
      </div>
    </div>)}
  </>;
}

function AddTransactionSheet({ accounts, categories, favorites, members = [], events = [], projects = [], initial, onClose, onSubmit, onAddAccount, onAddCategory }) {
  const st = useStyles();
  const [type, setType] = useState(initial?.type || "expense");
  const [amount, setAmount] = useState(initial?.amount ? String(initial.amount) : "");
  const [categoryId, setCategoryId] = useState(() => {
    if (initial?.categoryId && categories.some((c) => c.id === initial.categoryId)) return initial.categoryId;
    if (initial?.categoryHint) {
      const match = categories.find((c) => c.name === initial.categoryHint && c.kind === (initial.type || "expense"));
      if (match) return match.id;
    }
    return "";
  });
  const [accountId, setAccountId] = useState(initial?.fromCategoryId ? "" : (initial?.accountId || accounts[0]?.id || ""));
  const [fromCategoryId, setFromCategoryId] = useState(initial?.fromCategoryId || "");
  const [toAccountId, setToAccountId] = useState(initial?.toAccountId || accounts[1]?.id || accounts[0]?.id || "");
  const [date, setDate] = useState(initial?.date || todayISO());
  const [time, setTime] = useState(initial?.time || new Date().toTimeString().slice(0, 5));
  const [note, setNote] = useState(initial?.note || "");
  const [tagsInput, setTagsInput] = useState((initial?.tags || []).join(", "));
  const [photo, setPhoto] = useState(initial?.photo || null);
  const [showMore, setShowMore] = useState(false);
  const [memberId, setMemberId] = useState(initial?.memberId || "");
  const [eventId, setEventId] = useState(initial?.eventId || "");
  const [projectId, setProjectId] = useState(initial?.projectId || "");
  const [inlineAdd, setInlineAdd] = useState(null);
  const [inlineName, setInlineName] = useState("");
  const [side, setSide] = useState(initial?.side || "");

  const twoWayPicked = !!categories.find((c) => c.id === categoryId)?.twoWay;
  const effectiveSide = side || (type === "income" ? "creditor" : "debtor");
  const filteredCats = categories.filter((c) => c.kind === type);
  const favCats = filteredCats.filter((c) => favorites.categories.includes(c.id));
  const canSubmit = amount && Number(amount) > 0 && (accountId || (type !== "transfer" && fromCategoryId)) && (type === "transfer" ? toAccountId && toAccountId !== accountId : categoryId);

  async function handlePhoto(e) {
    const f = e.target.files[0];
    if (!f) return;
    const dataUrl = await resizeImage(f);
    setPhoto(dataUrl);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 120, maxWidth: 480, margin: "0 auto", paddingBottom: "calc(80px + env(safe-area-inset-bottom, 0px))" }}>
      <div style={{ background: "#fff", width: "100%", borderRadius: "18px", padding: "18px 18px 24px", maxHeight: "calc(88vh - 70px)", overflowY: "auto", boxShadow: "0 -8px 30px rgba(0,0,0,.18)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#8a8194" }}><X size={22} /></button>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{initial?._editId ? "ویرایش تراکنش" : "ثبت تراکنش جدید"}</div>
          <div style={{ width: 22 }} />
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {[{ k: "expense", l: "پرداخت", c: BRAND.crimson }, { k: "income", l: "دریافت", c: BRAND.darkgreen }, { k: "transfer", l: "انتقال", c: BRAND.violet }].map((o) => (
            <button key={o.k} onClick={() => { setType(o.k); setCategoryId(""); setSide(""); if (o.k === "transfer" && !accountId) { setAccountId(accounts[0]?.id || ""); setFromCategoryId(""); } }} style={{ flex: 1, padding: "10px 4px", borderRadius: 9, border: `1.5px solid ${type === o.k ? o.c : "#e3e0ea"}`, background: type === o.k ? o.c : "#fff", color: type === o.k ? "#fff" : "#241a30", fontWeight: 700, cursor: "pointer", fontSize: 13.5 }}>{o.l}</button>
          ))}
        </div>

        {favCats.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {favCats.map((c) => (
              <button key={c.id} onClick={() => setCategoryId(c.id)} style={{ display: "flex", alignItems: "center", gap: 4, background: categoryId === c.id ? BRAND.header : "#f1eef4", color: categoryId === c.id ? "#fff" : "#3E1461", border: "none", borderRadius: 20, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                <Star size={11} fill="#f5b301" color="#f5b301" /> {c.name}
              </button>
            ))}
          </div>
        )}

        <label style={st.label}>مبلغ (ریال)</label>
        <AmountInput value={amount} onChange={setAmount} placeholder="0" style={st.input} />

        {type !== "transfer" ? (
          <>
            <label style={st.label}>حساب‌ها</label>
            <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}><AccountPickerField categories={categories} addCategory={onAddCategory} value={categoryId} onChange={setCategoryId} st={st} /></div>
              <button type="button" onClick={() => { setInlineAdd("category"); setInlineName(""); }} style={{ ...miniBtn, width: 44, height: 44, background: BRAND.header, color: "#fff" }} title="افزودن دسته"><Plus size={18} /></button>
            </div>
            {twoWayPicked && (
              <div style={{ marginBottom: 10 }}>
                <label style={st.label}>این حساب دو طرفه است — طرف حساب</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {[{ k: "debtor", l: "بدهکار" }, { k: "creditor", l: "بستانکار" }].map((o) => (
                    <button key={o.k} type="button" onClick={() => setSide(o.k)} style={{ flex: 1, padding: "9px 4px", borderRadius: 9, border: `1.5px solid ${effectiveSide === o.k ? BRAND.violet : "#e3e0ea"}`, background: effectiveSide === o.k ? BRAND.violet : "#fff", color: effectiveSide === o.k ? "#fff" : "#241a30", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>{o.l}</button>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "#8a8194", marginTop: 5, lineHeight: 1.8 }}>مثلاً بیمه: پرداخت حق بیمه = بدهکار، دریافت خسارت = بستانکار.</div>
              </div>
            )}
            <label style={st.label}>{type === "expense" ? "از حساب" : "به حساب"}</label>
            <div style={{ display: "flex", gap: 6 }}>
              <div style={{ flex: 1, minWidth: 0 }}><SourceAccountField accounts={accounts} categories={categories} accountId={accountId} fromCategoryId={fromCategoryId} onChange={(v) => { setAccountId(v.accountId); setFromCategoryId(v.fromCategoryId); }} st={st} title={type === "expense" ? "از حساب" : "به حساب"} /></div>
              <button onClick={() => { setInlineAdd("account"); setInlineName(""); }} style={{ ...miniBtn, width: 44, height: 44, background: BRAND.violet, color: "#fff" }}><Plus size={18} /></button>
            </div>
            {inlineAdd && <div style={{ background: "#f7f4fa", borderRadius: 10, padding: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{inlineAdd === "category" ? "دسته جدید" : "حساب جدید"}</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input autoFocus value={inlineName} onChange={(e) => setInlineName(e.target.value)} placeholder={inlineAdd === "category" ? "نام دسته" : "نام حساب"} style={{ ...st.input, margin: 0, flex: 1 }} />
                <button onClick={() => {
                  if (!inlineName.trim()) return;
                  const id = uid();
                  if (inlineAdd === "category") { onAddCategory?.({ id, name: inlineName.trim(), kind: type }); setCategoryId(id); }
                  else { onAddAccount?.({ id, name: inlineName.trim(), type: "bank", initial: 0 }); setAccountId(id); setFromCategoryId(""); }
                  setInlineAdd(null);
                }} style={{ ...st.primaryBtn, width: "auto", padding: "0 14px" }}>افزودن</button>
              </div>
            </div>}
          </>
        ) : (
          <>
            <label style={st.label}>از حساب</label>
            <BankAccountField accounts={accounts} value={accountId} onChange={setAccountId} st={st} />
            <label style={st.label}>به حساب</label>
            <BankAccountField accounts={accounts} value={toAccountId} onChange={setToAccountId} st={st} />
          </>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 8, alignItems: "end" }}>
          <div><label style={st.label}>تاریخ</label><JalaliDateInput value={date} onChange={(v) => setDate(v)} style={st.input} /></div>
          <div><label style={st.label}>ساعت</label><input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ ...st.input, direction: "ltr", textAlign: "center" }} /></div>
        </div>

        <label style={st.label}>برچسب‌ها (با کاما جدا کنید)</label>
        <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="مثلا: سفر, ضروری" style={st.input} />

        <label style={st.label}>یادداشت (اختیاری)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="توضیحات..." style={st.input} />

        <label style={st.label}>پیوست عکس (اختیاری)</label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, border: "1.5px dashed #d8d2e0", borderRadius: 9, padding: "10px 12px", cursor: "pointer", marginBottom: 12, fontSize: 13, color: "#8a8194" }}>
          <ImageIcon size={16} /> {photo ? "عکس انتخاب شد ✓" : "افزودن عکس رسید"}
          <input type="file" accept="image/*" onChange={handlePhoto} style={{ display: "none" }} />
        </label>
        {photo && <img src={photo} style={{ width: 60, height: 60, borderRadius: 8, objectFit: "cover", marginBottom: 12 }} />}

        {(members.length > 0 || events.length > 0 || projects.length > 0) && (
          <div style={{ marginBottom: 12 }}>
            <button onClick={() => setShowMore((v) => !v)} style={{ background: "none", border: "none", color: BRAND.header, fontWeight: 700, fontSize: 12.5, cursor: "pointer", padding: 0, marginBottom: showMore ? 10 : 0 }}>
              {showMore ? "بستن جزئیات بیشتر ▲" : "افزودن عضو / رویداد / پروژه ▼"}
            </button>
            {showMore && (
              <>
                {members.length > 0 && (<>
                  <label style={st.label}>عضو خانواده</label>
                  <select value={memberId} onChange={(e) => setMemberId(e.target.value)} style={st.input}>
                    <option value="">— بدون عضو —</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </>)}
                {events.length > 0 && (<>
                  <label style={st.label}>رویداد</label>
                  <select value={eventId} onChange={(e) => setEventId(e.target.value)} style={st.input}>
                    <option value="">— بدون رویداد —</option>
                    {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                  </select>
                </>)}
                {projects.length > 0 && (<>
                  <label style={st.label}>پروژه</label>
                  <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={st.input}>
                    <option value="">— بدون پروژه —</option>
                    {projects.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                  </select>
                </>)}
              </>
            )}
          </div>
        )}

        <button disabled={!canSubmit}
          onClick={() => onSubmit({
            ...(initial?._editId ? { _editId: initial._editId } : {}),
            type, amount: Number(amount), categoryId, accountId, fromCategoryId: type !== "transfer" && fromCategoryId ? fromCategoryId : undefined,
            toAccountId: type === "transfer" ? toAccountId : undefined,
            side: twoWayPicked ? effectiveSide : undefined,
            date, time, note, photo: photo || undefined,
            tags: tagsInput.split(",").map((s) => s.trim()).filter(Boolean),
            memberId: memberId || undefined, eventId: eventId || undefined, projectId: projectId || undefined,
          })}
          style={{ ...st.primaryBtn, opacity: canSubmit ? 1 : 0.5, marginTop: 6 }}>
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Check size={17} /> ثبت تراکنش</span>
        </button>
      </div>
    </div>
  );
}


/* ---------------------------------------------------------
   Parmis-style modules: persons, debts, currencies, calculator, support
--------------------------------------------------------- */
function GoalsManager({ goals, setGoals }) {
  const st = useStyles();
  const [form, setForm] = useState({ title: "", target: "", saved: "", dueDate: "", note: "", accountId: "" });
  function add() {
    const target = Number(form.target || 0), saved = Number(form.saved || 0);
    if (!form.title.trim() || target <= 0) return;
    setGoals((p) => [{ id: uid(), title: form.title.trim(), target, saved: Math.min(saved, target), dueDate: form.dueDate || "", note: form.note.trim(), createdAt: new Date().toISOString() }, ...p]);
    setForm({ title: "", target: "", saved: "", dueDate: "", note: "" });
  }
  function changeSaved(id, delta) {
    setGoals((p) => p.map((g) => g.id === id ? { ...g, saved: Math.max(0, Math.min(g.target, Number(g.saved || 0) + delta)) } : g));
  }
  const totalTarget = goals.reduce((s, g) => s + Number(g.target || 0), 0);
  const totalSaved = goals.reduce((s, g) => s + Number(g.saved || 0), 0);
  return <div>
    <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>هدف مالی جدید</div>
      <div style={{ fontSize: 12, color: useT().sub, marginBottom: 10 }}>مثلاً خرید خودرو، سفر، پس‌انداز اضطراری یا خرید خانه.</div>
      <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="نام هدف" style={st.input} />
      <AmountInput placeholder="مبلغ هدف" value={form.target} onChange={(v) => setForm({ ...form, target: v })} style={st.input} />
      <AmountInput placeholder="مبلغ پس‌انداز فعلی (اختیاری)" value={form.saved} onChange={(v) => setForm({ ...form, saved: v })} style={st.input} />
      <label style={st.label}>تاریخ هدف (اختیاری)</label>
      <JalaliDateInput value={form.dueDate || todayISO()} onChange={(v) => setForm({ ...form, dueDate: v })} style={st.input} />
      <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="توضیحات" style={st.input} />
      <button onClick={add} style={{ ...st.primaryBtn, background: BRAND.green }}>افزودن هدف</button>
    </div>
    <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: useT().sub, marginBottom: 8 }}>
        <span>مجموع اهداف</span><b style={{ color: useT().text }}>{toFaInt(totalTarget)} ریال</b>
      </div>
      <div style={{ height: 10, background: useT().border, borderRadius: 20, overflow: "hidden" }}><div style={{ height: "100%", width: `${totalTarget ? Math.min(100, totalSaved / totalTarget * 100) : 0}%`, background: BRAND.green, borderRadius: 20 }} /></div>
      <div style={{ marginTop: 7, textAlign: "center", fontSize: 12, color: BRAND.green, fontWeight: 700 }}>پس‌انداز شده: {toFaInt(totalSaved)} ریال</div>
    </div>
    <div style={{ ...st.card, padding: "4px 12px" }}>
      {goals.length === 0 && <EmptyRow text="هنوز هدف مالی ثبت نشده" />}
      {goals.map((g) => {
        const pct = g.target ? Math.min(100, Number(g.saved || 0) / g.target * 100) : 0;
        return <div key={g.id} style={{ padding: "14px 2px", borderBottom: "1px solid #f0eef3" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div><div style={{ fontWeight: 800 }}>{g.title}</div>{g.dueDate && <div style={{ fontSize: 11.5, color: useT().sub, marginTop: 3 }}>هدف: {faLongDate(new Date(g.dueDate))}</div>}</div>
            <button onClick={() => setGoals((p) => p.filter((x) => x.id !== g.id))} style={{ background: "none", border: "none", color: BRAND.crimson, cursor: "pointer" }}><Trash2 size={15}/></button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 10 }}><span>{toFaInt(g.saved)} ریال</span><b>{toFaInt(g.target)} ریال</b></div>
          <div style={{ height: 9, background: useT().border, borderRadius: 20, overflow: "hidden", marginTop: 6 }}><div style={{ height: "100%", width: `${pct}%`, background: BRAND.green, borderRadius: 20 }} /></div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <span style={{ fontSize: 11.5, color: BRAND.green, fontWeight: 700 }}>{toFaInt(Math.round(pct))}% تکمیل</span>
            <div style={{ display: "flex", gap: 6 }}><button onClick={() => changeSaved(g.id, -100000)} style={miniBtn}>−۱۰۰هزار</button><button onClick={() => changeSaved(g.id, 100000)} style={{ ...miniBtn, color: BRAND.green }}>+۱۰۰هزار</button></div>
          </div>
        </div>;
      })}
    </div>
  </div>;
}

function PersonsManager({ persons, setPersons }) {
  const st = useStyles();
  const [form, setForm] = useState({ name: "", phone: "", note: "" });
  const [editing, setEditing] = useState(null);
  function save() {
    if (!form.name.trim()) return;
    if (editing) setPersons((p) => p.map((x) => x.id === editing ? { ...x, ...form, name: form.name.trim() } : x));
    else setPersons((p) => [{ id: uid(), ...form, name: form.name.trim() }, ...p]);
    setForm({ name: "", phone: "", note: "" }); setEditing(null);
  }
  return <div>
    <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
      <div style={{ fontWeight: 800, marginBottom: 10 }}>تعریف شخص / طرف حساب</div>
      <input placeholder="نام و نام خانوادگی / فروشگاه" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={st.input} />
      <input placeholder="شماره تماس" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={st.input} inputMode="tel" />
      <input placeholder="توضیحات" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={st.input} />
      <button onClick={save} style={st.primaryBtn}>{editing ? "ذخیره تغییرات" : "افزودن شخص"}</button>
    </div>
    <div style={{ ...st.card, padding: "4px 12px" }}>
      {persons.length === 0 && <EmptyRow text="شخصی ثبت نشده" />}
      {persons.map((p) => <Row key={p.id} title={p.name} subtitle={[p.phone, p.note].filter(Boolean).join(" · ") || "طرف حساب"}
        extra={<div style={{ display: "flex", gap: 5 }}><button onClick={() => { setEditing(p.id); setForm({ name: p.name, phone: p.phone || "", note: p.note || "" }); }} style={miniBtn}><Pencil size={13}/></button></div>}
        leftIcon={<Trash2 size={15}/>} leftColor={BRAND.crimson} onClick={() => setPersons((all) => all.filter((x) => x.id !== p.id))} chevron={null} />)}
    </div>
    <div style={{ fontSize: 12, color: useT().sub, marginTop: 10 }}>این بخش برای ثبت اشخاص، فروشگاه‌ها و طرف حساب‌هاست و پایه‌ی مدیریت بدهکار/بستانکار را تشکیل می‌دهد.</div>
  </div>;
}

function DebtsManager({ debts, setDebts, persons, accounts, setTransactions, focusId, setFocusId }) {
  const st = useStyles();
  const [expandedId, setExpandedId] = useState(null);
  useFocusItem(focusId, setFocusId, setExpandedId);
  const [form, setForm] = useState({ personId: "", kind: "receivable", amount: "", dueDate: todayISO(), note: "", accountId: "" });
  function add() {
    const amount = Number(form.amount || 0); if (!form.personId || !amount) return;
    setDebts((p) => [{ id: uid(), ...form, amount, settled: false, createdAt: new Date().toISOString() }, ...p]);
    setForm({ personId: "", kind: "receivable", amount: "", dueDate: todayISO(), note: "", accountId: "" });
  }
  const open = debts.filter((d) => !d.settled);
  return <div>
    <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
      <div style={{ fontWeight: 800, marginBottom: 10 }}>ثبت بدهی / طلب</div>
      <select value={form.personId} onChange={(e) => setForm({ ...form, personId: e.target.value })} style={st.input}><option value="">انتخاب طرف حساب</option>{persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}><button onClick={() => setForm({ ...form, kind: "receivable" })} style={pillStyle(form.kind === "receivable")}>طلب از دیگران</button><button onClick={() => setForm({ ...form, kind: "payable" })} style={pillStyle(form.kind === "payable")}>بدهی به دیگران</button></div>
      <AmountInput placeholder="مبلغ" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} style={st.input} />
      <select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} style={st.input}><option value="">حساب تسویه</option>{accounts.filter(a => a.active !== false).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      <JalaliDateInput value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} style={st.input} />
      <input placeholder="توضیحات" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={st.input} />
      <button onClick={add} style={st.primaryBtn}>ثبت</button>
    </div>
    <div style={{ ...st.card, padding: "4px 12px" }}>
      {open.length === 0 && <EmptyRow text="بدهی یا طلب باز وجود ندارد" />}
      {open.map((d) => { const person = persons.find((p) => p.id === d.personId); return <div key={d.id} id={`item-${d.id}`}><Row onClick={() => setExpandedId(expandedId === d.id ? null : d.id)} title={person?.name || "طرف حساب حذف‌شده"} subtitle={`${d.kind === "receivable" ? "طلب" : "بدهی"} · سررسید ${faLongDate(new Date(d.dueDate))}`} value={`${toFaInt(d.amount)} ریال`} valueColor={d.kind === "receivable" ? BRAND.darkgreen : BRAND.crimson}
        extra={<button onClick={(e) => { e.stopPropagation();
          if (!d.accountId) { alert("حساب تسویه برای این بدهی انتخاب نشده است."); return; }
          const tx = { id: uid(), type: d.kind === "receivable" ? "income" : "expense", amount: d.amount, accountId: d.accountId, date: todayISO(), time: new Date().toTimeString().slice(0,5), note: `${d.kind === "receivable" ? "وصول طلب" : "پرداخت بدهی"} - ${person?.name || "طرف حساب"}`, sourceType: "debt", sourceId: d.id, debtId: d.id, categoryId: d.kind === "receivable" ? "cat-debt-receivable" : "cat-debt-payable", isPnlExcluded: true };
          setTransactions?.((prev) => postOnce(prev, tx));
          setDebts((p) => p.map((x) => x.id === d.id ? { ...x, settled: true, settledAt: todayISO(), settlementTransactionId: tx.id } : x));
        }} style={{ ...miniBtn, color: BRAND.green }}><Check size={14}/></button>} chevron={null} />{expandedId === d.id && <DetailBox lines={[
        ["طرف حساب", person?.name || "طرف حساب حذف‌شده"],
        ["نوع", d.kind === "receivable" ? "طلب از دیگران" : "بدهی به دیگران"],
        ["مبلغ", `${toFaInt(d.amount)} ریال`],
        ["سررسید", d.dueDate ? faLongDate(new Date(d.dueDate)) : "—"],
        ["حساب تسویه", accounts.find((a) => a.id === d.accountId)?.name || "انتخاب نشده"],
        ["توضیحات", d.note || "—"],
      ]} />}</div>; })}
    </div>
  </div>;
}

function CurrenciesManager({ currencies, setCurrencies }) {
  const st = useStyles();
  const defaults = [{ code: "IRR", name: "ریال", rate: 1 }, { code: "USD", name: "دلار", rate: "" }, { code: "EUR", name: "یورو", rate: "" }, { code: "AED", name: "درهم", rate: "" }, { code: "GBP", name: "پوند", rate: "" }];
  const [form, setForm] = useState({ code: "", name: "", rate: "" });
  const list = currencies.length ? currencies : defaults;
  function add() { if (!form.code || !form.name) return; setCurrencies((p) => [...p, { id: uid(), code: form.code.toUpperCase(), name: form.name, rate: Number(form.rate || 0) }]); setForm({ code: "", name: "", rate: "" }); }
  return <div>
    <div style={{ ...st.card, padding: 14, marginBottom: 16 }}><div style={{ fontWeight: 800, marginBottom: 10 }}>واحدهای پولی و نرخ تبدیل</div><input placeholder="کد ارز مثل USD" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} style={st.input}/><input placeholder="نام ارز" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={st.input}/><AmountInput placeholder="نرخ هر واحد به ریال" value={form.rate} onChange={(v) => setForm({ ...form, rate: v })} style={st.input}/><button onClick={add} style={st.primaryBtn}>افزودن ارز</button></div>
    <div style={{ ...st.card, padding: "4px 12px" }}>{list.map((c, i) => <Row key={c.id || c.code} title={`${c.name} (${c.code})`} value={c.code === "IRR" ? "۱" : c.rate ? `${toFaInt(c.rate)} ریال` : "نرخ ثبت نشده"} valueColor={BRAND.header} extra={i >= defaults.length ? <button onClick={() => setCurrencies((p) => p.filter((x) => x.id !== c.id))} style={{ ...miniBtn, color: BRAND.crimson }}><Trash2 size={13}/></button> : null} chevron={null} />)}</div>
  </div>;
}

function CalculatorView() {
  const st = useStyles();
  const [expr, setExpr] = useState("");
  const [result, setResult] = useState("");
  function calc() { try { if (!/^[0-9+\-*/().% ]+$/.test(expr)) return; const value = Function(`"use strict"; return (${expr})`)(); if (Number.isFinite(value)) setResult(String(value)); } catch {} }
  const keys = ["7","8","9","/","4","5","6","*","1","2","3","-","0",".","=","+"];
  return <div><div style={{ ...st.card, padding: 16, marginBottom: 14 }}><div style={{ fontSize: 12, color: useT().sub, marginBottom: 6 }}>ماشین حساب</div><div style={{ fontSize: 26, fontWeight: 800, direction: "ltr", textAlign: "left", minHeight: 38 }}>{result || expr || "۰"}</div></div><div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>{keys.map((k) => <button key={k} onClick={() => k === "=" ? calc() : setExpr((x) => x + k)} style={{ height: 52, border: "none", borderRadius: 12, background: k === "=" ? BRAND.header : "#fff", color: k === "=" ? "#fff" : "#241a30", fontSize: 18, fontWeight: 700 }}>{k}</button>)}<button onClick={() => { setExpr(""); setResult(""); }} style={{ gridColumn: "1 / -1", height: 44, border: "none", borderRadius: 12, background: BRAND.crimson, color: "#fff", fontWeight: 700 }}>پاک کردن</button></div></div>;
}

const SUPPORT_EMAIL = "r.shadfar@live.com";
const TICKETS_KEY = "rexa:tickets";
// ارسال واقعی تیکت به ایمیل پشتیبانی (بدون نیاز به سرور؛ از سرویس FormSubmit استفاده می‌شود)
async function sendTicketEmail(tk, who = {}) {
  const payload = {
    _subject: `تیکت جدید Rexa — ${String(tk.id).slice(-6)}`,
    _template: "table",
    _captcha: "false",
    name: who.name || "کاربر Rexa",
    message: tk.text,
    ticket_id: tk.id,
    date: tk.date,
    platform: (typeof Capacitor !== "undefined" && Capacitor.getPlatform) ? Capacitor.getPlatform() : "web",
  };
  if (tk.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tk.email)) payload.email = tk.email; // آدرس پاسخ‌دادن
  const url = `https://formsubmit.co/ajax/${SUPPORT_EMAIL}`;
  let status = 0, data = {};
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.post({ url, headers: { "Content-Type": "application/json", Accept: "application/json" }, data: payload, connectTimeout: 12000, readTimeout: 20000 });
    status = r.status; data = typeof r.data === "string" ? (() => { try { return JSON.parse(r.data); } catch { return {}; } })() : (r.data || {});
  } else {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const tm = ctl ? setTimeout(() => ctl.abort(), 20000) : null;
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload), signal: ctl?.signal });
      status = r.status; data = await r.json().catch(() => ({}));
    } finally { if (tm) clearTimeout(tm); }
  }
  if (status >= 200 && status < 300 && (data.success === true || data.success === "true")) return true;
  throw new Error(data.message || `HTTP ${status}`);
}
function SupportView({ settings }) {
  const st = useStyles(); const t = useT();
  const prof = settings?.profile || {};
  const [message, setMessage] = useState("");
  const [replyEmail, setReplyEmail] = useState(prof.email || "");
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const loadTickets = () => {
    try { return JSON.parse(localStorage.getItem(TICKETS_KEY) || "[]").map((x) => (typeof x.sent === "boolean" ? x : { ...x, sent: false, pending: false, status: "ارسال نشده" })); } catch { return []; }
  };
  const [tickets, setTickets] = useState(loadTickets);
  const ref = useRef(tickets);
  const queue = useRef(false);
  const save = (next) => { ref.current = next; setTickets(next); try { localStorage.setItem(TICKETS_KEY, JSON.stringify(next)); } catch {} };
  const patch = (id, p) => save(ref.current.map((x) => (x.id === id ? { ...x, ...p } : x)));
  async function deliver(tk) {
    patch(tk.id, { pending: true, status: "در حال ارسال..." });
    try {
      await sendTicketEmail(tk, { name: prof.name });
      patch(tk.id, { sent: true, pending: false, status: "ارسال‌شده", sentAt: new Date().toISOString(), error: "" });
      return true;
    } catch (e) {
      patch(tk.id, { sent: false, pending: true, status: "در انتظار ارسال", error: String(e?.message || e).slice(0, 140) });
      return false;
    }
  }
  async function flush() {
    if (queue.current) return; queue.current = true;
    try { for (const tk of ref.current.filter((x) => x.pending && !x.sent)) await deliver(tk); } finally { queue.current = false; }
  }
  useEffect(() => {
    flush();
    const on = () => flush();
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, []);
  async function send() {
    const text = message.trim(); if (!text || busy) return;
    const tk = { id: uid(), text, date: new Date().toISOString(), email: replyEmail.trim(), sent: false, pending: true, status: "در حال ارسال..." };
    save([tk, ...ref.current]); setMessage(""); setBusy(true); setNote(null);
    const ok = await deliver(tk);
    setBusy(false);
    setNote(ok ? { ok: true, text: "تیکت ثبت شد و به ایمیل پشتیبانی ارسال شد." } : { ok: false, text: "ارسال انجام نشد (اینترنت یا سرویس ایمیل). تیکت ذخیره شد و دوباره تلاش می‌شود؛ می‌توانید «ارسال دوباره» یا «ارسال با برنامه ایمیل» را هم بزنید." });
  }
  async function retry(tk) { setNote(null); const ok = await deliver(tk); setNote(ok ? { ok: true, text: "تیکت ارسال شد." } : { ok: false, text: "هنوز ارسال نشد. اینترنت را بررسی کنید یا با برنامه ایمیل بفرستید." }); }
  function viaMailApp(tk) {
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("تیکت Rexa")}&body=${encodeURIComponent(tk.text)}`;
    try { window.location.href = url; } catch {}
  }
  const color = (x) => (x.sent ? BRAND.teal : x.status === "در حال ارسال..." ? BRAND.gold : BRAND.crimson);
  const smallBtn = { border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
  return <div>
    <div style={{ ...st.card, padding: 14, marginBottom: 16 }}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>پشتیبانی و تیکت</div>
      <div style={{ fontSize: 12, color: t.sub, marginBottom: 10, lineHeight: 1.9 }}>پیام شما ثبت می‌شود و مستقیم به ایمیل پشتیبانی ارسال می‌گردد. اطلاعات مالی شما همراه پیام فرستاده نمی‌شود.</div>
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="متن درخواست یا مشکل..." style={{ ...st.input, minHeight: 120, resize: "vertical" }} />
      <input value={replyEmail} onChange={(e) => setReplyEmail(e.target.value)} placeholder="ایمیل شما برای پاسخ (اختیاری)" style={{ ...st.input, direction: "ltr", textAlign: "left" }} inputMode="email" autoCapitalize="off" />
      <button onClick={send} disabled={busy} style={{ ...st.primaryBtn, opacity: busy ? 0.6 : 1 }}>{busy ? "در حال ارسال..." : "ثبت و ارسال تیکت"}</button>
      {note && <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, lineHeight: 1.9, color: note.ok ? BRAND.darkgreen : BRAND.crimson }}>{note.text}</div>}
    </div>
    <div style={{ ...st.card, padding: "4px 12px" }}>
      {tickets.length === 0 ? <EmptyRow text="تیکتی ثبت نشده" /> : tickets.map((x) => (
        <div key={x.id} style={{ padding: "11px 0", borderBottom: `1px solid ${t.border}` }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.9, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{x.text}</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
            <span style={{ fontSize: 11.5, color: t.sub }}>{faLongDate(new Date(x.date))}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: color(x) }}>{x.status}</span>
          </div>
          {!x.sent && x.status !== "در حال ارسال..." && (
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={() => retry(x)} style={{ ...smallBtn, background: BRAND.header, color: "#fff" }}>ارسال دوباره</button>
              <button onClick={() => viaMailApp(x)} style={{ ...smallBtn, background: t.input, color: t.text }}>ارسال با برنامه ایمیل</button>
            </div>
          )}
        </div>
      ))}
    </div>
  </div>;
}

/* ---------------------------------------------------------
   Side menu
--------------------------------------------------------- */
function ProfileView({ settings, setSettings }) { const st=useStyles(); const p=settings.profile||{}; const [f,setF]=useState({name:p.name||"",phone:p.phone||"",email:p.email||""}); return <div><div style={{...st.card,padding:16}}><SectionTitle text="ویرایش اطلاعات کاربری"/><input value={f.name} onChange={e=>setF({...f,name:e.target.value})} placeholder="نام و نام خانوادگی" style={st.input}/><input value={f.phone} onChange={e=>setF({...f,phone:e.target.value})} placeholder="شماره موبایل" style={st.input}/><input value={f.email} onChange={e=>setF({...f,email:e.target.value})} placeholder="ایمیل" style={st.input}/><button onClick={()=>{setSettings(x=>({...x,profile:{...(x.profile||{}),...f}}));alert("اطلاعات کاربری ذخیره شد.")}} style={st.primaryBtn}>ذخیره اطلاعات</button></div></div>; }
function BackupView({ exportBackup, importBackup }) { const st=useStyles(); const ref=useRef(null); return <div><div style={{...st.card,padding:16}}><SectionTitle text="پشتیبان‌گیری و بازیابی"/><div style={{fontSize:12,color:useT().sub,lineHeight:1.9,marginBottom:12}}>از اطلاعات برنامه فایل پشتیبان بگیر و در صورت نیاز آن را بازیابی کن.</div><button onClick={exportBackup} style={{...st.primaryBtn,background:BRAND.header,marginBottom:10}}>دریافت فایل پشتیبان</button><button onClick={()=>ref.current?.click()} style={{...st.primaryBtn,background:BRAND.gold,color:"#241a30"}}>بازیابی از فایل پشتیبان</button><input ref={ref} type="file" accept="application/json,.json" hidden onChange={e=>{const f=e.target.files?.[0];if(f)importBackup(f);e.target.value=""}}/></div></div>; }
function AccessView({ settings, setSettings }) { const st=useStyles(); return <div><div style={{...st.card,padding:16}}><SectionTitle text="مدیریت دسترسی"/><Row title="قفل با اثر انگشت / Face ID" subtitle="احراز هویت واقعی گوشی در APK" leftIcon={<Fingerprint size={17}/>} leftColor={BRAND.violet} extra={<input type="checkbox" checked={!!settings.biometricEnabled} onChange={e=>setSettings(p=>({...p,biometricEnabled:e.target.checked}))}/>} chevron={null}/><Row title="دسترسی پیامک بانکی" subtitle="مجوز خواندن پیامک‌های بانکی در Android" leftIcon={<BellRing size={17}/>} leftColor={BRAND.header} chevron={null}/></div></div>; }
function BasicSettingsView({ settings, setSettings }) { const st=useStyles(); return <div><div style={{...st.card,padding:16}}><SectionTitle text="تنظیمات پایه"/><label style={st.label}>واحد پول اصلی</label><select value={settings.currency||"IRR"} onChange={e=>setSettings(p=>({...p,currency:e.target.value}))} style={st.input}><option value="IRR">ریال</option><option value="TOMAN">تومان</option><option value="USD">دلار</option></select><label style={st.label}>اندازه نوشته‌ها</label><select value={settings.fontScale||1} onChange={e=>setSettings(p=>({...p,fontScale:Number(e.target.value)}))} style={st.input}><option value="0.9">کوچک</option><option value="1">استاندارد</option><option value="1.1">بزرگ</option><option value="1.2">خیلی بزرگ</option></select></div></div>; }
function TutorialView() { const st=useStyles(); const a=["دکمه + برای هزینه، درآمد، چک و انتقال است.","میکروفون و ثبت سریع برای ثبت طبیعی هزینه و درآمد هستند.","منوی سه‌خط دسترسی به حساب‌ها، اشخاص، بودجه، وام، چک و گزارش‌ها را دارد.","برای حفظ اطلاعات مرتب پشتیبان بگیر.","اثر انگشت را از مدیریت دسترسی فعال کن."]; return <div>{a.map((x,i)=><div key={i} style={{...st.card,padding:14,marginBottom:10,display:"flex",gap:10}}><b>{i+1}</b><span style={{fontSize:13,lineHeight:1.9}}>{x}</span></div>)}</div>; }
function ShareAppView() { const st=useStyles(); return <div><div style={{...st.card,padding:20,textAlign:"center"}}><RexaLogo size={70}/><div style={{fontWeight:800,margin:"10px 0"}}>Rexa</div><button onClick={async()=>{try{if(navigator.share)await navigator.share({title:"Rexa",text:"Rexa؛ مدیریت مالی شخصی"});else{await navigator.clipboard.writeText("Rexa؛ مدیریت مالی شخصی");alert("متن معرفی کپی شد.")}}catch{}}} style={{...st.primaryBtn,background:BRAND.violet}}>ارسال برنامه به دیگران</button></div></div>; }
function RateAppView() { const st=useStyles(); const [r,setR]=useState(0); return <div><div style={{...st.card,padding:20,textAlign:"center"}}><div style={{fontWeight:800}}>امتیاز به برنامه</div><div style={{display:"flex",justifyContent:"center",gap:6,margin:"15px 0"}}>{[1,2,3,4,5].map(n=><button key={n} onClick={()=>setR(n)} style={{border:0,background:"none",fontSize:30,opacity:n<=r?1:.3}}>★</button>)}</div><button disabled={!r} onClick={()=>alert("امتیاز شما ثبت شد.")} style={{...st.primaryBtn,opacity:r?1:.5}}>ثبت امتیاز</button></div></div>; }
function AboutView({ updateInfo, updateMsg, checkUpdateNow }) {
  const st = useStyles(); const t = useT();
  return <div><div style={{ ...st.card, padding: 20, textAlign: "center" }}>
    <RexaLogo size={78} />
    <div style={{ fontWeight: 900, fontSize: 19, marginTop: 8 }}>Rexa</div>
    <div style={{ fontSize: 12, color: t.sub, marginTop: 5 }}>مدیریت مالی شخصی</div>
    <div style={{ borderTop: "1px solid #eee", margin: "18px 0", paddingTop: 14, fontSize: 12.5, lineHeight: 2 }}>نسخه ۵.۱.۲{APP_BUILD ? ` (ساخت ${toFaInt(APP_BUILD)})` : ""}<br />Android / Capacitor<br />Rexa Personal Finance</div>
    {Capacitor.isNativePlatform() && APP_REPO && <>
      <button onClick={() => checkUpdateNow?.(true)} style={st.primaryBtn}>بررسی به‌روزرسانی</button>
      {updateMsg && <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: BRAND.darkgreen }}>{updateMsg}</div>}
      {updateInfo && <button onClick={() => openExternalUrl(updateInfo.url)} style={{ ...st.primaryBtn, marginTop: 10, background: BRAND.green }}>دانلود نسخه‌ی {updateInfo.name}</button>}
    </>}
  </div></div>;
}

function CloudSyncView({ cloud }) {
  const st = useStyles(); const t = useT();
  const { cfg, state } = cloud;
  const [token, setToken] = useState(cfg.token);
  const [repo, setRepo] = useState(cfg.repo);
  const [pass, setPass] = useState(cfg.pass);
  const connected = syncReady(cfg);
  const ltr = { ...st.input, direction: "ltr", textAlign: "left" };
  const btn = (bg, extra = {}) => ({ ...st.primaryBtn, background: bg, opacity: state.busy ? 0.6 : 1, ...extra });
  return <div>
    <div style={{ ...st.card, padding: 14, marginBottom: 14 }}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>ذخیره‌ی داده‌ها روی گیت‌هاب</div>
      <div style={{ fontSize: 12.5, lineHeight: 2, color: t.sub }}>
        داده‌های شما روی همین گوشی با رمز خودتان رمزگذاری می‌شود و فقط متن رمزشده در یک ریپوی <b>خصوصی</b> گیت‌هاب ذخیره می‌شود. با همین ریپو و رمز می‌توانید در گوشی دیگر یا بعد از نصب دوباره، داده‌ها را برگردانید.
        <br />۱) در گیت‌هاب یک ریپوی خصوصی بسازید (مثلاً rexa-data).
        <br />۲) در Settings ← Developer settings ← Fine-grained tokens توکنی فقط برای همان ریپو با دسترسی Contents: Read and write بسازید.
        <br />۳) رمز همگام‌سازی را فراموش نکنید؛ بدون آن داده قابل بازیابی نیست.
      </div>
    </div>
    <div style={{ ...st.card, padding: 14, marginBottom: 14 }}>
      <label style={st.label}>ریپوی خصوصی (نام‌کاربری/نام‌ریپو)</label>
      <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="username/rexa-data" style={ltr} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <label style={st.label}>توکن گیت‌هاب</label>
      <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_..." type="password" style={ltr} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <label style={st.label}>رمز همگام‌سازی (حداقل ۸ نویسه)</label>
      <input value={pass} onChange={(e) => setPass(e.target.value)} placeholder="رمز رمزگذاری داده‌ها" type="password" style={ltr} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <button disabled={state.busy} onClick={() => cloud.connect({ token, repo, pass })} style={btn(BRAND.header)}>{state.busy ? "در حال انجام..." : connected ? "ذخیره‌ی تنظیمات و همگام‌سازی" : "اتصال به گیت‌هاب"}</button>
    </div>
    {state.msg && <div style={{ marginBottom: 14, fontSize: 13, fontWeight: 700, lineHeight: 1.9, color: state.msg.ok ? BRAND.darkgreen : BRAND.crimson }}>{state.msg.text}</div>}
    {state.conflict && <div style={{ ...st.card, padding: 14, marginBottom: 14, border: "1.5px solid #f0c777" }}>
      <div style={{ fontWeight: 800, marginBottom: 6, color: "#8a5a00" }}>تفاوت بین این گوشی و گیت‌هاب</div>
      <div style={{ fontSize: 12.5, lineHeight: 2, color: t.sub, marginBottom: 10 }}>روی گیت‌هاب داده‌ی دیگری هست{state.conflict.updatedAt ? ` (آخرین ذخیره: ${faLongDate(new Date(state.conflict.updatedAt))})` : ""}. کدام نگه داشته شود؟</div>
      <button disabled={state.busy} onClick={() => { if (window.confirm("داده‌های این گوشی با نسخه‌ی گیت‌هاب جایگزین می‌شود. ادامه می‌دهید؟")) cloud.runSync("pull"); }} style={btn(BRAND.green)}>دریافت از گیت‌هاب (جایگزین داده‌ی این گوشی)</button>
      <button disabled={state.busy} onClick={() => { if (window.confirm("داده‌ی گیت‌هاب با داده‌ی این گوشی جایگزین می‌شود. ادامه می‌دهید؟")) cloud.runSync("push", { force: true }); }} style={btn(BRAND.crimson, { marginTop: 8 })}>جایگزینی گیت‌هاب با داده‌ی این گوشی</button>
    </div>}
    {connected && <div style={{ ...st.card, padding: 14 }}>
      <div style={{ fontSize: 12.5, color: t.sub, marginBottom: 10 }}>{cfg.lastAt ? `آخرین همگام‌سازی: ${faLongDate(new Date(cfg.lastAt))}` : "هنوز همگام‌سازی نشده است."}</div>
      <Row title="همگام‌سازی خودکار" subtitle="بعد از هر تغییر و هنگام باز شدن برنامه" leftIcon={<RefreshCw size={16} />} leftColor={BRAND.teal}
        extra={<button onClick={() => cloud.setAuto(!cfg.auto)} style={{ background: cfg.auto ? BRAND.green : "#aaa", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{cfg.auto ? "فعال" : "غیرفعال"}</button>} chevron={null} />
      <button disabled={state.busy} onClick={() => cloud.runSync("push")} style={btn(BRAND.violet, { marginTop: 10 })}>ارسال به گیت‌هاب</button>
      <button disabled={state.busy} onClick={() => { if (window.confirm("داده‌های این گوشی با نسخه‌ی گیت‌هاب جایگزین می‌شود. ادامه می‌دهید؟")) cloud.runSync("pull"); }} style={btn(BRAND.green, { marginTop: 8 })}>دریافت از گیت‌هاب</button>
      <button disabled={state.busy} onClick={() => { if (window.confirm("اتصال قطع شود و توکن و رمز از این گوشی پاک شوند؟ (داده‌های گیت‌هاب حذف نمی‌شوند)")) { cloud.disconnect(); setToken(""); setPass(""); setRepo(""); } }} style={btn("#8a8a8a", { marginTop: 8 })}>قطع اتصال</button>
    </div>}
  </div>;
}

/* ---------------------------------------------------------
   Side menu
--------------------------------------------------------- */
function SideMenu({ onClose, setSubView, profileName }) {
  const sections=[
    {title:"تنظیمات و برنامه",items:[["ویرایش اطلاعات کاربری","profile"],["پشتیبان‌گیری","backup"],["همگام‌سازی ابری (گیت‌هاب)","cloud"],["مدیریت دسترسی","access"],["تنظیمات پایه","basic"],["تنظیمات و امنیت","settings"],["آموزش","tutorial"],["ارسال برنامه به دیگران","share"],["امتیاز به برنامه","rate"],["درباره","about"]]}
  ];
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.42)",zIndex:310,maxWidth:480,margin:"0 auto"}} onClick={onClose}><div onClick={e=>e.stopPropagation()} style={{position:"absolute",top:0,bottom:0,left:0,width:"86%",maxWidth:390,background:"#fff",boxShadow:"3px 0 18px rgba(0,0,0,.22)",overflowY:"auto",paddingTop:"env(safe-area-inset-top,0px)",paddingBottom:"calc(28px + env(safe-area-inset-bottom,0px))"}}><div style={{background:BRAND.header,color:"#fff",padding:"16px",position:"sticky",top:0,zIndex:2}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}><div style={{display:"flex",alignItems:"center",gap:10}}><RexaLogo size={42}/><div><div style={{fontWeight:800,fontSize:15}}>{profileName||"کاربر Rexa"}</div><div style={{fontSize:11,color:"#d8c9e8",marginTop:3}}>Rexa · نسخه ۵.۱.۲</div></div></div><button onClick={onClose} style={{background:"rgba(255,255,255,.12)",border:0,borderRadius:9,color:"#fff",width:36,height:36}}><X size={21}/></button></div></div><div style={{padding:"8px 14px 0"}}>{sections.map(sec=><div key={sec.title}><div style={{fontSize:11,fontWeight:800,color:BRAND.violet,padding:"13px 6px 7px"}}>{sec.title}</div><div style={{border:"1px solid #eeeaf2",borderRadius:12,overflow:"hidden",marginBottom:6}}>{sec.items.map(([label,key],i)=><div key={key} onClick={()=>setSubView(key)} style={{padding:"12px 10px",borderBottom:i===sec.items.length-1?"none":"1px solid #f0eef3",fontSize:13.5,fontWeight:600,color:"#241a30",background:"#fff"}}>{label}</div>)}</div></div>)}<div style={{textAlign:"center",color:"#918899",fontSize:10.5,padding:"14px 0 10px"}}>Rexa Personal Finance · نسخه ۵.۱.۲ · Android</div></div></div></div>;
}
