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
