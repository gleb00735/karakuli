// QR-код комнаты в фирменном стиле: скруглённые модули, «глаза» и значок
// карандаша в центре (уровень коррекции H выдерживает перекрытие центра).

const INK = '#23203a';
const ACCENT = '#ff5d5d';

export function qrSvg(text) {
  const qr = window.qrcode(0, 'H');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 1;
  const size = n + quiet * 2;
  const logo = Math.ceil(n * 0.24) | 1;
  const lo = Math.floor((n - logo) / 2);
  const inEye = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const inLogo = (r, c) => r >= lo - 1 && r <= lo + logo && c >= lo - 1 && c <= lo + logo;

  let dots = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c) || inEye(r, c) || inLogo(r, c)) continue;
      dots += `<rect x="${c + quiet + 0.06}" y="${r + quiet + 0.06}" width="0.88" height="0.88" rx="0.32"/>`;
    }
  }
  const eye = (r, c) => {
    const x = c + quiet, y = r + quiet;
    return `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="2" fill="none" stroke="${INK}" stroke-width="1"/>` +
      `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="1" fill="${ACCENT}"/>`;
  };
  const cx = quiet + lo + logo / 2, cy = cx, lr = logo / 2 + 0.4;
  const s = logo / 24;
  const pencil = `<g transform="translate(${cx - 12 * s * 0.75} ${cy - 12 * s * 0.75}) scale(${s * 0.75})" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4-1L19 8a2.1 2.1 0 0 0-3-3L5 16z"/><path d="M14 7l3 3"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="geometricPrecision">` +
    `<rect width="${size}" height="${size}" fill="#fff"/>` +
    `<g fill="${INK}">${dots}</g>` +
    eye(0, 0) + eye(0, n - 7) + eye(n - 7, 0) +
    `<rect x="${cx - lr}" y="${cy - lr}" width="${lr * 2}" height="${lr * 2}" rx="${lr * 0.5}" fill="${ACCENT}"/>` +
    pencil + `</svg>`;
}
