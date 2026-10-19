// Общее для всех игр: часы, пользователь, загрузка комнаты, переходы
// с оптимистической блокировкой, сообщения ленты.

import { EndpointError } from 'sdk';
import { one, many, exec } from './sql.js';

// Клиент опрашивает сервер каждые 0,4–1,5 с (в свёрнутом виде — раз в 4 с).
// Игрок, не выходивший на связь дольше STALE_MS, считается отключившимся,
// а вне партии через LOBBY_DROP_MS убирается из комнаты.
export const STALE_MS = 10_000;
export const LOBBY_DROP_MS = 30_000;
// Посреди партии игрока считаем ушедшим (пропуск хода, прерывание игры)
// только после более долгой тишины: короткие обрывы связи не должны ломать игру.
export const GAME_GONE_MS = 25_000;

// Запросы обрабатывают разные серверы платформы, и их часы расходятся на
// секунды. Поэтому время берётся из базы данных — это единые часы для всех:
// в начале каждого запроса begin() вычисляет поправку к локальным часам.
let clockOffset = 0;
export const now = () => Date.now() + clockOffset;

async function syncClock() {
  const r = await one("SELECT CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) AS t");
  if (r && r.t) clockOffset = r.t - Date.now();
}

// Начало обработки любого запроса Mini App: сверка часов и проверка пользователя.
export async function begin(ctx) {
  const user = caller(ctx);
  await syncClock();
  return user;
}

export const fail = (code, description) => {
  throw new EndpointError(description, { code });
};

export function caller(ctx) {
  const u = ctx && ctx.initData && ctx.initData.user;
  if (!u || !u.id) fail('NO_USER', 'Откройте игру из Telegram');
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.username || 'Игрок';
  return { id: u.id, name: name.slice(0, 24), photo: u.photo_url || null };
}

export const loadLobby = (code) => one('SELECT * FROM lobbies WHERE code = :code', { code: String(code || '') });
export const loadLobbyById = (id) => one('SELECT * FROM lobbies WHERE id = :id', { id });
export const loadPlayers = (lobbyId) => many('SELECT * FROM players WHERE lobby_id = :lobbyId ORDER BY seat', { lobbyId });

export const isActive = (p, t) => p.last_seen >= t - STALE_MS;
export const isGone = (p, t) => p.last_seen < t - GAME_GONE_MS;
export const parse = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

export async function addMessage(lobby, kind, fields = {}) {
  await exec(
    `INSERT INTO messages (lobby_id, round_no, kind, user_id, name, body, to_user, created_at)
     VALUES (:lobbyId, :roundNo, :kind, :userId, :name, :body, :toUser, :t)`,
    {
      lobbyId: lobby.id, roundNo: lobby.round_no, kind,
      userId: fields.userId ?? null, name: fields.name ?? null, body: fields.body ?? null,
      toUser: fields.toUser ?? null, t: now(),
    },
  );
}

// Применяет изменения к комнате, только если её никто не изменил раньше.
// Возвращает новую версию строки или null, если переход уже выполнил другой запрос.
export async function transition(lobby, changes) {
  const cols = Object.keys(changes);
  const set = cols.map((c) => `${c} = :${c}`).join(', ');
  const t = now();
  const res = await exec(
    `UPDATE lobbies SET ${set}, version = version + 1, updated_at = :t WHERE id = :id AND version = :v`,
    { ...changes, t, id: lobby.id, v: lobby.version },
  );
  if (!res.rowsAffected) return null;
  return { ...lobby, ...changes, version: lobby.version + 1, updated_at: t };
}

export async function dropPlayers(lobby, gone) {
  for (const p of gone) {
    const res = await exec('DELETE FROM players WHERE id = :pid', { pid: p.id });
    if (res.rowsAffected) await addMessage(lobby, 'left', { userId: p.user_id, name: p.name });
  }
}
