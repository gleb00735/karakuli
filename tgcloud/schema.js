import { table, integer, text, index, uniqueIndex } from 'sdk/db';

// Игровая комната. Вся логика партии — конечный автомат по полю `phase`:
// lobby → pick → draw → reveal → (pick … ) → final → lobby.
// `version` — оптимистическая блокировка: переход фазы выполняет только тот
// запрос, чей UPDATE … WHERE version = ? затронул строку.
export const lobbies = table('lobbies', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  code:        text('code').notNull(),
  hostId:      integer('host_id').notNull(),
  phase:       text('phase').notNull().default('lobby'),
  version:     integer('version').notNull().default(0),
  rounds:      integer('rounds').notNull().default(2),
  drawTime:    integer('draw_time').notNull().default(80),
  game:        integer('game').notNull().default(0),
  turn:        integer('turn').notNull().default(0),
  turnTotal:   integer('turn_total').notNull().default(0),
  roundNo:     integer('round_no').notNull().default(0),
  drawerId:    integer('drawer_id'),
  word:        text('word'),
  wordDiff:    integer('word_diff'),
  choices:     text('choices'),
  usedWords:   text('used_words'),
  order:       text('turn_order'),
  phaseStart:  integer('phase_start'),
  deadline:    integer('deadline'),
  lastResult:  text('last_result'),
  // Какая игра выбрана в комнате: 'draw' — «Каракули», 'mafia' — «Мафия», 'checkers' — «Шашки», 'race' — «Гонки», 'who' — «Кто я?»,
  // 'ttt' — «Крестики-нолики».
  mode:        text('mode').notNull().default('draw'),
  // Состояние партии в мафию, шашки, гонки, «Кто я?» или крестики-нолики — JSON.
  mstate:      text('mstate'),
  // Трасса для «Гонок».
  track:       text('track').notNull().default('ring'),
  // Колода для «Кто я?»: mix, chars, famous, animals, jobs.
  deck:        text('deck').notNull().default('mix'),
  // Поле для «Крестиков-ноликов»: '3' — 3×3, '10' — 10×10, пять в ряд.
  variant:     text('variant').notNull().default('3'),
  created:     integer('created_at').notNull(),
  updated:     integer('updated_at').notNull(),
}, (t) => ({
  codeIdx:    uniqueIndex('uidx_lobbies_code').on(t.code),
  updatedIdx: index('idx_lobbies_updated').on(t.updated),
}));

export const players = table('players', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  lobbyId:   integer('lobby_id').notNull(),
  userId:    integer('user_id').notNull(),
  name:      text('name').notNull(),
  photo:     text('photo'),
  seat:      integer('seat').notNull(),
  score:     integer('score').notNull().default(0),
  gained:    integer('gained').notNull().default(0),
  guessedAt: integer('guessed_at'),
  // 1 — игрок перестал выходить на связь (закрыл приложение или пропала сеть).
  away:      integer('away').notNull().default(0),
  // Голосовой чат: 0 — не подключён, 1 — с микрофоном, 2 — только слушает.
  voice:     integer('voice').notNull().default(0),
  lastSeen:  integer('last_seen').notNull(),
  joined:    integer('joined_at').notNull(),
}, (t) => ({
  lobbyUserIdx: uniqueIndex('uidx_players_lobby_user').on(t.lobbyId, t.userId),
  userIdx:      index('idx_players_user').on(t.userId),
}));

// Штрихи рисунка. Каждая строка — пачка операций, присланная художником за
// один запрос; клиенты забирают пачки с id больше последнего увиденного.
export const strokes = table('strokes', {
  id:      integer('id').primaryKey({ autoIncrement: true }),
  lobbyId: integer('lobby_id').notNull(),
  roundNo: integer('round_no').notNull(),
  ops:     text('ops').notNull(),
}, (t) => ({
  roundIdx: index('idx_strokes_round').on(t.lobbyId, t.roundNo, t.id),
}));

// Лента событий: догадки, «угадал», «почти», системные сообщения.
// toUser != null — сообщение видит только этот игрок.
export const messages = table('messages', {
  id:      integer('id').primaryKey({ autoIncrement: true }),
  lobbyId: integer('lobby_id').notNull(),
  roundNo: integer('round_no').notNull(),
  kind:    text('kind').notNull(),
  userId:  integer('user_id'),
  name:    text('name'),
  body:    text('body'),
  toUser:  integer('to_user'),
  created: integer('created_at').notNull(),
}, (t) => ({
  lobbyIdx: index('idx_messages_lobby').on(t.lobbyId, t.id),
}));

// Сигнальные сообщения WebRTC между игроками (offer / answer / hello).
// Сам звук идёт напрямую между устройствами, сервер лишь передаёт эти записи.
export const signals = table('signals', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  lobbyId:  integer('lobby_id').notNull(),
  fromUser: integer('from_user').notNull(),
  toUser:   integer('to_user').notNull(),
  kind:     text('kind').notNull(),
  body:     text('body'),
  created:  integer('created_at').notNull(),
}, (t) => ({
  toIdx: index('idx_signals_to').on(t.lobbyId, t.toUser, t.id),
}));

// Ходы в мафии (ночные действия, голоса, «готов», «ознакомился с ролью»)
// и ответы на вопросы в «Кто я?».
// key — шаг партии (например, n2 — вторая ночь, v2 — второе голосование);
// у одного игрока на шаге один ход, повторный ход заменяет предыдущий.
export const mafiaMoves = table('mafia_moves', {
  id:      integer('id').primaryKey({ autoIncrement: true }),
  lobbyId: integer('lobby_id').notNull(),
  key:     text('key').notNull(),
  userId:  integer('user_id').notNull(),
  target:  integer('target').notNull().default(0),
  created: integer('created_at').notNull(),
}, (t) => ({
  moveIdx: uniqueIndex('uidx_mafia_moves').on(t.lobbyId, t.key, t.userId),
}));

// Гонки: последняя присланная позиция машины каждого игрока и время финиша.
export const racePos = table('race_pos', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  lobbyId:  integer('lobby_id').notNull(),
  userId:   integer('user_id').notNull(),
  data:     text('data').notNull(),
  finishMs: integer('finish_ms'),
  updated:  integer('updated_at').notNull(),
}, (t) => ({
  carIdx: uniqueIndex('uidx_race_pos').on(t.lobbyId, t.userId),
}));

// Рекорды одиночных игр: лучший результат каждого игрока в каждой игре.
export const scores = table('scores', {
  id:      integer('id').primaryKey({ autoIncrement: true }),
  game:    text('game').notNull(),
  userId:  integer('user_id').notNull(),
  name:    text('name').notNull(),
  photo:   text('photo'),
  best:    integer('best').notNull(),
  // Дополнительная величина результата (в 2048 — самая большая плитка).
  extra:   integer('extra').notNull().default(0),
  updated: integer('updated_at').notNull(),
}, (t) => ({
  userIdx: uniqueIndex('uidx_scores_game_user').on(t.game, t.userId),
  bestIdx: index('idx_scores_game_best').on(t.game, t.best),
}));
