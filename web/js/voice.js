// Голосовой чат комнаты на WebRTC. Звук идёт напрямую между устройствами
// (сетка «каждый с каждым», до трёх игроков). Сервер только передаёт
// сигнальные сообщения через обычный цикл синхронизации:
//   offer / answer — описание соединения (SDP вместе со всеми ICE-кандидатами),
//   hello — «у меня нет соединения с тобой, начни заново»,
//   bye   — «я отключаюсь».
// Соединение всегда начинает игрок с меньшим id — так оба не начнут разом.

import { call } from './api.js';
import { toast, icons } from './ui.js';
import { haptic } from './tg.js';

const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
const ICE_WAIT_MS = 1500;
const RETRY_MS = 12_000;
const HELLO_EVERY_MS = 5000;
const SPEAK_LEVEL = 0.035;

export const OFF = 0, MIC = 1, LISTEN = 2;

export class Voice {
  constructor() {
    this.mode = OFF;
    this.muted = false;
    this.stream = null;
    this.peers = new Map();
    this.outbox = [];
    this.state = null;
    this.hellos = new Map();
    this.meters = new Map();
    this.ctx = null;
    this.needsTap = false;
    this.kick = () => {};
    this.resetSent = false;
    this.busy = false;
    setInterval(() => this.meter(), 150);
    document.addEventListener('pointerdown', () => this.unlock(), true);
  }

  get me() { return this.state && this.state.me; }
  get negotiating() { return this.missing || [...this.peers.values()].some((p) => p.pc.connectionState !== 'connected'); }
  get connected() { return [...this.peers.values()].filter((p) => p.pc.connectionState === 'connected').length; }

  // ─── Подключение ─────────────────────────────────────────────────────────

  async join() {
    if (this.busy || !this.state) return;
    this.busy = true;
    haptic.tap();
    this.audioContext();
    let mode = MIC;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error(), { name: 'Unsupported' });
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      this.watch(this.me, this.stream);
    } catch (e) {
      mode = LISTEN;
      toast(e.name === 'NotAllowedError'
        ? 'Нет доступа к микрофону — вы только слушаете'
        : 'Этот клиент Telegram не даёт доступ к микрофону — вы только слушаете', 'warn', 4500);
    }
    // Если микрофон уже был, а теперь его дали — старые соединения пересоздаём.
    if (this.mode === LISTEN && mode === MIC) this.closeAll(true);
    this.mode = mode;
    this.muted = false;
    this.busy = false;
    if (mode === MIC) { haptic.ok(); toast('Вы в голосовом чате', 'ok', 1800); }
    call('voice', { code: this.state.code, voice: mode }).catch(() => {});
    this.render();
    this.kick();
  }

  leave({ notify = true } = {}) {
    if (this.mode === OFF) return;
    for (const id of this.peers.keys()) this.outbox.push({ to: id, kind: 'bye' });
    this.closeAll(false);
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.meters.delete(this.me);
    this.mode = OFF;
    this.missing = false;
    if (notify && this.state) call('voice', { code: this.state.code, voice: OFF }).catch(() => {});
    this.render();
  }

  // Полный сброс при выходе из комнаты.
  reset() {
    this.leave({ notify: false });
    this.outbox = [];
    this.state = null;
    this.resetSent = false;
  }

  toggleMute() {
    if (this.mode !== MIC || !this.stream) return;
    this.muted = !this.muted;
    for (const t of this.stream.getAudioTracks()) t.enabled = !this.muted;
    haptic.tick();
    this.render();
  }

  // Нажатие на кнопку микрофона.
  press() {
    if (this.mode === MIC) this.toggleMute();
    else this.join();
  }

  takeOutbox() { const out = this.outbox; this.outbox = []; return out; }
  giveBack(list) { this.outbox = list.concat(this.outbox); }

  // ─── Согласование с состоянием комнаты ───────────────────────────────────

  sync(state) {
    const first = !this.state || this.state.code !== state.code;
    this.state = state;
    const meRow = state.players.find((p) => p.id === state.me);
    if (this.mode === OFF) {
      if (this.peers.size) this.closeAll(false);
      // После перезапуска приложения сервер ещё считает нас в эфире.
      if (meRow && meRow.voice && !this.resetSent) {
        this.resetSent = true;
        call('voice', { code: state.code, voice: OFF }).catch(() => {});
      }
      if (first) this.render();
      return;
    }
    const want = new Map();
    for (const p of state.players) {
      if (p.id === state.me || !p.voice || !p.active) continue;
      if (p.voice === LISTEN && this.mode === LISTEN) continue; // двоим слушателям нечего передавать
      want.set(p.id, p);
    }
    for (const id of [...this.peers.keys()]) if (!want.has(id)) this.close(id);
    this.missing = [...want.keys()].some((id) => !this.peers.has(id));
    const t = Date.now();
    for (const id of want.keys()) {
      const peer = this.peers.get(id);
      const stuck = peer && peer.pc.connectionState !== 'connected' && t - peer.created > RETRY_MS;
      if (peer && !stuck) continue;
      if (state.me < id) this.offer(id);
      else if (t - (this.hellos.get(id) || 0) > HELLO_EVERY_MS) {
        this.hellos.set(id, t);
        this.outbox.push({ to: id, kind: 'hello' });
      }
    }
    this.render();
  }

  async onSignals(list) {
    for (const sg of list) {
      try {
        if (sg.kind === 'bye') this.close(sg.from);
        else if (this.mode === OFF) continue;
        else if (sg.kind === 'hello') { if (this.me < sg.from) await this.offer(sg.from); }
        else if (sg.kind === 'offer') await this.answer(sg.from, sg.body);
        else if (sg.kind === 'answer') {
          const peer = this.peers.get(sg.from);
          if (peer && peer.sid === sg.body.sid && peer.pc.signalingState === 'have-local-offer') {
            await peer.pc.setRemoteDescription({ type: 'answer', sdp: sg.body.sdp });
          }
        }
      } catch (e) {
        console.warn('voice signal', sg.kind, e);
        this.close(sg.from);
      }
    }
  }

  // ─── WebRTC ──────────────────────────────────────────────────────────────

  peer(id, sid) {
    this.close(id);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer = { id, sid, pc, created: Date.now(), audio: null };
    pc.ontrack = (e) => this.play(id, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') peer.created = 0; // повторим при следующей синхронизации
      this.render();
    };
    this.peers.set(id, peer);
    return peer;
  }

  addLocal(pc) {
    if (this.stream) for (const t of this.stream.getAudioTracks()) pc.addTrack(t, this.stream);
  }

  async offer(id) {
    const sid = Math.random().toString(36).slice(2, 10);
    const { pc } = this.peer(id, sid);
    if (this.stream) this.addLocal(pc);
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    await pc.setLocalDescription(await pc.createOffer());
    await iceGathered(pc);
    if (this.peers.get(id)?.sid !== sid) return;
    this.outbox.push({ to: id, kind: 'offer', body: { sid, sdp: pc.localDescription.sdp } });
    this.kick();
  }

  async answer(id, body) {
    const { pc } = this.peer(id, body.sid);
    await pc.setRemoteDescription({ type: 'offer', sdp: body.sdp });
    this.addLocal(pc);
    await pc.setLocalDescription(await pc.createAnswer());
    await iceGathered(pc);
    if (this.peers.get(id)?.sid !== body.sid) return;
    this.outbox.push({ to: id, kind: 'answer', body: { sid: body.sid, sdp: pc.localDescription.sdp } });
    this.kick();
  }

  close(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    try { peer.pc.close(); } catch {}
    if (peer.audio) { peer.audio.srcObject = null; peer.audio.remove(); }
    this.meters.delete(id);
  }

  closeAll(sendBye) {
    for (const id of [...this.peers.keys()]) {
      if (sendBye) this.outbox.push({ to: id, kind: 'bye' });
      this.close(id);
    }
  }

  // ─── Звук ────────────────────────────────────────────────────────────────

  play(id, stream) {
    const peer = this.peers.get(id);
    if (!peer) return;
    if (!peer.audio) {
      peer.audio = document.createElement('audio');
      peer.audio.autoplay = true;
      peer.audio.setAttribute('playsinline', '');
      peer.audio.style.display = 'none';
      document.body.append(peer.audio);
    }
    peer.audio.srcObject = stream;
    peer.audio.play().catch(() => { this.needsTap = true; this.render(); });
    this.watch(id, stream);
  }

  // Браузеры запускают звук только после касания экрана.
  unlock() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    if (!this.needsTap) return;
    this.needsTap = false;
    for (const p of this.peers.values()) if (p.audio) p.audio.play().catch(() => { this.needsTap = true; });
    this.render();
  }

  audioContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  // Индикатор «говорит»: уровень сигнала по каждому участнику.
  watch(id, stream) {
    const ctx = this.audioContext();
    if (!ctx || !stream.getAudioTracks().length) return;
    try {
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      this.meters.set(id, { an, buf: new Float32Array(an.fftSize), on: false });
    } catch {}
  }

  meter() {
    for (const [id, m] of this.meters) {
      m.an.getFloatTimeDomainData(m.buf);
      let sum = 0;
      for (const v of m.buf) sum += v * v;
      const rms = Math.sqrt(sum / m.buf.length);
      const on = rms > SPEAK_LEVEL && !(id === this.me && this.muted);
      if (on === m.on) continue;
      m.on = on;
      for (const el of document.querySelectorAll(`.ava[data-uid="${id}"]`)) el.classList.toggle('speaking', on);
    }
  }

  // ─── Кнопки ──────────────────────────────────────────────────────────────

  get look() {
    if (this.mode === OFF) return { cls: 'off', icon: icons.micOff, label: 'Голосовой чат выключен' };
    if (this.mode === LISTEN) return { cls: 'listen', icon: icons.headphones, label: 'Вы только слушаете' };
    if (this.muted) return { cls: 'muted', icon: icons.micOff, label: 'Микрофон выключен' };
    return { cls: 'on', icon: icons.mic, label: 'Микрофон включён' };
  }

  render() {
    const { cls, icon, label } = this.look;
    for (const el of document.querySelectorAll('.voice-btn')) {
      el.className = 'icon-btn voice-btn ' + cls + (this.needsTap ? ' tap' : '');
      el.innerHTML = icon;
      el.setAttribute('aria-label', label);
    }
    for (const el of document.querySelectorAll('[data-voice-status]')) el.textContent = this.statusText();
  }

  statusText() {
    const s = this.state;
    const inVoice = s ? s.players.filter((p) => p.voice && p.active).length : 0;
    if (this.mode === OFF) return inVoice ? `В эфире: ${inVoice}` : 'Пока никого нет';
    if (this.needsTap) return 'Коснитесь экрана, чтобы включить звук';
    const others = s ? s.players.filter((p) => p.id !== s.me && p.voice && p.active).length : 0;
    if (!others) return 'Ждём остальных';
    if (this.negotiating) return 'Соединяемся…';
    return this.mode === LISTEN ? 'Вы слушаете' : this.muted ? 'Микрофон выключен' : 'Вас слышат';
  }
}

function iceGathered(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', check); clearTimeout(timer); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const timer = setTimeout(done, ICE_WAIT_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}
