require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { db, channelOps, messageOps, syncOps, syncLogOps, tokenOps, followUpOps, summaryOps, mondayOps } = require('./db');
const { startPoller, runSync, getSyncStatus } = require('./poller');
const { generateSummary, getIsraelDate, getProcessingState } = require('./claude');
const { clearBoardCache, loadBoardCacheFromDb, incrementalSync, fetchAllBoardTasks, fetchTeamTasks, fetchDailyActivity } = require('./monday_boards');
const { encodeDropboxArg, getDropboxToken, uploadToDropbox } = require('./dropbox_lib');
const Anthropic = require('@anthropic-ai/sdk');


const app = express();
app.use(cors());
app.use(express.json());

// GET /api/status - overall sync status
app.get('/api/status', (req, res) => {
  const syncStatus = getSyncStatus();
  const tokens = tokenOps.get();
  const messageCount = messageOps.count();
  const channels = channelOps.getAll();
  const recentLogs = syncLogOps.getLast(5);
  const { getWeekStartTs } = require('./timeUtils');
  const weekStart = getWeekStartTs();
  const unanalyzedCount = db.prepare(
    `SELECT COUNT(*) as cnt FROM messages WHERE analyzed_at IS NULL AND CAST(ts AS REAL) >= ? AND text != '' AND is_reply = 0`
  ).get(weekStart).cnt;

  res.json({
    sync: syncStatus,
    tokens: {
      hasToken: !!tokens,
      expiresAt: tokens?.expires_at ? new Date(tokens.expires_at).toISOString() : null,
      expiresInMinutes: tokens?.expires_at ? Math.round((tokens.expires_at - Date.now()) / 60000) : null
    },
    stats: {
      totalMessages: messageCount.count,
      totalChannels: channels.length,
      unanalyzedCount
    },
    recentSyncs: recentLogs
  });
});

// GET /api/channels - list all synced channels
app.get('/api/channels', (req, res) => {
  const channels = channelOps.getAll();
  const syncStates = syncOps.getAll();

  const stateMap = {};
  for (const s of syncStates) stateMap[s.channel_id] = s;

  // Get latest message ts per channel for sorting
  const latestTs = db.prepare(
    `SELECT channel_id, MAX(CAST(ts AS REAL)) as last_ts FROM messages GROUP BY channel_id`
  ).all();
  const latestTsMap = {};
  for (const r of latestTs) latestTsMap[r.channel_id] = r.last_ts;

  const result = channels
    .map(ch => ({
      ...ch,
      lastFetched: stateMap[ch.channel_id]?.last_fetched_at || null,
      messageCount: stateMap[ch.channel_id]?.message_count || 0,
      lastMessageTs: latestTsMap[ch.channel_id] || 0
    }))
    .sort((a, b) => b.lastMessageTs - a.lastMessageTs);

  res.json(result);
});

// GET /api/users - user ID → display name map for resolving @mentions in the UI
app.get('/api/users', (req, res) => {
  try {
    const users = db.prepare('SELECT user_id, display_name FROM users WHERE display_name IS NOT NULL').all();
    const map = {};
    for (const u of users) map[u.user_id] = u.display_name;
    res.json(map);
  } catch (err) { res.json({}); }
});

// GET /api/messages - get messages with optional filters
app.get('/api/messages', (req, res) => {
  const { channel, date, limit = 100 } = req.query;

  let messages;
  if (date) {
    messages = messageOps.getForDay(date, channel || null);
  } else {
    messages = messageOps.getRecent(parseInt(limit), channel || null);
  }

  res.json(messages);
});

// POST /api/sync - manually trigger a sync
app.post('/api/sync', async (req, res) => {
  try {
    const result = await runSync(true);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/summary
app.get('/api/summary', (req, res) => {
  const today = getIsraelDate(0);
  const cached = summaryOps.get(today);
  res.json({
    date: today, cached: !!cached,
    summary: cached?.summary_text || null,
    generatedAt: cached?.generated_at || null,
    followUps: followUpOps.getAll('open'),
    inProgress: followUpOps.getAll('in_progress'),
    finished: followUpOps.getAll('finished'),
    dismissed: followUpOps.getAll('dismissed'),
    candidates: followUpOps.getAll('candidate')
  });
});

// POST /api/summary/reset — full analysis reset: unanalyze all messages + clear all tasks/summaries
app.post('/api/summary/reset', (req, res) => {
  try {
    messageOps.markAllUnanalyzed();
    followUpOps.clearAll();
    summaryOps.clearAll();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/summary/generate — fire and forget, returns immediately
app.post('/api/summary/generate', (req, res) => {
  const { force = false } = req.body || {};
  const state = getProcessingState();
  if (state.running) {
    return res.json({ status: 'already_running', progress: state });
  }
  // Start in background — do NOT await
  generateSummary(force).catch(err => console.error('[API] Summary generation error:', err.message));
  res.json({ status: 'processing', startedAt: new Date().toISOString() });
});

// GET /api/summary/status — poll this for progress
app.get('/api/summary/status', (req, res) => {
  const state = getProcessingState();
  const today = getIsraelDate(0);
  if (state.running) {
    return res.json({
      status: 'processing',
      progress: {
        channelsDone: state.channelsDone,
        channelsTotal: state.channelsTotal,
        currentChannel: state.currentChannel
      }
    });
  }
  if (state.lastResult) {
    const result = state.lastResult;
    result.dismissed = followUpOps.getAll('dismissed');
    result.candidates = followUpOps.getAll('candidate');
    return res.json({ status: 'done', result });
  }
  // Idle — return cached data
  const cached = summaryOps.get(today);
  return res.json({
    status: 'idle',
    result: {
      summary: cached?.summary_text || null,
      followUps: followUpOps.getAll('open'),
      finished: followUpOps.getAll('finished'),
      dismissed: followUpOps.getAll('dismissed'),
      candidates: followUpOps.getAll('candidate'),
      generatedAt: cached?.generated_at || null
    }
  });
});

// Helper: return all list state after any mutation
const allLists = () => ({
  ok: true,
  followUps: followUpOps.getAll('open'),
  inProgress: followUpOps.getAll('in_progress'),
  finished: followUpOps.getAll('finished'),
  dismissed: followUpOps.getAll('dismissed'),
  candidates: followUpOps.getAll('candidate')
});

// GET /api/follow-ups - list follow-ups
app.get('/api/follow-ups', (req, res) => {
  const { status } = req.query;
  res.json(followUpOps.getAll(status || null));
});

// POST /api/follow-ups - manually add a follow-up
app.post('/api/follow-ups', (req, res) => {
  const { text, channel_name, context, priority, task_type } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });
  followUpOps.insert({ text, channel_name, context, priority: priority || 'medium', task_type: task_type || 'task', source: 'user' });
  res.json({ ok: true, followUps: followUpOps.getAll('open') });
});
// Aliases: no-dash + POST for resolve/reopen (frontend convention)
app.post('/api/followups', (req, res) => {
  const { text, channel_name, context, priority, task_type } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });
  followUpOps.insert({ text, channel_name, context, priority: priority || 'medium', task_type: task_type || 'task', source: 'user' });
  res.json({ ok: true, followUps: followUpOps.getAll('open') });
});
app.post('/api/followups/:id/resolve', (req, res) => { followUpOps.resolve(parseInt(req.params.id), 'user'); res.json(allLists()); });
app.post('/api/followups/:id/reopen',  (req, res) => { followUpOps.reopen(parseInt(req.params.id)); res.json(allLists()); });
app.delete('/api/followups/:id',       (req, res) => { followUpOps.delete(parseInt(req.params.id)); res.json(allLists()); });
app.patch('/api/followups/:id/status', (req, res) => {
  const id = parseInt(req.params.id);
  const { status } = req.body;
  if (!['open', 'in_progress', 'done'].includes(status)) return res.status(400).json({ error: 'invalid status' });
  if (status === 'done') {
    followUpOps.resolve(id, 'user');
  } else if (status === 'open') {
    followUpOps.reopen(id);
  } else {
    db.prepare("UPDATE follow_ups SET status = ? WHERE id = ?").run('in_progress', id);
  }
  res.json(allLists());
});

// PATCH /api/follow-ups/:id/resolve
app.patch('/api/follow-ups/:id/resolve', (req, res) => {
  followUpOps.resolve(parseInt(req.params.id), 'user');
  res.json(allLists());
});
// PATCH /api/follow-ups/:id/reopen
app.patch('/api/follow-ups/:id/reopen', (req, res) => {
  followUpOps.reopen(parseInt(req.params.id));
  res.json(allLists());
});
// PATCH /api/follow-ups/:id/restore - dismissed → open
app.patch('/api/follow-ups/:id/restore', (req, res) => {
  followUpOps.restore(parseInt(req.params.id));
  res.json(allLists());
});
// PATCH /api/follow-ups/:id/confirm - candidate → open
app.patch('/api/follow-ups/:id/confirm', (req, res) => {
  followUpOps.confirm(parseInt(req.params.id));
  res.json(allLists());
});
// DELETE /api/follow-ups/:id - soft delete (dismiss)
app.delete('/api/follow-ups/:id', (req, res) => {
  followUpOps.delete(parseInt(req.params.id));
  res.json(allLists());
});

// GET /api/summary/generate — SSE streaming endpoint (frontend connects via EventSource)
app.get('/api/summary/generate', async (req, res) => {
  const force = req.query.force === 'true';
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const state = getProcessingState();
  if (state.running) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'already_running' })}\n\n`);
    return res.end();
  }

  const sendProgress = (data) => {
    try { res.write(`event: progress\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) {}
  };

  try {
    await generateSummary(force, sendProgress);
    const today = getIsraelDate(0);
    const cached = summaryOps.get(today);
    res.write(`event: done\ndata: ${JSON.stringify({ ok: true, summary: cached?.summary_text || null })}\n\n`);
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
  }
  res.end();
});

// POST /api/standup/generate — generate a standup from recent activity + tasks
app.post('/api/standup/generate', async (req, res) => {
  try {
    const { generateStandup } = require('./claude');
    const standup = await generateStandup();
    res.json({ standup });
  } catch (err) {
    console.error('[Standup] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// Monday.com Settings
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/monday/settings
app.get('/api/monday/settings', (req, res) => {
  const members = mondayOps.getMembers();
  const boards = mondayOps.getBoards();
  res.json({ members, boards });
});

// POST /api/monday/settings/members
app.post('/api/monday/settings/members', (req, res) => {
  const { id, name, monday_user_id, is_video_team } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  mondayOps.upsertMember(id || null, name, monday_user_id || '', is_video_team || false);
  res.json({ ok: true });
});

// DELETE /api/monday/settings/members/:id
app.delete('/api/monday/settings/members/:id', (req, res) => {
  mondayOps.deleteMember(req.params.id);
  res.json({ ok: true });
});

// POST /api/monday/settings/boards
app.post('/api/monday/settings/boards', (req, res) => {
  const { board_id, label } = req.body;
  if (!board_id) return res.status(400).json({ error: 'board_id required' });
  mondayOps.upsertBoard(board_id, label || '');
  res.json({ ok: true });
});

// DELETE /api/monday/settings/boards/:boardId
app.delete('/api/monday/settings/boards/:boardId', (req, res) => {
  mondayOps.deleteBoard(req.params.boardId);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// Status Report
// ══════════════════════════════════════════════════════════════════════════════

function toTitleCase(name) {
  return name.replace(/\b\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// GET /api/status-report — high/critical open tasks by board + completed today
app.get('/api/status-report', async (req, res) => {
  try {
    const token = process.env.MONDAY_API_TOKEN;
    if (!token) return res.status(500).json({ error: 'MONDAY_API_TOKEN not set' });
    const force = req.query.force === 'true';
    const boards = mondayOps.getBoards();
    const members = mondayOps.getMembers();
    const boardIds = boards.map(b => b.board_id);
    if (boardIds.length === 0) return res.json({ tasksByBoard: {}, completedToday: [] });
    if (force) clearBoardCache();

    const memberMap = {};
    for (const m of members) { if (m.monday_user_id) memberMap[String(m.monday_user_id)] = m.name; }

    const allTasks = await fetchAllBoardTasks(boardIds, token, force);
    const today = new Date().toISOString().slice(0, 10);

    const filtered = allTasks.filter(t => {
      const priority = (t.priority ?? '').toLowerCase();
      const status = (t.status ?? '').toLowerCase();
      return /high|critical/.test(priority) && !/done|complet/.test(status);
    });

    const completedTodayRaw = allTasks.filter(t => {
      const priority = (t.priority ?? '').toLowerCase();
      const status = (t.status ?? '').toLowerCase();
      return /high|critical/.test(priority) && /done|complet/.test(status) && t.timeline_end === today;
    });

    const resolveNames = tasks => tasks.map(t => ({
      ...t,
      assignee_names: t.assignee_ids.map(id => memberMap[id] ? toTitleCase(memberMap[id]) : null).filter(Boolean),
    }));

    const withNames = resolveNames(filtered);
    const completedToday = resolveNames(completedTodayRaw);

    const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2 };
    const tasksByBoard = {};
    for (const task of withNames) {
      if (!tasksByBoard[task.board_name]) tasksByBoard[task.board_name] = [];
      tasksByBoard[task.board_name].push(task);
    }
    for (const board in tasksByBoard) {
      tasksByBoard[board].sort((a, b) =>
        (PRIORITY_ORDER[a.priority.toLowerCase()] ?? 3) - (PRIORITY_ORDER[b.priority.toLowerCase()] ?? 3)
      );
    }
    res.json({ tasksByBoard, completedToday });
  } catch (err) {
    console.error('[status-report]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/status-report/summary — streaming Claude boss update
app.post('/api/status-report/summary', async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
    const { tasksByBoard = {}, completedToday = [], tasks = [] } = req.body;

    let prompt;

    if (tasks.length > 0) {
      // Standup page: flat array of completed follow-up tasks
      const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2 };
      const sorted = [...tasks].sort((a, b) =>
        (PRIORITY_ORDER[a.priority?.toLowerCase()] ?? 3) - (PRIORITY_ORDER[b.priority?.toLowerCase()] ?? 3)
      );
      const lines = sorted.map(t =>
        `- ${t.text}${t.channel_name ? ` (from #${t.channel_name})` : ''}`
      );
      prompt = `You are Alon Katz, a creative studio manager. Write a brief end-of-day update to your boss summarizing what you accomplished today.

Write it as a clean bullet list in first person (e.g. "I completed…", "I sent…", "I followed up on…"). 
- Do NOT mention priority levels
- Do NOT use section headers
- Keep each bullet to one sentence, natural and direct
- Sound like a human reporting in, not a system log

Tasks completed today:
${lines.join('\n')}

Update:`;
    } else {
      // Status Report page: tasks by board (open items)
      const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2 };
      const allTasks = [];
      for (const [board, bTasks] of Object.entries(tasksByBoard)) {
        for (const t of bTasks) allTasks.push({ ...t, board_name: board });
      }
      allTasks.sort((a, b) => (PRIORITY_ORDER[a.priority?.toLowerCase()] ?? 3) - (PRIORITY_ORDER[b.priority?.toLowerCase()] ?? 3));

      const lines = allTasks.map(t => {
        const assignees = (t.assignee_names ?? []).join(', ') || 'Unassigned';
        return `- ${t.name} | ${t.priority} | ${t.status || 'No status'} | ${t.board_name} | Assigned: ${assignees}`;
      });

      const completedLines = completedToday.map(t => {
        const assignees = (t.assignee_names ?? []).join(', ') || 'Unassigned';
        return `- ${t.name} | Board: ${t.board_name} | Assigned: ${assignees}`;
      });

      const completedSection = completedLines.length > 0
        ? `\nCompleted today (high/critical tasks closed out):\n${completedLines.join('\n')}`
        : '';

      prompt = `You are a creative studio manager writing a brief status update for your boss.

Below are the high and critical priority tasks currently open, plus any high/critical tasks completed today. Write a concise, professional status update using markdown. Structure it with these sections:
- # [title]
- ## Completed Today — only if there are completed tasks; celebrate wins briefly
- ## Critical Items — only if any critical priority tasks exist. Group tasks by assignee using ### Assignee Name subsections. For each task include its status in brackets: "Task Name [Status]"
- ## In Progress — open high-priority work structured as:
  ### Board/Team Name
  #### Person Name
  - **Task Name** - one short sentence description [Status]
  Group by board first (### heading), then by person within that board (#### heading). Every task must show status in brackets.
- ## Next Steps — 2-3 action items max

Keep it scannable and direct. This goes straight to a boss.

Current open tasks (format: name | priority | status | board | assigned):
${lines.join('\n')}${completedSection}

Status Update:`;
    }

    const client = new Anthropic({ apiKey });
    const stream = await client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        res.write(chunk.delta.text);
      }
    }
    res.end();
  } catch (err) {
    console.error('[status-report/summary]', err);
    res.status(500).json({ error: err.message });
  }
});


// GET /api/status-report/daily — today's completed + in-progress from activity logs
app.get('/api/status-report/daily', async (req, res) => {
  try {
    const token = process.env.MONDAY_API_TOKEN;
    if (!token) return res.status(500).json({ error: 'MONDAY_API_TOKEN not set' });
    const force = req.query.force === 'true';
    const boards = mondayOps.getBoards();
    const members = mondayOps.getMembers();
    const boardIds = boards.map(b => b.board_id);
    if (boardIds.length === 0) return res.json({ completedToday: [], inProgress: [], date: new Date().toISOString().slice(0, 10) });
    if (force) clearBoardCache();

    const memberMap = {};
    for (const m of members) { if (m.monday_user_id) memberMap[String(m.monday_user_id)] = m.name; }

    const { completedToday, inProgress } = await fetchDailyActivity(boardIds, token, force);
    const resolveNames = tasks => tasks.map(t => ({
      ...t,
      assignee_names: t.assignee_ids.map(id => memberMap[id] ? toTitleCase(memberMap[id]) : null).filter(Boolean),
    }));

    res.json({ completedToday: resolveNames(completedToday), inProgress: resolveNames(inProgress), date: new Date().toISOString().slice(0, 10) });
  } catch (err) {
    console.error('[status-report/daily]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/status-report/daily-summary — streaming Claude daily summary
app.post('/api/status-report/daily-summary', async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
    const { completedToday = [], inProgress = [], date = '' } = req.body;

    const completedList = completedToday.map(t =>
      `- ${t.name} (${t.board_name})${t.assignee_names?.length ? ' — ' + t.assignee_names.join(', ') : ''} [${t.status}]`
    ).join('\n') || 'None';

    const inProgressList = inProgress.map(t =>
      `- ${t.name} (${t.board_name})${t.assignee_names?.length ? ' — ' + t.assignee_names.join(', ') : ''} [${t.status}]${t.timeline_end ? ` Due: ${t.timeline_end}` : ''}`
    ).join('\n') || 'None';

    const prompt = `You are a creative studio manager writing a brief daily update for your boss for ${date || 'today'}.

Write 2-3 short paragraphs covering: what was completed today, what the team is currently working on, and any blockers or urgent items. Be direct and specific. Use the task names.

Completed today:\n${completedList}\n\nIn progress:\n${inProgressList}\n\nDaily Update:`;

    const client = new Anthropic({ apiKey });
    const stream = await client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        res.write(chunk.delta.text);
      }
    }
    res.end();
  } catch (err) {
    console.error('[status-report/daily-summary]', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Weekly Report & Studio
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/monday/team-tasks — last week + this week tasks per member
app.get('/api/monday/team-tasks', async (req, res) => {
  try {
    const token = process.env.MONDAY_API_TOKEN;
    if (!token) return res.status(500).json({ error: 'MONDAY_API_TOKEN not set' });
    const { week_start, week_end, next_week_start, next_week_end, force } = req.query;
    const boardIds = mondayOps.getBoards().map(b => b.board_id);
    const members = mondayOps.getMembers().filter(m => m.monday_user_id);
    const validUserIds = members.map(m => String(m.monday_user_id));
    if (boardIds.length === 0 || validUserIds.length === 0) return res.json({});
    if (force === 'true') clearBoardCache();

    // Fetch tasks for last week and this week in parallel
    const [lastWeekByUser, thisWeekByUser] = await Promise.all([
      fetchTeamTasks(boardIds, validUserIds, token, week_start, week_end, force === 'true'),
      fetchTeamTasks(boardIds, validUserIds, token, next_week_start, next_week_end, force === 'true'),
    ]);

    const result = {};
    for (const m of members) {
      const uid = String(m.monday_user_id);
      const allLastWeek = (lastWeekByUser[uid] ?? []).filter(t => {
        if (!t.timeline_end) return false;
        return t.timeline_end >= week_start && t.timeline_end <= week_end;
      });
      const allThisWeek = (thisWeekByUser[uid] ?? []).filter(t => {
        if (!t.timeline_start && !t.timeline_end) return false;
        const start = t.timeline_start ?? t.timeline_end;
        const end = t.timeline_end ?? t.timeline_start;
        return end >= next_week_start && start <= next_week_end;
      });
      result[uid] = { lastWeek: allLastWeek, thisWeek: allThisWeek };
    }
    res.json(result);
  } catch (err) {
    console.error('[monday/team-tasks]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/studio-summary — streaming Claude studio summary per member
app.post('/api/ai/studio-summary', async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
    const { memberName, tasks = [], type = 'studio_last' } = req.body;

    const high = tasks.filter(t => /high|critical/i.test(t.priority));
    const other = tasks.filter(t => !/high|critical/i.test(t.priority));
    const highList = high.length > 0 ? high.map(t => `- ${t.name} (${t.board_name})`).join('\n') : 'None';
    const otherList = other.length > 0 ? other.map(t => `- ${t.name} (${t.board_name})`).join('\n') : 'None';

    const isLast = type === 'studio_last';
    const prompt = `You are writing a brief studio overview entry for ${memberName}'s work ${isLast ? 'last week' : 'this week'}.

${isLast ? 'HIGH/CRITICAL priority tasks completed' : 'HIGH/CRITICAL priority tasks coming up'}:
${highList}

${isLast ? 'MEDIUM/LOW priority tasks completed' : 'MEDIUM/LOW priority tasks coming up'}:
${otherList}

Write 4-6 bullet points. Use short, punchy fragments — not full sentences. Think quick scan notes, not prose. Name high/critical tasks specifically. Group medium/low into brief summary bullets. Third person. No filler words. Start each bullet with "•".

${isLast ? 'Summary' : 'Preview'}:`;

    const client = new Anthropic({ apiKey });
    const stream = await client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        res.write(chunk.delta.text);
      }
    }
    res.end();
  } catch (err) {
    console.error('[ai/studio-summary]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/team-summary — streaming Claude team highlights
app.post('/api/ai/team-summary', async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
    const { tasks = [] } = req.body;

    const allTagged = tasks.map(t =>
      `- [${t.isVideoTeam ? 'VIDEO' : 'DESIGN'}] ${t.memberName}: ${t.task.name} (${t.task.board_name}, Priority: ${t.task.priority || 'Normal'})`
    ).join('\n');

    const prompt = `You are a creative studio manager writing a brief weekly recap for your boss.
Split the summary into two sections: "## Video Team" and "## Design Team".
Skip a section entirely if there are no tasks for it.
Do NOT add a title or intro line at the top — start directly with the first section heading.

Rules:
- Max 2 bullets per person. Pick only their most important or unique work.
- Keep bullets very short — no complete sentences needed. Conversational tone.
- **Bold** person names and key task/campaign names.
- Do not list every task — synthesize and prioritize.
- META platform tasks with Medium or Low priority should NOT be listed individually. Instead, group them into a single bullet like "**Name** knocked out X META ads this week".

Team's completed tasks:
${allTagged || 'None'}

Team Summary:`;

    const client = new Anthropic({ apiKey });
    const stream = await client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        res.write(chunk.delta.text);
      }
    }
    res.end();
  } catch (err) {
    console.error('[ai/team-summary]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/weekly-summary — streaming Claude weekly summary per member
app.post('/api/ai/weekly-summary', async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
    const { memberName, tasks = [], weekType = 'last' } = req.body;

    const taskList = tasks.map(t =>
      `- ${t.name} (Project: ${t.board_name}, Priority: ${t.priority}, Status: ${t.status}${t.timeline_end ? `, Due: ${t.timeline_end}` : ''})`
    ).join('\n');

    const isLast = weekType === 'last';
    const prompt = isLast
      ? `You are a creative studio manager writing a weekly report for your boss.

Write a concise, professional 2-3 paragraph summary of what ${memberName} accomplished last week based on their completed tasks. Highlight high-priority items prominently. Be specific about the work done. Write in third person.

Completed tasks:\n${taskList || 'None'}\n\nSummary:`
      : `You are a creative studio manager writing a weekly report for your boss.

Write a concise 1-2 paragraph preview of what ${memberName} is focused on this week based on their upcoming tasks. Mention any high-priority or time-sensitive items. Write in third person.

Upcoming tasks:\n${taskList || 'None'}\n\nPreview:`;

    const client = new Anthropic({ apiKey });
    const stream = await client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        res.write(chunk.delta.text);
      }
    }
    res.end();
  } catch (err) {
    console.error('[ai/weekly-summary]', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Dropbox
// ══════════════════════════════════════════════════════════════════════════════

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const EPOCH = new Date('2025-11-09T00:00:00');

function weekFolder(weekEnding) {
  const sat = new Date(weekEnding + 'T00:00:00');
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  const index = Math.round((sun.getTime() - EPOCH.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  const label = `${MONTHS[sun.getMonth()]}_${sun.getDate()}_${sun.getFullYear()}`;
  return `${String(index).padStart(3, '0')}_${label}`;
}

// GET /api/dropbox/weekly-files — list files for a member's week folder
app.get('/api/dropbox/weekly-files', async (req, res) => {
  try {
    const { weekEnding, memberName } = req.query;
    if (!weekEnding || !memberName) return res.status(400).json({ error: 'Missing params' });
    const token = await getDropboxToken();
    const basePath = (process.env.DROPBOX_PATH ?? '/Weekly Reports').replace(/\/$/, '');
    const folder = weekFolder(weekEnding);
    const folderPath = `${basePath}/${folder}/${memberName}`;

    const IMAGE_EXTS = new Set(['.jpg','.jpeg','.png','.gif','.webp','.heic','.heif','.bmp','.tiff','.tif']);
    const VIDEO_EXTS = new Set(['.mp4','.mov','.avi','.mkv','.webm','.m4v','.wmv']);
    const ext = name => name.slice(name.lastIndexOf('.')).toLowerCase();

    const listRes = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath }),
    });

    if (!listRes.ok) return res.json({ files: [], folder, folderPath, sharedLink: null });

    const data = await listRes.json();
    const files = (data.entries ?? [])
      .filter(e => e['.tag'] === 'file')
      .map(e => ({ name: e.name, path_lower: e.path_lower, is_image: IMAGE_EXTS.has(ext(e.name)), is_video: VIDEO_EXTS.has(ext(e.name)) }))
      .filter(f => f.is_image || f.is_video);

    // Get or create a shared folder link so the thumbnail proxy can use it
    let sharedLink = null;
    try {
      const listLinkRes = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath, direct_only: true }),
      });
      if (listLinkRes.ok) {
        const linkData = await listLinkRes.json();
        sharedLink = linkData.links?.[0]?.url ?? null;
      }
      if (!sharedLink) {
        const createRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: folderPath, settings: { requested_visibility: 'team_only' } }),
        });
        if (createRes.ok) {
          const created = await createRes.json();
          sharedLink = created.url ?? null;
        } else {
          // already_shared — fetch it
          const body = await createRes.json();
          sharedLink = body?.shared_link_already_exists?.metadata?.url ?? null;
        }
      }
    } catch {}

    res.json({ files, folder, folderPath, sharedLink });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dropbox/upload-link — get a temporary direct-upload URL for large files

app.post('/api/dropbox/upload-link', async (req, res) => {
  try {
    const { fileName, memberName, weekEnding } = req.body;
    if (!fileName || !memberName || !weekEnding) return res.status(400).json({ error: 'Missing fields' });
    const token = await getDropboxToken();
    const basePath = (process.env.DROPBOX_PATH ?? '/Weekly Reports').replace(/\/$/, '');
    const folder = weekFolder(weekEnding);
    const path = `${basePath}/${folder}/${memberName}/${fileName}`.replace(/\/+/g, '/');

    const response = await fetch('https://api.dropboxapi.com/2/files/get_temporary_upload_link', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ commit_info: { path, mode: 'add', autorename: true, mute: false }, duration: 3600 }),
    });
    if (!response.ok) return res.status(500).json({ error: `Dropbox link failed: ${await response.text()}` });
    const data = await response.json();
    res.json({ success: true, link: data.link });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dropbox/delete — delete a file from Dropbox by path
app.post('/api/dropbox/delete', async (req, res) => {
  try {
    const { path } = req.body;
    if (!path) return res.status(400).json({ error: 'Missing path' });
    const token = await getDropboxToken();
    const r = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dropbox/upload-url — save a URL as a .url shortcut file in Dropbox
app.post('/api/dropbox/upload-url', async (req, res) => {
  try {
    const { url, title, memberName, weekEnding } = req.body;
    if (!url || !memberName || !weekEnding) return res.status(400).json({ error: 'Missing fields' });
    const token = await getDropboxToken();
    const basePath = (process.env.DROPBOX_PATH ?? '/Weekly Reports').replace(/\/$/, '');
    const folder = weekFolder(weekEnding);
    const safeName = (title || url).slice(0, 60).replace(/[\/\\:*?"<>|]/g, '_');
    const filePath = `${basePath}/${folder}/${memberName}/${safeName}.url`.replace(/\/+/g, '/');
    const content = `[InternetShortcut]\nURL=${url}\n`;
    const r = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Dropbox-API-Arg': encodeDropboxArg({ path: filePath, mode: 'add', autorename: true, mute: false }),
        'Content-Type': 'application/octet-stream',
      },
      body: Buffer.from(content),
    });
    if (!r.ok) return res.status(500).json({ error: `Upload failed: ${await r.text()}` });
    const data = await r.json();
    res.json({ success: true, path: data.path_display });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/monday/sync — incremental sync via activity logs (called by frontend every 60s)
app.post('/api/monday/sync', async (req, res) => {
  try {
    const token = process.env.MONDAY_API_TOKEN;
    if (!token) return res.json({ updatedItems: 0 });
    const boards = mondayOps.getBoards();
    const boardIds = boards.map(b => b.board_id);
    if (boardIds.length === 0) return res.json({ updatedItems: 0 });
    const result = await incrementalSync(boardIds, token);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Dropbox — folder listing & thumbnail proxy
// ══════════════════════════════════════════════════════════════════════════════

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp', '.tiff', '.tif']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.wmv']);
function fileExt(name) { return name.slice(name.lastIndexOf('.')).toLowerCase(); }
function isImage(name) { return IMAGE_EXTS.has(fileExt(name)); }
function isVideo(name) { return VIDEO_EXTS.has(fileExt(name)); }

// GET /api/dropbox/folder?url=<shared_link>
app.get('/api/dropbox/folder', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url param' });
  try {
    const token = await getDropboxToken();
    const r = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '', shared_link: { url }, recursive: false }),
    });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const data = await r.json();
    const files = (data.entries ?? [])
      .filter(e => e['.tag'] === 'file')
      .map(e => ({ name: e.name, path_lower: e.path_lower, size: e.size, is_image: isImage(e.name), is_video: isVideo(e.name) }));
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dropbox/thumbnail?path=&url=&mode=thumb|play
app.get('/api/dropbox/thumbnail', async (req, res) => {
  const { path, url, mode = 'thumb' } = req.query;
  if (!path) return res.status(400).json({ error: 'Missing path param' });
  try {
    const token = await getDropboxToken();

    if (url) {
      // Cross-account shared folder
      const relPath = path.startsWith('/') ? path : `/${path}`;

      if (mode === 'play') {
        const headers = {
          'Authorization': `Bearer ${token}`,
          'Dropbox-API-Arg': encodeDropboxArg({ url, path: relPath }),
        };
        if (req.headers.range) headers['Range'] = req.headers.range;
        const fileRes = await fetch('https://content.dropboxapi.com/2/sharing/get_shared_link_file', { method: 'POST', headers });
        if (!fileRes.ok) return res.status(fileRes.status).end();
        res.status(fileRes.status);
        res.set('Content-Type', fileRes.headers.get('content-type') || 'application/octet-stream');
        for (const h of ['content-range', 'accept-ranges', 'content-length']) {
          const v = fileRes.headers.get(h); if (v) res.set(h, v);
        }
        const buf = await fileRes.arrayBuffer();
        return res.end(Buffer.from(buf));
      }

      // Thumbnail
      const thumbRes = await fetch('https://content.dropboxapi.com/2/files/get_thumbnail_v2', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Dropbox-API-Arg': encodeDropboxArg({ resource: { '.tag': 'link', url, path: relPath }, format: { '.tag': 'jpeg' }, size: { '.tag': 'w640h480' } }),
        },
      });
      if (!thumbRes.ok) return res.status(thumbRes.status).end();
      const buf = await thumbRes.arrayBuffer();
      res.set('Content-Type', 'image/jpeg').set('Cache-Control', 'public, max-age=3600').end(Buffer.from(buf));
      return;
    }

    // Own account
    if (mode === 'play') {
      const linkRes = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      if (!linkRes.ok) return res.status(linkRes.status).end();
      const { link } = await linkRes.json();
      return res.redirect(link);
    }

    const thumbRes = await fetch('https://content.dropboxapi.com/2/files/get_thumbnail_v2', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Dropbox-API-Arg': encodeDropboxArg({ resource: { '.tag': 'path', path }, format: { '.tag': 'jpeg' }, size: { '.tag': 'w640h480' } }),
      },
    });
    if (!thumbRes.ok) return res.status(thumbRes.status).end();
    const buf = await thumbRes.arrayBuffer();
    res.set('Content-Type', 'image/jpeg').set('Cache-Control', 'public, max-age=3600').end(Buffer.from(buf));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`[Server] Slack Summary API running on port ${PORT}`);
  startPoller();
  // Warm in-memory board cache from DB (so first request doesn't hit Monday API)
  await loadBoardCacheFromDb();
});
