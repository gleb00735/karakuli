// Обёртка над Telegram.WebApp с запасными вариантами для браузера,
// чтобы игра открывалась и вне Telegram (локальная разработка).

const W = window.Telegram && window.Telegram.WebApp;
export const tg = W && W.initData ? W : null;

export const BOT_USERNAME = 'karakuli_draw_bot';

const ver = (v) => !!(tg && tg.isVersionAtLeast && tg.isVersionAtLeast(v));

export function devUser() {
  const q = new URLSearchParams(location.search);
  const id = Number(q.get('uid')) || Number(localStorage.getItem('dev-uid')) || Math.floor(Math.random() * 1e6) + 1000;
  try { localStorage.setItem('dev-uid', String(id)); } catch {}
  return { id, first_name: q.get('name') || 'Игрок ' + (id % 100) };
}

export const me = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) || devUser();

export function setup() {
  applyTheme();
  if (!tg) return;
  tg.ready();
  tg.expand();
  if (ver('7.7')) tg.disableVerticalSwipes();
  tg.onEvent('themeChanged', applyTheme);
}

function applyTheme() {
  const dark = tg ? tg.colorScheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const bg = dark ? '#16141f' : '#fff7ec';
  if (tg && ver('6.1')) {
    try { tg.setHeaderColor(bg); tg.setBackgroundColor(bg); } catch {}
    if (ver('7.10')) try { tg.setBottomBarColor(bg); } catch {}
  }
}

export const haptic = {
  tap: () => tg && ver('6.1') && tg.HapticFeedback.impactOccurred('light'),
  soft: () => tg && ver('6.1') && tg.HapticFeedback.impactOccurred('soft'),
  tick: () => tg && ver('6.1') && tg.HapticFeedback.selectionChanged(),
  ok: () => tg && ver('6.1') && tg.HapticFeedback.notificationOccurred('success'),
  warn: () => tg && ver('6.1') && tg.HapticFeedback.notificationOccurred('warning'),
  err: () => tg && ver('6.1') && tg.HapticFeedback.notificationOccurred('error'),
};

// Кнопка «Назад» Telegram: один активный обработчик за раз.
let backHandler = null;
export function setBack(fn) {
  if (!tg || !ver('6.1')) return;
  if (backHandler) tg.BackButton.offClick(backHandler);
  backHandler = fn;
  if (fn) { tg.BackButton.onClick(fn); tg.BackButton.show(); } else tg.BackButton.hide();
}

export function confirm(text) {
  if (tg && ver('6.2')) return new Promise((r) => tg.showConfirm(text, r));
  return Promise.resolve(window.confirm(text));
}

export function closingGuard(on) {
  if (!tg || !ver('6.2')) return;
  on ? tg.enableClosingConfirmation() : tg.disableClosingConfirmation();
}

export const canScan = () => !!(tg && ver('6.4'));

// Сканер QR встроенный в Telegram. onText возвращает true, если код подошёл.
export function scanQr(onText) {
  tg.showScanQrPopup({ text: 'Наведите камеру на QR-код комнаты' }, (text) => {
    if (onText(text)) { tg.closeScanQrPopup(); return true; }
    haptic.err();
  });
}

export const roomLink = (code) => `https://t.me/${BOT_USERNAME}?start=join_${code}`;

export function shareRoom(code) {
  const url = roomLink(code);
  const text = `Го в «Каракули»! Комната ${code} — рисуем и угадываем 🎨`;
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (tg) tg.openTelegramLink(share);
  else window.open(share, '_blank');
}

// Код комнаты из ссылки, start_param или просто цифр.
export function parseCode(text) {
  const s = String(text || '');
  const m = s.match(/join[_=](\d{4,5})/) || s.match(/^\s*(\d{4,5})\s*$/);
  return m ? m[1] : null;
}

export function launchCode() {
  const sp = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param;
  const q = new URLSearchParams(location.search).get('join');
  return parseCode(sp) || parseCode(q && 'join_' + q);
}

export function copy(text) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text).then(() => true, () => false);
  return Promise.resolve(false);
}

// Разрешение боту писать пользователю (нужно для напоминаний, если он
// не запускал бота через /start).
export function requestWriteAccess() {
  if (!tg || !ver('6.9')) return Promise.resolve(true);
  if (tg.initDataUnsafe.user && tg.initDataUnsafe.user.allows_write_to_pm) return Promise.resolve(true);
  return new Promise((resolve) => tg.requestWriteAccess((ok) => resolve(!!ok)));
}
