// Мелкие помощники интерфейса: создание элементов, иконки, аватары, тосты.

export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') {
        for (const prop in v) prop.startsWith('--') ? el.style.setProperty(prop, v[prop]) : (el.style[prop] = v[prop]);
      }
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const svg = (markup) => {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstChild;
};

const I = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const icons = {
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  scan: I('<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>'),
  keypad: I('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 9h.01M12 9h.01M15.5 9h.01M8.5 12.5h.01M12 12.5h.01M15.5 12.5h.01M12 16h.01"/>'),
  share: I('<path d="M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5"/>'),
  copy: I('<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  back: I('<path d="M15 18 9 12l6-6"/>'),
  close: I('<path d="M6 6l12 12M18 6 6 18"/>'),
  send: I('<path d="M5 12h13M13 6l6 6-6 6"/>'),
  undo: I('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  trash: I('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  eraser: I('<path d="m7 21-4-4a2 2 0 0 1 0-2.8L13.2 4a2 2 0 0 1 2.8 0L20 8a2 2 0 0 1 0 2.8L10 21z"/><path d="M7 21h13M9 10l5 5"/>'),
  play: I('<path d="M7 5v14l11-7z" fill="currentColor"/>'),
  check: I('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 'stroke-width="3"'),
  pencil: I('<path d="M4 20l4-1L19 8a2.1 2.1 0 0 0-3-3L5 16z"/><path d="M14 7l3 3"/>'),
  crown: '<svg viewBox="0 0 24 24"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" fill="#ffc23d" stroke="#d99a12" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  home: I('<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/>'),
  replay: I('<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/>'),
  mic: I('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  micOff: I('<path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.7 2.5"/><path d="M5 11a7 7 0 0 0 11.3 5.5M19 11a7 7 0 0 1-.6 2.8M12 18v3M4 4l16 16"/>'),
  headphones: I('<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="5" height="7" rx="2"/><rect x="16" y="14" width="5" height="7" rx="2"/>'),
};
export const icon = (name) => svg(icons[name]);

const AVA_COLORS = ['#7a5cff', '#ff5d5d', '#22c3a6', '#3fa7ff', '#ff9f43', '#e056fd', '#10ac84', '#f368e0'];

export function avatar(p, { size, badge, off } = {}) {
  const el = h('div.ava', { 'data-uid': p.id, style: { '--av': AVA_COLORS[Math.abs(p.id) % AVA_COLORS.length], ...(size ? { '--s': size + 'px' } : {}) } });
  el.textContent = (p.name || '?').trim().charAt(0).toUpperCase();
  if (p.photo) {
    const img = h('img', { src: p.photo, alt: '', referrerpolicy: 'no-referrer' });
    img.onerror = () => img.remove();
    el.append(img);
  }
  if (off) el.classList.add('off');
  if (badge) el.append(h('div.badge', null, typeof badge === 'string' ? svg(badge) : badge));
  return el;
}

export function toast(text, kind = '', ms = 2600) {
  const box = document.getElementById('toasts');
  const el = h('div.toast' + (kind ? '.' + kind : ''), null, text);
  box.append(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, ms);
}

export function shake(el) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

// Склонение: plural(5, 'очко', 'очка', 'очков').
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function sheet(content, { onClose } = {}) {
  const wrap = h('div.sheet-wrap', { onclick: (e) => { if (e.target === wrap) close(); } },
    h('div.sheet', null, h('div.grip'), content));
  document.body.append(wrap);
  function close() { wrap.remove(); onClose && onClose(); }
  return { close, el: wrap };
}
