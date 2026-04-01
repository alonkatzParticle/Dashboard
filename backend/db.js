const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'slack_summary.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Migrate: add columns if they don't exist (runs after table creation below)

// Create all tables
db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
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
    last_fetched_ts INTEGER DEFAULT 0,
    last_fetched_at TEXT,
    message_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    channels_synced INTEGER DEFAULT 0,
    messages_fetched INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running',
    error TEXT
  );

  CREATE TABLE IF NOT EXISTS follow_ups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    channel_id TEXT,
    channel_name TEXT,
    message_ts TEXT,
    context TEXT,
    status TEXT DEFAULT 'open',
    source TEXT DEFAULT 'claude',
    priority TEXT DEFAULT 'medium',
    task_type TEXT DEFAULT 'task',
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    resolved_by TEXT
  );

  CREATE TABLE IF NOT EXISTS daily_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    summary_text TEXT,
    messages_newest_ts TEXT,
    messages_count INTEGER DEFAULT 0,
    generated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_summaries_date ON daily_summaries(date);

  CREATE TABLE IF NOT EXISTS claude_state (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    last_analyzed_ts TEXT,
    last_analyzed_at TEXT
  );
`);

// Migrations for existing DBs (safe to run on fresh DBs too — errors are suppressed)
try { db.exec('ALTER TABLE follow_ups ADD COLUMN resolution_evidence TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE follow_ups ADD COLUMN source_messages TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE messages ADD COLUMN analyzed_at TEXT'); } catch (_) {}
try { db.exec("ALTER TABLE follow_ups ADD COLUMN priority TEXT DEFAULT 'medium'"); } catch (_) {}
try { db.exec("ALTER TABLE follow_ups ADD COLUMN task_type TEXT DEFAULT 'task'"); } catch (_) {}
try { db.exec("ALTER TABLE follow_ups ADD COLUMN direction TEXT DEFAULT 'inbound'"); } catch (_) {}
try { db.exec("ALTER TABLE daily_summaries ADD COLUMN standup_text TEXT"); } catch (_) {}

// ── Monday.com integration tables ────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS monday_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    monday_user_id TEXT DEFAULT '',
    is_video_team INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS monday_boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id TEXT NOT NULL UNIQUE,
    label TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS monday_board_cache (
    board_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    items_json TEXT NOT NULL DEFAULT '[]',
    status_colors_json TEXT NOT NULL DEFAULT '{}',
    fetched_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS monday_tasks_cache (
    cache_key TEXT PRIMARY KEY,
    data_json TEXT NOT NULL,
    fetched_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS monday_tasks_cache (
    cache_key TEXT PRIMARY KEY,
    data_json TEXT NOT NULL,
    fetched_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS monday_ai_summaries (
    member_id INTEGER NOT NULL,
    week_ending TEXT NOT NULL,
    summary_type TEXT NOT NULL,
    content TEXT NOT NULL,
    tasks_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (member_id, week_ending, summary_type)
  );

  CREATE TABLE IF NOT EXISTS monday_cache_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Seed team members if table is empty
const memberCount = db.prepare('SELECT COUNT(*) as count FROM monday_members').get();
if (memberCount.count === 0) {
  const insertMember = db.prepare("INSERT INTO monday_members (name, monday_user_id, is_video_team) VALUES (?, '', 0)");
  const seedMembers = db.transaction(() => {
    ['Dan', 'Natalie', 'Matan', 'Isaac', 'Yael', 'Omri'].forEach(name => insertMember.run(name));
  });
  seedMembers();
  console.log('[DB] Seeded 6 team members: Dan, Natalie, Matan, Isaac, Yael, Omri');
}

// Token operations
const tokenOps = {
  get: () => db.prepare('SELECT * FROM tokens WHERE id = 1').get(),
  upsert: (accessToken, refreshToken, expiresAt) => {
    db.prepare(`
      INSERT INTO tokens (id, access_token, refresh_token, expires_at, updated_at)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `).run(accessToken, refreshToken, expiresAt, new Date().toISOString());
  }
};

// User operations
const userOps = {
  get: (userId) => db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId),
  upsert: (user) => {
    db.prepare(`
      INSERT INTO users (user_id, display_name, real_name, username, avatar_url, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        display_name = excluded.display_name,
        real_name = excluded.real_name,
        username = excluded.username,
        avatar_url = excluded.avatar_url,
        fetched_at = excluded.fetched_at
    `).run(user.user_id, user.display_name, user.real_name, user.username, user.avatar_url, new Date().toISOString());
  }
};

// Channel operations
const channelOps = {
  getAll: () => db.prepare('SELECT * FROM channels WHERE is_member = 1 ORDER BY name').all(),
  upsert: (channel) => {
    db.prepare(`
      INSERT INTO channels (channel_id, name, type, is_member, fetched_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        is_member = CASE WHEN is_member = 0 THEN 0 ELSE excluded.is_member END,
        fetched_at = excluded.fetched_at
    `).run(channel.channel_id, channel.name, channel.type, channel.is_member ? 1 : 0, new Date().toISOString());
  }
};

// Message operations
const messageOps = {
  upsert: (msg) => {
    db.prepare(`
      INSERT INTO messages (ts, channel_id, user_id, text, thread_ts, is_reply, has_replies, reply_count, reactions, message_type, raw_json, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ts, channel_id) DO UPDATE SET
        text = excluded.text,
        has_replies = excluded.has_replies,
        reply_count = excluded.reply_count,
        reactions = excluded.reactions,
        raw_json = excluded.raw_json,
        fetched_at = excluded.fetched_at
    `).run(
      msg.ts, msg.channel_id, msg.user_id, msg.text, msg.thread_ts,
      msg.is_reply ? 1 : 0, msg.has_replies ? 1 : 0, msg.reply_count || 0,
      JSON.stringify(msg.reactions || []), msg.message_type || 'message',
      JSON.stringify(msg.raw_json || {}), new Date().toISOString()
    );
  },
  getForDay: (date, channelId) => {
    const startTs = Math.floor(new Date(date + 'T00:00:00Z').getTime() / 1000);
    const endTs = Math.floor(new Date(date + 'T23:59:59Z').getTime() / 1000);
    let query = 'SELECT m.*, u.display_name, u.avatar_url, c.name as channel_name FROM messages m LEFT JOIN users u ON m.user_id = u.user_id LEFT JOIN channels c ON m.channel_id = c.channel_id WHERE CAST(m.ts AS REAL) >= ? AND CAST(m.ts AS REAL) <= ?';
    const params = [startTs, endTs];
    if (channelId) {
      query += ' AND m.channel_id = ?';
      params.push(channelId);
    }
    query += ' ORDER BY CAST(m.ts AS REAL) ASC';
    return db.prepare(query).all(...params);
  },
  getRecent: (limit = 100, channelId = null) => {
    let query = 'SELECT m.*, u.display_name, u.avatar_url, c.name as channel_name FROM messages m LEFT JOIN users u ON m.user_id = u.user_id LEFT JOIN channels c ON m.channel_id = c.channel_id';
    const params = [];
    if (channelId) {
      query += ' WHERE m.channel_id = ?';
      params.push(channelId);
    }
    query += ' ORDER BY CAST(m.ts AS REAL) DESC LIMIT ?';
    params.push(limit);
    return db.prepare(query).all(...params);
  },
  count: () => db.prepare('SELECT COUNT(*) as count FROM messages').get(),
  markAnalyzed: (rows) => {
    if (!rows || rows.length === 0) return;
    const stmt = db.prepare("UPDATE messages SET analyzed_at = ? WHERE ts = ? AND channel_id = ?");
    const now = new Date().toISOString();
    const markMany = db.transaction((items) => {
      for (const { ts, channel_id } of items) stmt.run(now, ts, channel_id);
    });
    markMany(rows);
  },
  markAllUnanalyzed: () => db.prepare("UPDATE messages SET analyzed_at = NULL").run()
};

// Sync state operations
const syncOps = {
  get: (channelId) => db.prepare('SELECT * FROM sync_state WHERE channel_id = ?').get(channelId),
  getAll: () => db.prepare('SELECT * FROM sync_state').all(),
  update: (channelId, lastFetchedTs, messageCount) => {
    db.prepare(`
      INSERT INTO sync_state (channel_id, last_fetched_ts, last_fetched_at, message_count)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET
        last_fetched_ts = excluded.last_fetched_ts,
        last_fetched_at = excluded.last_fetched_at,
        message_count = message_count + excluded.message_count
    `).run(channelId, lastFetchedTs, new Date().toISOString(), messageCount);
  }
};

// Sync log operations
const syncLogOps = {
  start: () => {
    const result = db.prepare('INSERT INTO sync_log (started_at, status) VALUES (?, ?)').run(new Date().toISOString(), 'running');
    return result.lastInsertRowid;
  },
  complete: (id, channelsSynced, messagesFetched) => {
    db.prepare('UPDATE sync_log SET completed_at = ?, channels_synced = ?, messages_fetched = ?, status = ? WHERE id = ?')
      .run(new Date().toISOString(), channelsSynced, messagesFetched, 'success', id);
  },
  fail: (id, error) => {
    db.prepare('UPDATE sync_log SET completed_at = ?, status = ?, error = ? WHERE id = ?')
      .run(new Date().toISOString(), 'error', error, id);
  },
  getLast: (limit = 10) => db.prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT ?').all(limit)
};

// Follow-up operations
const followUpOps = {
  getAll: (status = null) => {
    const priorityOrder = "CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END";
    if (status) return db.prepare(`SELECT * FROM follow_ups WHERE status = ? ORDER BY ${priorityOrder}, created_at DESC`).all(status);
    return db.prepare(`SELECT * FROM follow_ups WHERE status NOT IN ('dismissed','candidate') ORDER BY ${priorityOrder}, created_at DESC`).all();
  },
  insert: (item) => {
    return db.prepare(`
      INSERT INTO follow_ups (text, channel_id, channel_name, message_ts, context, status, source, priority, task_type, source_messages, created_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
    `).run(item.text, item.channel_id || null, item.channel_name || null, item.message_ts || null,
      item.context || null, item.source || 'claude',
      item.priority || 'medium', item.task_type || 'task',
      item.source_messages ? JSON.stringify(item.source_messages) : null,
      new Date().toISOString());
  },
  insertCandidate: (item) => {
    return db.prepare(`
      INSERT INTO follow_ups (text, channel_id, channel_name, message_ts, context, status, source, priority, task_type, source_messages, created_at)
      VALUES (?, ?, ?, ?, ?, 'candidate', ?, ?, ?, ?, ?)
    `).run(item.text, item.channel_id || null, item.channel_name || null, item.message_ts || null,
      item.context || null, item.source || 'claude',
      item.priority || 'medium', item.task_type || 'task',
      item.source_messages ? JSON.stringify(item.source_messages) : null,
      new Date().toISOString());
  },
  insertFinished: (item) => {
    const now = new Date().toISOString();
    const resolvedAt = item.resolvedAt || now;
    return db.prepare(`
      INSERT INTO follow_ups (text, channel_id, channel_name, message_ts, context, status, source, priority, task_type, source_messages, resolution_evidence, created_at, resolved_at, resolved_by)
      VALUES (?, ?, ?, ?, ?, 'finished', ?, ?, ?, ?, ?, ?, ?, 'claude')
    `).run(item.text, item.channel_id || null, item.channel_name || null, item.message_ts || null,
      item.context || null, item.source || 'claude',
      item.priority || 'medium', item.task_type || 'task',
      item.source_messages ? JSON.stringify(item.source_messages) : null,
      item.resolution_evidence || null,
      now, resolvedAt);
  },
  confirm: (id) => {
    db.prepare("UPDATE follow_ups SET status = 'open', resolved_at = NULL, resolved_by = NULL WHERE id = ?").run(id);
  },
  resolve: (id, resolvedBy = 'user', evidence = null, resolvedAt = null) => {
    const ts = resolvedAt || new Date().toISOString();
    // evidence may be a JSON string (from claude.js) or a raw array (from manual resolve) — normalize to string
    const evidenceStr = evidence === null ? null
      : typeof evidence === 'string' ? evidence
      : JSON.stringify(evidence);
    db.prepare(`UPDATE follow_ups SET status = 'finished', resolved_at = ?, resolved_by = ?, resolution_evidence = ? WHERE id = ?`)
      .run(ts, resolvedBy, evidenceStr, id);
  },
  reopen: (id) => {
    db.prepare(`UPDATE follow_ups SET status = 'open', resolved_at = NULL, resolved_by = NULL, resolution_evidence = NULL WHERE id = ?`).run(id);
  },
  delete: (id) => {
    // Soft delete — keeps the text so Claude won't re-add it on refresh
    db.prepare("UPDATE follow_ups SET status = 'dismissed' WHERE id = ?").run(id);
  },
  restore: (id) => {
    // Bring a dismissed task back to open
    db.prepare("UPDATE follow_ups SET status = 'open', resolved_at = NULL, resolved_by = NULL WHERE id = ?").run(id);
  },
  clearCandidates: () => {
    // Wipe all candidates — called on force-refresh so the Review tab reflects only the latest run
    db.prepare("DELETE FROM follow_ups WHERE status = 'candidate'").run();
  },
  clearAll: () => {
    // Full wipe — force refresh starts from a clean slate
    db.prepare('DELETE FROM follow_ups').run();
  },
  getOpenTexts: () => db.prepare("SELECT id, text, channel_name, context, source_messages FROM follow_ups WHERE status = 'open' ORDER BY created_at DESC").all(),
  getCandidateTexts: () => db.prepare(`
    SELECT text FROM follow_ups
    WHERE status = 'candidate'
    ORDER BY created_at DESC
  `).all().map(r => r.text.toLowerCase()),
  getRecentFinishedTexts: () => db.prepare(`
    SELECT text FROM follow_ups
    WHERE status = 'finished'
      AND resolved_at >= date('now', 'weekday 0', '-7 days', '+3 hours')
    ORDER BY resolved_at DESC
  `).all().map(r => r.text.toLowerCase()),
  getAllFinishedTexts: () => db.prepare(`
    SELECT text FROM follow_ups WHERE status = 'finished'
  `).all().map(r => r.text.toLowerCase()),
  getDismissedTexts: () => db.prepare(`
    SELECT text FROM follow_ups
    WHERE status = 'dismissed'
      AND created_at >= datetime('now', '-30 days')
    ORDER BY created_at DESC
  `).all().map(r => r.text.toLowerCase())
};

// Daily summary operations
const summaryOps = {
  get: (date) => db.prepare('SELECT * FROM daily_summaries WHERE date = ?').get(date),
  getLatest: () => db.prepare('SELECT * FROM daily_summaries ORDER BY date DESC LIMIT 1').get(),
  clearAll: () => db.prepare('DELETE FROM daily_summaries').run(),
  upsert: (date, summaryText, newestTs, messageCount) => {
    db.prepare(`
      INSERT INTO daily_summaries (date, summary_text, messages_newest_ts, messages_count, generated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        summary_text = excluded.summary_text,
        messages_newest_ts = excluded.messages_newest_ts,
        messages_count = excluded.messages_count,
        generated_at = excluded.generated_at
    `).run(date, summaryText, newestTs, messageCount, new Date().toISOString());
  }
};

// Monday.com settings operations
const mondayOps = {
  getMembers: () => db.prepare('SELECT * FROM monday_members ORDER BY id').all(),
  upsertMember: (id, name, mondayUserId, isVideoTeam) => {
    if (id) {
      db.prepare('UPDATE monday_members SET name=?, monday_user_id=?, is_video_team=? WHERE id=?')
        .run(name, mondayUserId || '', isVideoTeam ? 1 : 0, id);
    } else {
      db.prepare("INSERT INTO monday_members (name, monday_user_id, is_video_team) VALUES (?, ?, ?)")
        .run(name, mondayUserId || '', isVideoTeam ? 1 : 0);
    }
  },
  deleteMember: (id) => db.prepare('DELETE FROM monday_members WHERE id=?').run(id),
  getBoards: () => db.prepare('SELECT * FROM monday_boards ORDER BY id').all(),
  upsertBoard: (boardId, label) => {
    db.prepare('INSERT INTO monday_boards (board_id, label) VALUES (?, ?) ON CONFLICT(board_id) DO UPDATE SET label=excluded.label')
      .run(String(boardId), label || '');
  },
  deleteBoard: (boardId) => db.prepare('DELETE FROM monday_boards WHERE board_id=?').run(String(boardId)),

  // Board cache persistence
  loadAllBoardCacheEntries: () => {
    const rows = db.prepare('SELECT board_id, name, items_json, status_colors_json, fetched_at FROM monday_board_cache').all();
    return rows.map(r => ({
      boardId: r.board_id,
      name: r.name,
      items: JSON.parse(r.items_json || '[]'),
      statusColors: JSON.parse(r.status_colors_json || '{}'),
      fetchedAt: r.fetched_at,
    }));
  },
  saveBoardCacheEntry: (boardId, name, items, statusColors, fetchedAt) => {
    db.prepare(`
      INSERT INTO monday_board_cache (board_id, name, items_json, status_colors_json, fetched_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(board_id) DO UPDATE SET
        name = excluded.name,
        items_json = excluded.items_json,
        status_colors_json = excluded.status_colors_json,
        fetched_at = excluded.fetched_at
    `).run(String(boardId), name, JSON.stringify(items), JSON.stringify(statusColors), fetchedAt);
  },

  // AI summary cache
  getAISummary: (memberId, weekEnding, type) => {
    return db.prepare('SELECT content, tasks_hash FROM monday_ai_summaries WHERE member_id=? AND week_ending=? AND summary_type=?')
      .get(memberId, weekEnding, type) || null;
  },
  saveAISummary: (memberId, weekEnding, type, content, tasksHash) => {
    db.prepare(`
      INSERT INTO monday_ai_summaries (member_id, week_ending, summary_type, content, tasks_hash)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(member_id, week_ending, summary_type)
      DO UPDATE SET content=excluded.content, tasks_hash=excluded.tasks_hash, created_at=datetime('now')
    `).run(memberId, weekEnding, type, content, tasksHash || null);
  },

  // Cache meta (last_synced etc.)
  getCacheMeta: (key) => {
    const row = db.prepare('SELECT value FROM monday_cache_meta WHERE key=?').get(key);
    return row ? row.value : null;
  },
  setCacheMeta: (key, value) => {
    db.prepare('INSERT INTO monday_cache_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, value);
  },

  // Tasks cache — local-first instant loading
  getTasksCache: (key) => {
    const row = db.prepare('SELECT data_json, fetched_at FROM monday_tasks_cache WHERE cache_key = ?').get(key);
    return row ? { data: JSON.parse(row.data_json), fetchedAt: row.fetched_at } : null;
  },
  setTasksCache: (key, data) => {
    db.prepare(`
      INSERT INTO monday_tasks_cache (cache_key, data_json, fetched_at)
      VALUES (?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET data_json=excluded.data_json, fetched_at=excluded.fetched_at
    `).run(key, JSON.stringify(data), Date.now());
  },
};

// Claude state operations (tracks message watermark)
const claudeStateOps = {
  getLastTs: () => {
    const row = db.prepare('SELECT last_analyzed_ts FROM claude_state WHERE id = 1').get();
    return row?.last_analyzed_ts || null;
  },
  updateLastTs: (ts) => {
    if (ts === null) {
      db.prepare('DELETE FROM claude_state WHERE id = 1').run();
      return;
    }
    db.prepare(`
      INSERT INTO claude_state (id, last_analyzed_ts, last_analyzed_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        last_analyzed_ts = excluded.last_analyzed_ts,
        last_analyzed_at = excluded.last_analyzed_at
    `).run(ts, new Date().toISOString());
  }
};

module.exports = { db, tokenOps, userOps, channelOps, messageOps, syncOps, syncLogOps, followUpOps, summaryOps, claudeStateOps, mondayOps };

