// ── Neon Postgres (async) ─────────────────────────────────────────────────────
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
});

// Helper: run a query and return the result
const q = (text, params) => pool.query(text, params);
// Helper: get first row
const q1 = async (text, params) => (await pool.query(text, params)).rows[0] ?? null;
// Helper: get all rows
const qa = async (text, params) => (await pool.query(text, params)).rows;

// ── Schema ────────────────────────────────────────────────────────────────────
async function initDb() {
  await q(`
    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      display_name TEXT,
      real_name TEXT,
      username TEXT,
      avatar_url TEXT,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS channels (
      channel_id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT NOT NULL,
      is_member INTEGER DEFAULT 1,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      ts TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      user_id TEXT,
      text TEXT,
      thread_ts TEXT,
      is_reply INTEGER DEFAULT 0,
      has_replies INTEGER DEFAULT 0,
      reply_count INTEGER DEFAULT 0,
      reactions TEXT DEFAULT '[]',
      message_type TEXT DEFAULT 'message',
      raw_json TEXT,
      fetched_at TEXT NOT NULL,
      analyzed_at TEXT,
      PRIMARY KEY (ts, channel_id)
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      channel_id TEXT PRIMARY KEY,
      last_fetched_ts BIGINT DEFAULT 0,
      last_fetched_at TEXT,
      message_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id SERIAL PRIMARY KEY,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      channels_synced INTEGER DEFAULT 0,
      messages_fetched INTEGER DEFAULT 0,
      status TEXT DEFAULT 'running',
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS follow_ups (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      channel_id TEXT,
      channel_name TEXT,
      message_ts TEXT,
      context TEXT,
      status TEXT DEFAULT 'open',
      source TEXT DEFAULT 'claude',
      priority TEXT DEFAULT 'medium',
      task_type TEXT DEFAULT 'task',
      direction TEXT DEFAULT 'inbound',
      pre_resolved INTEGER DEFAULT 0,
      source_messages TEXT,
      resolution_evidence TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      resolved_by TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_summaries (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL UNIQUE,
      summary_text TEXT,
      standup_text TEXT,
      messages_newest_ts TEXT,
      messages_count INTEGER DEFAULT 0,
      generated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS claude_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      last_analyzed_ts TEXT,
      last_analyzed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS monday_members (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      monday_user_id TEXT DEFAULT '',
      is_video_team INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT NOW()::TEXT
    );

    CREATE TABLE IF NOT EXISTS monday_boards (
      id SERIAL PRIMARY KEY,
      board_id TEXT NOT NULL UNIQUE,
      label TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS monday_board_cache (
      board_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      items_json TEXT NOT NULL DEFAULT '[]',
      status_colors_json TEXT NOT NULL DEFAULT '{}',
      fetched_at BIGINT NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS monday_tasks_cache (
      cache_key TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      fetched_at BIGINT NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS monday_ai_summaries (
      member_id INTEGER NOT NULL,
      week_ending TEXT NOT NULL,
      summary_type TEXT NOT NULL,
      content TEXT NOT NULL,
      tasks_hash TEXT,
      created_at TEXT NOT NULL DEFAULT NOW()::TEXT,
      PRIMARY KEY (member_id, week_ending, summary_type)
    );

    CREATE TABLE IF NOT EXISTS monday_cache_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Seed from INITIAL_CONFIG env var (or defaults) if tables are empty
  const memberCount = await q1('SELECT COUNT(*) as count FROM monday_members');
  const boardCount  = await q1('SELECT COUNT(*) as count FROM monday_boards');

  if (parseInt(memberCount.count) === 0) {
    let members = [
      { name: 'Dan',    monday_user_id: '', is_video_team: 0 },
      { name: 'Natalie',monday_user_id: '', is_video_team: 0 },
      { name: 'Matan',  monday_user_id: '', is_video_team: 1 },
      { name: 'Isaac',  monday_user_id: '', is_video_team: 1 },
      { name: 'Yael',   monday_user_id: '', is_video_team: 1 },
      { name: 'Omri',   monday_user_id: '', is_video_team: 1 },
    ];
    if (process.env.INITIAL_CONFIG) {
      try { members = JSON.parse(process.env.INITIAL_CONFIG).members || members; } catch(_) {}
    }
    for (const m of members) {
      await q('INSERT INTO monday_members (name, monday_user_id, is_video_team) VALUES ($1, $2, $3)',
        [m.name, m.monday_user_id || '', m.is_video_team || 0]);
    }
    console.log(`[DB] Seeded ${members.length} members`);
  }

  if (parseInt(boardCount.count) === 0 && process.env.INITIAL_CONFIG) {
    try {
      const cfg = JSON.parse(process.env.INITIAL_CONFIG);
      for (const b of (cfg.boards || [])) {
        await q('INSERT INTO monday_boards (board_id, label) VALUES ($1, $2)', [b.board_id, b.label || '']);
      }
      console.log(`[DB] Seeded ${(cfg.boards||[]).length} boards`);
    } catch(_) {}
  }

  console.log('[DB] Postgres connected and schema ready');
}

// ── Token operations ──────────────────────────────────────────────────────────
const tokenOps = {
  get: () => q1('SELECT * FROM tokens WHERE id = 1'),
  upsert: (accessToken, refreshToken, expiresAt) => q(`
    INSERT INTO tokens (id, access_token, refresh_token, expires_at, updated_at)
    VALUES (1, $1, $2, $3, $4)
    ON CONFLICT(id) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      expires_at = EXCLUDED.expires_at,
      updated_at = EXCLUDED.updated_at
  `, [accessToken, refreshToken, expiresAt, new Date().toISOString()]),
};

// ── User operations ───────────────────────────────────────────────────────────
const userOps = {
  get: (userId) => q1('SELECT * FROM users WHERE user_id = $1', [userId]),
  upsert: (user) => q(`
    INSERT INTO users (user_id, display_name, real_name, username, avatar_url, fetched_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT(user_id) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      real_name = EXCLUDED.real_name,
      username = EXCLUDED.username,
      avatar_url = EXCLUDED.avatar_url,
      fetched_at = EXCLUDED.fetched_at
  `, [user.user_id, user.display_name, user.real_name, user.username, user.avatar_url, new Date().toISOString()]),
};

// ── Channel operations ────────────────────────────────────────────────────────
const channelOps = {
  getAll: () => qa('SELECT * FROM channels WHERE is_member = 1 ORDER BY name'),
  upsert: (channel) => q(`
    INSERT INTO channels (channel_id, name, type, is_member, fetched_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT(channel_id) DO UPDATE SET
      name = EXCLUDED.name,
      type = EXCLUDED.type,
      is_member = CASE WHEN channels.is_member = 0 THEN 0 ELSE EXCLUDED.is_member END,
      fetched_at = EXCLUDED.fetched_at
  `, [channel.channel_id, channel.name, channel.type, channel.is_member ? 1 : 0, new Date().toISOString()]),
};

// ── Message operations ────────────────────────────────────────────────────────
const messageOps = {
  upsert: (msg) => q(`
    INSERT INTO messages (ts, channel_id, user_id, text, thread_ts, is_reply, has_replies, reply_count, reactions, message_type, raw_json, fetched_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT(ts, channel_id) DO UPDATE SET
      text = EXCLUDED.text,
      has_replies = EXCLUDED.has_replies,
      reply_count = EXCLUDED.reply_count,
      reactions = EXCLUDED.reactions,
      raw_json = EXCLUDED.raw_json,
      fetched_at = EXCLUDED.fetched_at
  `, [
    msg.ts, msg.channel_id, msg.user_id, msg.text, msg.thread_ts,
    msg.is_reply ? 1 : 0, msg.has_replies ? 1 : 0, msg.reply_count || 0,
    JSON.stringify(msg.reactions || []), msg.message_type || 'message',
    JSON.stringify(msg.raw_json || {}), new Date().toISOString()
  ]),

  getForDay: async (date, channelId) => {
    const startTs = Math.floor(new Date(date + 'T00:00:00Z').getTime() / 1000);
    const endTs = Math.floor(new Date(date + 'T23:59:59Z').getTime() / 1000);
    let query = `SELECT m.*, u.display_name, u.avatar_url, c.name as channel_name
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.user_id
      LEFT JOIN channels c ON m.channel_id = c.channel_id
      WHERE CAST(m.ts AS DOUBLE PRECISION) >= $1 AND CAST(m.ts AS DOUBLE PRECISION) <= $2`;
    const params = [startTs, endTs];
    if (channelId) { query += ' AND m.channel_id = $3'; params.push(channelId); }
    query += ' ORDER BY CAST(m.ts AS DOUBLE PRECISION) ASC';
    return qa(query, params);
  },

  getRecent: async (limit = 100, channelId = null) => {
    let query = `SELECT m.*, u.display_name, u.avatar_url, c.name as channel_name
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.user_id
      LEFT JOIN channels c ON m.channel_id = c.channel_id`;
    const params = [];
    if (channelId) { query += ' WHERE m.channel_id = $1'; params.push(channelId); }
    query += ` ORDER BY CAST(m.ts AS DOUBLE PRECISION) DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    return qa(query, params);
  },

  count: () => q1('SELECT COUNT(*) as count FROM messages'),

  markAnalyzed: async (rows) => {
    if (!rows || rows.length === 0) return;
    const now = new Date().toISOString();
    for (const { ts, channel_id } of rows) {
      await q('UPDATE messages SET analyzed_at = $1 WHERE ts = $2 AND channel_id = $3', [now, ts, channel_id]);
    }
  },

  markAllUnanalyzed: () => q('UPDATE messages SET analyzed_at = NULL'),
};

// ── Sync state operations ─────────────────────────────────────────────────────
const syncOps = {
  get: (channelId) => q1('SELECT * FROM sync_state WHERE channel_id = $1', [channelId]),
  getAll: () => qa('SELECT * FROM sync_state'),
  update: (channelId, lastFetchedTs, messageCount) => q(`
    INSERT INTO sync_state (channel_id, last_fetched_ts, last_fetched_at, message_count)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT(channel_id) DO UPDATE SET
      last_fetched_ts = EXCLUDED.last_fetched_ts,
      last_fetched_at = EXCLUDED.last_fetched_at,
      message_count = sync_state.message_count + EXCLUDED.message_count
  `, [channelId, lastFetchedTs, new Date().toISOString(), messageCount]),
};

// ── Sync log operations ───────────────────────────────────────────────────────
const syncLogOps = {
  start: async () => {
    const row = await q1('INSERT INTO sync_log (started_at, status) VALUES ($1, $2) RETURNING id',
      [new Date().toISOString(), 'running']);
    return row.id;
  },
  complete: (id, channelsSynced, messagesFetched) => q(
    'UPDATE sync_log SET completed_at=$1, channels_synced=$2, messages_fetched=$3, status=$4 WHERE id=$5',
    [new Date().toISOString(), channelsSynced, messagesFetched, 'success', id]
  ),
  fail: (id, error) => q(
    'UPDATE sync_log SET completed_at=$1, status=$2, error=$3 WHERE id=$4',
    [new Date().toISOString(), 'error', error, id]
  ),
  getLast: (limit = 10) => qa('SELECT * FROM sync_log ORDER BY id DESC LIMIT $1', [limit]),
};

// ── Follow-up operations ──────────────────────────────────────────────────────
const followUpOps = {
  getAll: async (status = null) => {
    const priorityOrder = "CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END";
    if (status) return qa(`SELECT * FROM follow_ups WHERE status = $1 ORDER BY ${priorityOrder}, created_at DESC`, [status]);
    return qa(`SELECT * FROM follow_ups WHERE status NOT IN ('dismissed','candidate') ORDER BY ${priorityOrder}, created_at DESC`);
  },

  insert: (item) => q(`
    INSERT INTO follow_ups (text, channel_id, channel_name, message_ts, context, status, source, priority, task_type, source_messages, created_at)
    VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,$9,$10)
  `, [item.text, item.channel_id||null, item.channel_name||null, item.message_ts||null,
      item.context||null, item.source||'claude', item.priority||'medium', item.task_type||'task',
      item.source_messages ? JSON.stringify(item.source_messages) : null, new Date().toISOString()]),

  insertCandidate: (item) => q(`
    INSERT INTO follow_ups (text, channel_id, channel_name, message_ts, context, status, source, priority, task_type, source_messages, pre_resolved, created_at)
    VALUES ($1,$2,$3,$4,$5,'candidate',$6,$7,$8,$9,$10,$11)
  `, [item.text, item.channel_id||null, item.channel_name||null, item.message_ts||null,
      item.context||null, item.source||'claude', item.priority||'medium', item.task_type||'task',
      item.source_messages ? JSON.stringify(item.source_messages) : null,
      item.preResolved ? 1 : 0, new Date().toISOString()]),

  confirmAsResolved: (id) => q(
    "UPDATE follow_ups SET status='finished', resolved_at=$1, resolved_by='user' WHERE id=$2",
    [new Date().toISOString(), id]
  ),

  insertFinished: (item) => {
    const now = new Date().toISOString();
    return q(`
      INSERT INTO follow_ups (text, channel_id, channel_name, message_ts, context, status, source, priority, task_type, source_messages, resolution_evidence, created_at, resolved_at, resolved_by)
      VALUES ($1,$2,$3,$4,$5,'finished',$6,$7,$8,$9,$10,$11,$12,'claude')
    `, [item.text, item.channel_id||null, item.channel_name||null, item.message_ts||null,
        item.context||null, item.source||'claude', item.priority||'medium', item.task_type||'task',
        item.source_messages ? JSON.stringify(item.source_messages) : null,
        item.resolution_evidence||null, now, item.resolvedAt||now]);
  },

  confirm: (id) => q("UPDATE follow_ups SET status='open', resolved_at=NULL, resolved_by=NULL WHERE id=$1", [id]),

  resolve: (id, resolvedBy='user', evidence=null, resolvedAt=null) => {
    const ts = resolvedAt || new Date().toISOString();
    const evidenceStr = evidence === null ? null : typeof evidence === 'string' ? evidence : JSON.stringify(evidence);
    return q("UPDATE follow_ups SET status='finished', resolved_at=$1, resolved_by=$2, resolution_evidence=$3 WHERE id=$4",
      [ts, resolvedBy, evidenceStr, id]);
  },

  reopen: (id) => q("UPDATE follow_ups SET status='open', resolved_at=NULL, resolved_by=NULL, resolution_evidence=NULL WHERE id=$1", [id]),
  delete: (id) => q("UPDATE follow_ups SET status='dismissed' WHERE id=$1", [id]),
  restore: (id) => q("UPDATE follow_ups SET status='open', resolved_at=NULL, resolved_by=NULL WHERE id=$1", [id]),
  updatePriority: (id, priority) => q("UPDATE follow_ups SET priority=$1 WHERE id=$2", [priority, id]),
  clearCandidates: () => q("DELETE FROM follow_ups WHERE status='candidate'"),
  clearAll: () => q('DELETE FROM follow_ups'),

  getOpenTexts: () => qa("SELECT id, text, channel_name, context, source_messages FROM follow_ups WHERE status='open' ORDER BY created_at DESC"),
  getCandidateTexts: async () => (await qa("SELECT text FROM follow_ups WHERE status='candidate' ORDER BY created_at DESC")).map(r => r.text.toLowerCase()),
  getRecentFinishedTexts: async () => (await qa(
    "SELECT text FROM follow_ups WHERE status='finished' AND resolved_at >= (NOW() - INTERVAL '7 days')::TEXT ORDER BY resolved_at DESC"
  )).map(r => r.text.toLowerCase()),
  getAllFinishedTexts: async () => (await qa("SELECT text FROM follow_ups WHERE status='finished'")).map(r => r.text.toLowerCase()),
  getDismissedTexts: async () => (await qa(
    "SELECT text FROM follow_ups WHERE status='dismissed' AND created_at >= (NOW() - INTERVAL '30 days')::TEXT ORDER BY created_at DESC"
  )).map(r => r.text.toLowerCase()),
};

// ── Daily summary operations ──────────────────────────────────────────────────
const summaryOps = {
  get: (date) => q1('SELECT * FROM daily_summaries WHERE date=$1', [date]),
  getLatest: () => q1('SELECT * FROM daily_summaries ORDER BY date DESC LIMIT 1'),
  clearAll: () => q('DELETE FROM daily_summaries'),
  upsert: (date, summaryText, newestTs, messageCount) => q(`
    INSERT INTO daily_summaries (date, summary_text, messages_newest_ts, messages_count, generated_at)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT(date) DO UPDATE SET
      summary_text = EXCLUDED.summary_text,
      messages_newest_ts = EXCLUDED.messages_newest_ts,
      messages_count = EXCLUDED.messages_count,
      generated_at = EXCLUDED.generated_at
  `, [date, summaryText, newestTs, messageCount, new Date().toISOString()]),
};

// ── Monday.com operations ─────────────────────────────────────────────────────
const mondayOps = {
  getMembers: () => qa('SELECT * FROM monday_members ORDER BY id'),
  upsertMember: async (id, name, mondayUserId, isVideoTeam) => {
    if (id) {
      await q('UPDATE monday_members SET name=$1, monday_user_id=$2, is_video_team=$3 WHERE id=$4',
        [name, mondayUserId||'', isVideoTeam ? 1 : 0, id]);
    } else {
      await q("INSERT INTO monday_members (name, monday_user_id, is_video_team) VALUES ($1,$2,$3)",
        [name, mondayUserId||'', isVideoTeam ? 1 : 0]);
    }
  },
  deleteMember: (id) => q('DELETE FROM monday_members WHERE id=$1', [id]),

  getBoards: () => qa('SELECT * FROM monday_boards ORDER BY id'),
  upsertBoard: (boardId, label) => q(`
    INSERT INTO monday_boards (board_id, label) VALUES ($1,$2)
    ON CONFLICT(board_id) DO UPDATE SET label=EXCLUDED.label
  `, [String(boardId), label||'']),
  deleteBoard: (boardId) => q('DELETE FROM monday_boards WHERE board_id=$1', [String(boardId)]),

  loadAllBoardCacheEntries: async () => {
    const rows = await qa('SELECT board_id, name, items_json, status_colors_json, fetched_at FROM monday_board_cache');
    return rows.map(r => ({
      boardId: r.board_id, name: r.name,
      items: JSON.parse(r.items_json || '[]'),
      statusColors: JSON.parse(r.status_colors_json || '{}'),
      fetchedAt: r.fetched_at,
    }));
  },
  saveBoardCacheEntry: (boardId, name, items, statusColors, fetchedAt) => q(`
    INSERT INTO monday_board_cache (board_id, name, items_json, status_colors_json, fetched_at)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT(board_id) DO UPDATE SET
      name=EXCLUDED.name, items_json=EXCLUDED.items_json,
      status_colors_json=EXCLUDED.status_colors_json, fetched_at=EXCLUDED.fetched_at
  `, [String(boardId), name, JSON.stringify(items), JSON.stringify(statusColors), fetchedAt]),

  getAISummary: (memberId, weekEnding, type) =>
    q1('SELECT content, tasks_hash FROM monday_ai_summaries WHERE member_id=$1 AND week_ending=$2 AND summary_type=$3',
      [memberId, weekEnding, type]),
  saveAISummary: (memberId, weekEnding, type, content, tasksHash) => q(`
    INSERT INTO monday_ai_summaries (member_id, week_ending, summary_type, content, tasks_hash)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT(member_id, week_ending, summary_type)
    DO UPDATE SET content=EXCLUDED.content, tasks_hash=EXCLUDED.tasks_hash, created_at=NOW()::TEXT
  `, [memberId, weekEnding, type, content, tasksHash||null]),

  getCacheMeta: async (key) => {
    const row = await q1('SELECT value FROM monday_cache_meta WHERE key=$1', [key]);
    return row ? row.value : null;
  },
  setCacheMeta: (key, value) => q(`
    INSERT INTO monday_cache_meta (key, value) VALUES ($1,$2)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value
  `, [key, value]),

  getTasksCache: async (key) => {
    const row = await q1('SELECT data_json, fetched_at FROM monday_tasks_cache WHERE cache_key=$1', [key]);
    return row ? { data: JSON.parse(row.data_json), fetchedAt: row.fetched_at } : null;
  },
  setTasksCache: (key, data) => q(`
    INSERT INTO monday_tasks_cache (cache_key, data_json, fetched_at) VALUES ($1,$2,$3)
    ON CONFLICT(cache_key) DO UPDATE SET data_json=EXCLUDED.data_json, fetched_at=EXCLUDED.fetched_at
  `, [key, JSON.stringify(data), Date.now()]),
};

// ── Claude state operations ───────────────────────────────────────────────────
const claudeStateOps = {
  getLastTs: async () => {
    const row = await q1('SELECT last_analyzed_ts FROM claude_state WHERE id=1');
    return row?.last_analyzed_ts ?? null;
  },
  updateLastTs: async (ts) => {
    if (ts === null) { await q('DELETE FROM claude_state WHERE id=1'); return; }
    await q(`
      INSERT INTO claude_state (id, last_analyzed_ts, last_analyzed_at) VALUES (1,$1,$2)
      ON CONFLICT(id) DO UPDATE SET last_analyzed_ts=EXCLUDED.last_analyzed_ts, last_analyzed_at=EXCLUDED.last_analyzed_at
    `, [ts, new Date().toISOString()]);
  },
};

// ── Generic key-value store ───────────────────────────────────────────────────
const kvOps = {
  get: async (key) => {
    const row = await q1('SELECT value FROM kv_store WHERE key=$1', [key]);
    return row?.value ?? null;
  },
  set: (key, value) => q('INSERT INTO kv_store (key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value', [key, value]),
  del: (key) => q('DELETE FROM kv_store WHERE key=$1', [key]),
};

module.exports = { pool, initDb, tokenOps, userOps, channelOps, messageOps, syncOps, syncLogOps, followUpOps, summaryOps, claudeStateOps, mondayOps, kvOps };
