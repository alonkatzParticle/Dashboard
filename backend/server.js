require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { channelOps, messageOps, syncOps, syncLogOps, tokenOps, followUpOps, summaryOps, mondayOps, kvOps, initDb, pool } = require('./db');
const { startPoller, runSync, getSyncStatus } = require('./poller');
const { generateSummary, getIsraelDate, getProcessingState } = require('./claude');
const { clearBoardCache, loadBoardCacheFromDb, incrementalSync, fetchAllBoardTasks, fetchTeamTasks, fetchDailyActivity } = require('./monday_boards');
const { encodeDropboxArg, getDropboxToken, uploadToDropbox } = require('./dropbox_lib');
const Anthropic = require('@anthropic-ai/sdk');


const app = express();
app.use(cors());
app.use(express.json());

// Vercel Services strips the /api routePrefix before passing to Express.
// Re-add it so all /api/* routes continue to match correctly.
app.use((req, _res, next) => {
  if (!req.path.startsWith('/api')) {
    req.url = '/api' + req.url;
  }
  next();
});

// ── Admin auth ────────────────────────────────────────────────────────────────
// GET /api/auth/mode — tells the client whether restricted mode is active
app.get('/api/auth/mode', (_req, res) => {
  res.json({ restricted: Boolean(process.env.ADMIN_PASSWORD) });
});

// POST /api/auth/unlock — verify admin password, never expose the password to client
app.post('/api/auth/unlock', (req, res) => {
  const { password } = req.body ?? {};
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) return res.json({ ok: true }); // no password set → always open
  if (password === secret) return res.json({ ok: true });
  return res.status(401).json({ ok: false, error: 'Incorrect password' });
});

// GET /api/status - overall sync status
app.get('/api/status', async (req, res) => {
  try {
    const syncStatus = getSyncStatus();
    const tokens = await tokenOps.get();
    const messageCount = await messageOps.count();
    const channels = await channelOps.getAll();
    const recentLogs = await syncLogOps.getLast(5);

    res.json({
      sync: syncStatus,
      tokens: {
        hasToken: !!tokens,
        expiresAt: tokens?.expires_at ? new Date(tokens.expires_at).toISOString() : null,
        expiresInMinutes: tokens?.expires_at ? Math.round((tokens.expires_at - Date.now()) / 60000) : null
      },
      stats: {
        totalMessages: messageCount?.count || 0,
        totalChannels: (channels || []).length,
        unanalyzedCount: 0
      },
      recentSyncs: recentLogs || []
    });
  } catch (err) {
    console.error('[/api/status]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/channels - list all synced channels
app.get('/api/channels', async (req, res) => {
  try {
    const channels = await channelOps.getAll();
    const syncStates = await syncOps.getAll();
    const stateMap = {};
    for (const s of syncStates) stateMap[s.channel_id] = s;
    const latestTsRows = await pool.query('SELECT channel_id, MAX(CAST(ts AS FLOAT)) as last_ts FROM messages GROUP BY channel_id');
    const latestTsMap = {};
    for (const r of latestTsRows.rows) latestTsMap[r.channel_id] = r.last_ts;
    const result = (channels || [])
      .map(ch => ({
        ...ch,
        lastFetched: stateMap[ch.channel_id]?.last_fetched_at || null,
        messageCount: stateMap[ch.channel_id]?.message_count || 0,
        lastMessageTs: latestTsMap[ch.channel_id] || 0
      }))
      .sort((a, b) => b.lastMessageTs - a.lastMessageTs);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/users - user ID → display name map for resolving @mentions in the UI
app.get('/api/users', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT user_id, display_name FROM users WHERE display_name IS NOT NULL');
    const map = {};
    for (const u of rows) map[u.user_id] = u.display_name;
    res.json(map);
  } catch (err) { res.json({}); }
});

// GET /api/messages - get messages with optional filters
app.get('/api/messages', async (req, res) => {
  try {
    const { channel, date, limit = 100 } = req.query;
    let messages;
    if (date) {
      messages = await messageOps.getForDay(date, channel || null);
    } else {
      messages = await messageOps.getRecent(parseInt(limit), channel || null);
    }
    res.json(messages || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/sync - manually trigger a sync (responds immediately, runs in background)
app.post('/api/sync', (req, res) => {
  const { isSyncing } = getSyncStatus();
  res.json({ started: true, alreadyRunning: isSyncing });
  if (!isSyncing) {
    runSync(true).catch(err => console.error('[Sync] Manual sync error:', err.message));
  }
});

// GET /api/sync/status - poll to check if a background sync is still running
app.get('/api/sync/status', (req, res) => {
  const status = getSyncStatus();
  res.json({ running: status.isSyncing, lastSyncTime: status.lastSyncTime });
});

// GET /api/summary
app.get('/api/summary', async (req, res) => {
  try {
    const today = getIsraelDate(0);
    const cached = await summaryOps.get(today);
    res.json({
      date: today, cached: !!cached,
      summary: cached?.summary_text || null,
      generatedAt: cached?.generated_at || null,
      followUps: await followUpOps.getAll('open'),
      inProgress: await followUpOps.getAll('in_progress'),
      finished: await followUpOps.getAll('finished'),
      dismissed: await followUpOps.getAll('dismissed'),
      candidates: await followUpOps.getAll('candidate')
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/summary/reset — full analysis reset: unanalyze all messages + clear all tasks/summaries
app.post('/api/summary/reset', async (req, res) => {
  try {
    await messageOps.markAllUnanalyzed();
    await followUpOps.clearAll();
    await summaryOps.clearAll();
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
app.get('/api/summary/status', async (req, res) => {
  try {
    const state = getProcessingState();
    const today = getIsraelDate(0);
    if (state.running) {
      return res.json({
        status: 'processing',
        progress: { channelsDone: state.channelsDone, channelsTotal: state.channelsTotal, currentChannel: state.currentChannel }
      });
    }
    if (state.lastResult) {
      const result = state.lastResult;
      result.dismissed = await followUpOps.getAll('dismissed');
      result.candidates = await followUpOps.getAll('candidate');
      return res.json({ status: 'done', result });
    }
    const cached = await summaryOps.get(today);
    return res.json({
      status: 'idle',
      result: {
        summary: cached?.summary_text || null,
        followUps: await followUpOps.getAll('open'),
        finished: await followUpOps.getAll('finished'),
        dismissed: await followUpOps.getAll('dismissed'),
        candidates: await followUpOps.getAll('candidate'),
        generatedAt: cached?.generated_at || null
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Helper: return all list state after any mutation
const allLists = async () => ({
  ok: true,
  followUps: await followUpOps.getAll('open'),
  inProgress: await followUpOps.getAll('in_progress'),
  finished: await followUpOps.getAll('finished'),
  dismissed: await followUpOps.getAll('dismissed'),
  candidates: await followUpOps.getAll('candidate')
});

// GET /api/follow-ups - list follow-ups
app.get('/api/follow-ups', async (req, res) => {
  try { res.json(await followUpOps.getAll(req.query.status || null)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/follow-ups - manually add a follow-up
app.post('/api/follow-ups', async (req, res) => {
  const { text, channel_name, context, priority, task_type } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });
  await followUpOps.insert({ text, channel_name, context, priority: priority || 'medium', task_type: task_type || 'task', source: 'user' });
  res.json({ ok: true, followUps: await followUpOps.getAll('open') });
});
app.post('/api/followups', async (req, res) => {
  const { text, channel_name, context, priority, task_type } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });
  await followUpOps.insert({ text, channel_name, context, priority: priority || 'medium', task_type: task_type || 'task', source: 'user' });
  res.json({ ok: true, followUps: await followUpOps.getAll('open') });
});
app.post('/api/followups/:id/resolve', async (req, res) => { await followUpOps.resolve(parseInt(req.params.id), 'user'); res.json(await allLists()); });
app.post('/api/followups/:id/reopen',  async (req, res) => { await followUpOps.reopen(parseInt(req.params.id)); res.json(await allLists()); });
app.delete('/api/followups/:id',       async (req, res) => { await followUpOps.delete(parseInt(req.params.id)); res.json(await allLists()); });
app.patch('/api/followups/:id/status', async (req, res) => {
  const id = parseInt(req.params.id);
  const { status } = req.body;
  if (!['open', 'in_progress', 'done'].includes(status)) return res.status(400).json({ error: 'invalid status' });
  if (status === 'done') {
    await followUpOps.resolve(id, 'user');
  } else if (status === 'open') {
    await followUpOps.reopen(id);
  } else {
    await pool.query("UPDATE follow_ups SET status = $1 WHERE id = $2", ['in_progress', id]);
  }
  res.json(await allLists());
});

app.patch('/api/follow-ups/:id/resolve', async (req, res) => {
  await followUpOps.resolve(parseInt(req.params.id), 'user');
  res.json(await allLists());
});
app.patch('/api/follow-ups/:id/reopen', async (req, res) => {
  await followUpOps.reopen(parseInt(req.params.id));
  res.json(await allLists());
});
app.patch('/api/follow-ups/:id/restore', async (req, res) => {
  await followUpOps.restore(parseInt(req.params.id));
  res.json(await allLists());
});
app.patch('/api/follow-ups/:id/confirm', async (req, res) => {
  const id = parseInt(req.params.id);
  const { rows } = await pool.query('SELECT pre_resolved FROM follow_ups WHERE id = $1', [id]);
  const task = rows[0];
  if (task?.pre_resolved) {
    await followUpOps.confirmAsResolved(id);
  } else {
    await followUpOps.confirm(id);
  }
  res.json(await allLists());
});
app.delete('/api/follow-ups/:id', async (req, res) => {
  await followUpOps.delete(parseInt(req.params.id));
  res.json(await allLists());
});

app.patch('/api/follow-ups/:id/priority', async (req, res) => {
  const { priority } = req.body;
  const valid = ['low', 'medium', 'high', 'critical'];
  if (!valid.includes(priority)) return res.status(400).json({ error: 'invalid priority' });
  await followUpOps.updatePriority(parseInt(req.params.id), priority);
  res.json({ ok: true });
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
    const cached = await summaryOps.get(today);
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

// POST /api/standup/clarify — Claude decides which tasks need more context and generates targeted questions
app.post('/api/standup/clarify', async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
    const { tasks = [] } = req.body;
    if (!tasks.length) return res.json({ clarifications: [] });

    const taskLines = tasks.map((t, i) => {
      const msgs = (() => { try { return JSON.parse(t.source_messages || '[]') } catch { return [] } })();
      const msgSummary = msgs.slice(0, 3).map(m => typeof m === 'string' ? m : (m.text || '')).filter(Boolean).join(' | ');
      return `[${i}] ID:${t.id} | "${t.text}" | context: ${t.context || 'none'} | status: ${t.status} | messages: ${msgSummary || 'none'}`;
    }).join('\n');

    const prompt = `You are helping Alon Katz prepare a stand-up brief for his boss Tomer. For each task below, decide if a person reading this would know exactly what happened and what to report. If yes — skip it. If no — write ONE specific question to ask Alon.

Note: if a task mentions "Tomer", that refers to the boss this brief is being sent to — keep that in mind when generating questions.

Only include tasks where the task description and context are genuinely unclear or incomplete for a stand-up. Do NOT ask about tasks that are self-explanatory.

Respond ONLY with a JSON array (no markdown, no explanation):
[{ "taskId": <number>, "taskText": "...", "question": "..." }]

If all tasks are clear, respond with: []

Tasks:
${taskLines}`;

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = response.content[0]?.text?.trim() || '[]';
    // Strip markdown code fences if Claude wrapped it
    const json = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
    const clarifications = JSON.parse(json);
    res.json({ clarifications: Array.isArray(clarifications) ? clarifications : [] });
  } catch (err) {
    console.error('[standup/clarify]', err);
    res.json({ clarifications: [] }); // fail open — skip clarification step on error
  }
});



// ══════════════════════════════════════════════════════════════════════════════
// Monday.com Settings
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/monday/settings
app.get('/api/monday/settings', async (req, res) => {
  const members = await mondayOps.getMembers();
  const boards = await mondayOps.getBoards();
  res.json({ members, boards });
});

// POST /api/monday/settings/members
app.post('/api/monday/settings/members', async (req, res) => {
  const { id, name, monday_user_id, is_video_team } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  await mondayOps.upsertMember(id || null, name, monday_user_id || '', is_video_team || false);
  const members = await mondayOps.getMembers();
  res.json({ ok: true, members });
});

// DELETE /api/monday/settings/members/:id
app.delete('/api/monday/settings/members/:id', async (req, res) => {
  await mondayOps.deleteMember(req.params.id);
  res.json({ ok: true });
});

// POST /api/monday/settings/boards
app.post('/api/monday/settings/boards', async (req, res) => {
  const { board_id, label } = req.body;
  if (!board_id) return res.status(400).json({ error: 'board_id required' });
  await mondayOps.upsertBoard(board_id, label || '');
  const boards = await mondayOps.getBoards();
  res.json({ ok: true, boards });
});

// DELETE /api/monday/settings/boards/:boardId
app.delete('/api/monday/settings/boards/:boardId', async (req, res) => {
  await mondayOps.deleteBoard(req.params.boardId);
  res.json({ ok: true });
});

// POST /api/monday/settings/seed — one-time: populate Neon with local config
app.post('/api/monday/settings/seed', async (req, res) => {
  try {
    const members = [
      { name: 'Dan Lowenstein',  monday_user_id: '69272319',  is_video_team: 0 },
      { name: 'Natalie Abesdid', monday_user_id: '75466488',  is_video_team: 0 },
      { name: 'Matan Shapira',   monday_user_id: '75937261',  is_video_team: 1 },
      { name: 'Isaac Yashar',    monday_user_id: '51316881',  is_video_team: 1 },
      { name: 'Yael Ben-Dor',    monday_user_id: '75466464',  is_video_team: 1 },
      { name: 'Omri Tabachnik',  monday_user_id: '96948732',  is_video_team: 1 },
    ];
    const boards = [
      { board_id: '5433027071', label: 'Video Projects' },
      { board_id: '8036329818', label: 'Design Projects - 2.0' },
    ];

    // Clear and re-seed members
    const { pool } = require('./db');
    await pool.query('DELETE FROM monday_members');
    await pool.query('DELETE FROM monday_boards');
    for (const m of members) {
      await pool.query(
        "INSERT INTO monday_members (name, monday_user_id, is_video_team) VALUES ($1, $2, $3)",
        [m.name, m.monday_user_id, m.is_video_team]
      );
    }
    for (const b of boards) {
      await pool.query(
        "INSERT INTO monday_boards (board_id, label) VALUES ($1, $2)",
        [b.board_id, b.label]
      );
    }
    const seededMembers = await mondayOps.getMembers();
    const seededBoards = await mondayOps.getBoards();
    res.json({ ok: true, members: seededMembers, boards: seededBoards });
  } catch (err) {
    console.error('[seed]', err);
    res.status(500).json({ error: err.message });
  }
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
    const boards = await mondayOps.getBoards();
    const members = await mondayOps.getMembers();
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
    const { tasksByBoard = {}, completedToday = [], tasks = [], clarifications = [] } = req.body;

    let prompt;

    if (tasks.length > 0) {
      // Standup page: flat array of follow-up tasks
      const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2 };
      const sorted = [...tasks].sort((a, b) =>
        (PRIORITY_ORDER[a.priority?.toLowerCase()] ?? 3) - (PRIORITY_ORDER[b.priority?.toLowerCase()] ?? 3)
      );
      const lines = sorted.map(t => {
        const statusLabel = t.status === 'in_progress' ? ' [In Progress]' : ' [Done]';
        const clarification = (clarifications || []).find(c => c.taskId === t.id && c.answer);
        const extra = clarification ? `\n  Additional context: ${clarification.answer}` : '';
        return `- ${t.text}${t.channel_name ? ` (from #${t.channel_name})` : ''}${statusLabel}${extra}`;
      });
      const inProgressCount = tasks.filter(t => t.status === 'in_progress').length;
      const doneCount = tasks.filter(t => t.status !== 'in_progress').length;
      prompt = `You are Alon Katz, a creative studio manager. Write a brief stand-up update addressed to your boss Tomer.

Note: if any task mentions "Tomer" by name, that means it directly involves your boss — frame it appropriately (e.g. "following up with you", "waiting on your feedback", etc.).

${doneCount > 0 ? 'Completed tasks are marked [Done]. ' : ''}${inProgressCount > 0 ? 'Tasks currently in progress are marked [In Progress] — mention these as ongoing work.' : ''}

Write it as a clean bullet list in first person (e.g. "I completed…", "I'm working on…", "I followed up on…").
- Do NOT mention priority levels
- Do NOT use section headers
- Keep each bullet to one sentence, natural and direct
- Sound like a human reporting in, not a system log
- Use any "Additional context" provided to add specific detail
- Put a blank line between each bullet

Tasks:
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
    const boards = await mondayOps.getBoards();
    const members = await mondayOps.getMembers();
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

// GET /api/monday/team-tasks — local-first: returns cache immediately, refreshes in background
app.get('/api/monday/team-tasks', async (req, res) => {
  try {
    const token = process.env.MONDAY_API_TOKEN;
    if (!token) return res.status(500).json({ error: 'MONDAY_API_TOKEN not set' });
    const { week_start, week_end, next_week_start, next_week_end, force } = req.query;
    const boardIds = (await mondayOps.getBoards()).map(b => b.board_id);
    const members = (await mondayOps.getMembers()).filter(m => m.monday_user_id);
    const validUserIds = members.map(m => String(m.monday_user_id));
    if (boardIds.length === 0 || validUserIds.length === 0) return res.json({ _meta: { fromCache: false } });

    const cacheKey = `tasks:${week_start}:${next_week_end}`;
    const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    // Helper: build result from raw Monday.com data
    const buildResult = (lastWeekByUser, thisWeekByUser) => {
      const result = {};
      for (const m of members) {
        const uid = String(m.monday_user_id);
        result[uid] = {
          lastWeek: (lastWeekByUser[uid] ?? []).filter(t => {
            if (!t.timeline_end) return false;
            return t.timeline_end >= week_start && t.timeline_end <= week_end;
          }),
          thisWeek: (thisWeekByUser[uid] ?? []).filter(t => {
            if (!t.timeline_start && !t.timeline_end) return false;
            const start = t.timeline_start ?? t.timeline_end;
            const end = t.timeline_end ?? t.timeline_start;
            return end >= next_week_start && start <= next_week_end;
          }),
        };
      }
      return result;
    };

    // Background fetch + cache update (fire-and-forget)
    const refreshInBackground = () => {
      (async () => {
        try {
          clearBoardCache();
          const [lastWeekByUser, thisWeekByUser] = await Promise.all([
            fetchTeamTasks(boardIds, validUserIds, token, week_start, week_end, true),
            fetchTeamTasks(boardIds, validUserIds, token, next_week_start, next_week_end, true),
          ]);
          const fresh = buildResult(lastWeekByUser, thisWeekByUser);
          mondayOps.setTasksCache(cacheKey, fresh);
          console.log('[monday/team-tasks] Background refresh complete for', cacheKey);
        } catch (err) {
          console.error('[monday/team-tasks] Background refresh failed:', err.message);
        }
      })();
    };

    // If force=true (Refresh button), bust cache and wait for fresh data
    if (force === 'true') {
      clearBoardCache();
      const [lastWeekByUser, thisWeekByUser] = await Promise.all([
        fetchTeamTasks(boardIds, validUserIds, token, week_start, week_end, true),
        fetchTeamTasks(boardIds, validUserIds, token, next_week_start, next_week_end, true),
      ]);
      const fresh = buildResult(lastWeekByUser, thisWeekByUser);
      await mondayOps.setTasksCache(cacheKey, fresh);
      return res.json({ ...fresh, _meta: { fromCache: false, fetchedAt: Date.now() } });
    }

    // Check SQLite cache
    const cached = await mondayOps.getTasksCache(cacheKey);
    const isStale = !cached || (Date.now() - cached.fetchedAt > CACHE_TTL);

    if (cached) {
      // Return cache immediately
      res.json({ ...cached.data, _meta: { fromCache: true, fetchedAt: cached.fetchedAt } });
      // Kick off background refresh if stale
      if (isStale) refreshInBackground();
      return;
    }

    // No cache — fetch synchronously, store, return
    const [lastWeekByUser, thisWeekByUser] = await Promise.all([
      fetchTeamTasks(boardIds, validUserIds, token, week_start, week_end, false),
      fetchTeamTasks(boardIds, validUserIds, token, next_week_start, next_week_end, false),
    ]);
    const fresh = buildResult(lastWeekByUser, thisWeekByUser);
    await mondayOps.setTasksCache(cacheKey, fresh);
    res.json({ ...fresh, _meta: { fromCache: false, fetchedAt: Date.now() } });
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
    const { tasks = [], lastWeekTasks, thisWeekTasks } = req.body;

    const lastList = lastWeekTasks?.length ? lastWeekTasks : (lastWeekTasks == null ? tasks : [])
    const thisList = thisWeekTasks || []
    const activeList = thisList.length > 0 ? thisList : lastList

    const IMPORTANT_PRIORITIES = new Set(['important', 'high', 'critical'])
    const isImportant = t => IMPORTANT_PRIORITIES.has((t.task.priority || '').toLowerCase())
    const isMetaOrLow = t => !isImportant(t)  // everything else: Meta ads, Normal, Medium, Low

    // Group by member, pre-categorize server-side — Claude just formats
    const memberMap = {}
    for (const t of activeList) {
      const key = `${t.isVideoTeam ? 'VIDEO' : 'DESIGN'}::${t.memberName}`
      if (!memberMap[key]) memberMap[key] = { memberName: t.memberName, isVideoTeam: t.isVideoTeam, important: [], other: [] }
      if (isImportant(t)) memberMap[key].important.push(t.task.name)
      else memberMap[key].other.push(t.task.name)
    }

    // Build the task section with pre-counted buckets — no ambiguity for Claude
    const video = Object.values(memberMap).filter(m => m.isVideoTeam)
    const design = Object.values(memberMap).filter(m => !m.isVideoTeam)

    const fmtMember = m => {
      const lines = [`${m.memberName}:`]
      if (m.important.length > 0)
        lines.push(`  IMPORTANT TASKS (${m.important.length}): ${m.important.join(' | ')}`)
      if (m.other.length > 0)
        lines.push(`  META/OTHER TASKS COUNT: ${m.other.length} tasks`)
      return lines.join('\n')
    }

    const taskSection = [
      video.length > 0 ? `VIDEO TEAM:\n${video.map(fmtMember).join('\n\n')}` : null,
      design.length > 0 ? `DESIGN TEAM:\n${design.map(fmtMember).join('\n\n')}` : null,
    ].filter(Boolean).join('\n\n')

    const hasLast = lastList.length > 0
    const hasThis = thisList.length > 0
    const weekLabel = hasThis && !hasLast ? '*This Week*' : '*Last Week*'
    const tense = hasThis && !hasLast ? 'present/future' : 'past'

    const prompt = `You are writing a brief weekly summary of a creative studio team for their manager. The output will be pasted directly into Slack.

STRICT FORMAT — follow this exactly:

${weekLabel}

[Video team members — NO "Video Team" header]

Person Name
    • [important tasks in one fragment bullet]
    • [X Meta/other tasks]

*Design Team*

Person Name
    • [important tasks in one fragment bullet]
    • [X Meta/other tasks]

RULES:
- First line must be exactly: ${weekLabel}
- Blank line, then VIDEO team members with NO section header.
- After video members, blank line, then *Design Team* (asterisks = Slack bold), then design members.
- Omit *Design Team* if no design members. Skip straight to *Design Team* if no video members.
- Person names plain text — no asterisks, no bold.
- Blank line between each person.

BULLET RULES — maximum 2 bullets per person, no exceptions:

BULLET 1 — Important tasks:
- The input gives you a list of IMPORTANT TASKS for each person. Write them ALL in a SINGLE bullet as brief fragments separated by semicolons.
- Example: "Face Cream TV aggressive 90s cut; Instant Eye Firming teaser; Sunscreen TV commercial"
- Use the actual task names but shorten them naturally — keep product names, drop filler words.
- If no important tasks listed for this person, skip Bullet 1.

BULLET 2 — Meta/other count:
- The input gives you META/OTHER TASKS COUNT as an exact number. Use that exact number.
- Write it as: "N Meta ads" or "N Meta ads + B-rolls" (if B-roll tasks are in the count).
- Do NOT name any individual ads. The number is pre-counted for you — use it exactly.
- If count is 0, skip Bullet 2.

TONE:
- Casual fragments only. No full sentences. No openers like "worked on" or "completed".
- Product names only in Bullet 1. Bullet 2 is just the count.
- ${tense} tense.
- No markdown headers or dashes as bullets.

Pre-categorized input (use the exact counts provided):
${taskSection || 'No tasks provided.'}

Output:`

    const client = new Anthropic({ apiKey });
    const stream = await client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
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
  sun.setDate(sat.getDate() - 6); // Saturday - 6 = Sunday that starts this week
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

// POST /api/dropbox/copy — copy a Dropbox file into the member's weekly folder
app.post('/api/dropbox/copy', async (req, res) => {
  try {
    const { filePath, sharedUrl, fileName, weekEnding, memberName } = req.body;
    if ((!filePath && !sharedUrl) || !fileName || !weekEnding || !memberName)
      return res.status(400).json({ error: 'Missing required fields' });
    const token = await getDropboxToken();
    const basePath = (process.env.DROPBOX_PATH ?? '/Weekly Reports').replace(/\/$/, '');
    const folder = weekFolder(weekEnding);
    const toPath = `${basePath}/${folder}/${memberName}/${fileName}`;

    // Own-account file: use server-side copy (no data transfer)
    if (filePath) {
      const copyRes = await fetch('https://api.dropboxapi.com/2/files/copy_v2', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_path: filePath, to_path: toPath, autorename: true }),
      });
      if (!copyRes.ok) return res.status(500).json({ error: `Copy failed: ${await copyRes.text()}` });
      const data = await copyRes.json();
      return res.json({ success: true, path: data.metadata?.path_lower });
    }

    // Cross-account: download via shared link then upload
    const relPath = fileName.startsWith('/') ? fileName : `/${fileName}`;
    const downloadRes = await fetch('https://content.dropboxapi.com/2/sharing/get_shared_link_file', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Dropbox-API-Arg': encodeDropboxArg({ url: sharedUrl, path: relPath }) },
    });
    if (!downloadRes.ok) return res.status(500).json({ error: `Download failed: ${await downloadRes.text()}` });
    const fileBuffer = await downloadRes.arrayBuffer();
    const uploadRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': encodeDropboxArg({ path: toPath, mode: 'add', autorename: true }) },
      body: Buffer.from(fileBuffer),
    });
    if (!uploadRes.ok) return res.status(500).json({ error: `Upload failed: ${await uploadRes.text()}` });
    const data = await uploadRes.json();
    return res.json({ success: true, path: data.path_lower });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
    console.error('[sync]', err.message);
    res.json({ updatedItems: 0 }); // degrade gracefully — never 500
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
    if (mode === 'play' || mode === 'url') {
      const linkRes = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      if (!linkRes.ok) return res.status(linkRes.status).end();
      const { link } = await linkRes.json();
      if (mode === 'url') return res.set('Cache-Control', 'public, max-age=14400').json({ url: link });
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


// ── Frame.io Integration ───────────────────────────────────────────────────────
const ADOBE_IMS = 'https://ims-na1.adobelogin.com/ims';
const FRAMEIO_API = 'https://api.frame.io/v4';
const FRAMEIO_SCOPES = 'openid,AdobeID,offline_access,email,profile,additional_info.roles';

async function getFrameioToken() {
  const accessToken = await kvOps.get('fio_access_token');
  const expiry = await kvOps.get('fio_token_expiry');
  if (accessToken && expiry && Date.now() < parseInt(expiry)) return accessToken;

  const refreshToken = await kvOps.get('fio_refresh_token');
  if (!refreshToken) throw new Error('Frame.io not connected. Please authorize first.');

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.FRAMEIO_CLIENT_ID,
    client_secret: process.env.FRAMEIO_CLIENT_SECRET,
    refresh_token: refreshToken,
  });
  const r = await fetch(`${ADOBE_IMS}/token/v3`, { method: 'POST', body: params });
  if (!r.ok) throw new Error('Failed to refresh Frame.io token');
  const data = await r.json();
  await kvOps.set('fio_access_token', data.access_token);
  await kvOps.set('fio_token_expiry', String(Date.now() + (data.expires_in * 1000) - 60000));
  if (data.refresh_token) await kvOps.set('fio_refresh_token', data.refresh_token);
  return data.access_token;
}

async function frameioGet(path) {
  const token = await getFrameioToken();
  const r = await fetch(`${FRAMEIO_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Frame.io API error ${r.status}: ${await r.text()}`);
  return r.json();
}

// GET /api/frameio/auth-url — returns the Adobe OAuth URL to open in browser
app.get('/api/frameio/auth-url', (req, res) => {
  const url = `${ADOBE_IMS}/authorize/v2?` + new URLSearchParams({
    client_id: process.env.FRAMEIO_CLIENT_ID,
    scope: FRAMEIO_SCOPES,
    response_type: 'code',
    redirect_uri: process.env.FRAMEIO_REDIRECT_URI,
  });
  res.json({ url });
});

// POST /api/frameio/exchange-code — one-time: exchange auth code for tokens
app.post('/api/frameio/exchange-code', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'code required' });
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.FRAMEIO_CLIENT_ID,
      client_secret: process.env.FRAMEIO_CLIENT_SECRET,
      code,
      redirect_uri: process.env.FRAMEIO_REDIRECT_URI,
    });
    const r = await fetch(`${ADOBE_IMS}/token/v3`, { method: 'POST', body: params });
    const data = await r.json();
    if (!r.ok) {
      console.error('[frameio/exchange-code] Adobe error:', JSON.stringify(data));
      console.error('[frameio/exchange-code] redirect_uri used:', process.env.FRAMEIO_REDIRECT_URI);
      return res.status(400).json({ error: data.error_description || data.error || 'Token exchange failed', detail: data });
    }
    await kvOps.set('fio_access_token', data.access_token);
    await kvOps.set('fio_token_expiry', String(Date.now() + (data.expires_in * 1000) - 60000));
    if (data.refresh_token) await kvOps.set('fio_refresh_token', data.refresh_token);
    // Fetch and store account ID
    try {
      const accountId = await fetchAndStoreAccountId(data.access_token);
      console.log('[frameio/exchange-code] stored accountId:', accountId);
    } catch (e) {
      console.error('[frameio/exchange-code] failed to fetch accountId:', e.message);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[frameio/exchange-code]', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper: fetch account ID from Frame.io and persist it
async function fetchAndStoreAccountId(accessToken) {
  const token = accessToken || await getFrameioToken();
  const r = await fetch(`${FRAMEIO_API}/accounts`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await r.json();
  console.log('[frameio] GET /accounts raw:', JSON.stringify(body).slice(0, 300));
  // Handle both {data:[{id}]} and [{id}] shapes
  const list = body?.data || (Array.isArray(body) ? body : null);
  const accountId = list?.[0]?.id || body?.id;
  if (!accountId) throw new Error('Could not extract account ID from: ' + JSON.stringify(body).slice(0, 200));
  await kvOps.set('fio_account_id', accountId);
  return accountId;
}

// GET /api/frameio/fix-account — re-fetch and store account ID from current token
app.get('/api/frameio/fix-account', async (req, res) => {
  try {
    const accountId = await fetchAndStoreAccountId();
    res.json({ ok: true, accountId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/frameio/status — check if connected
app.get('/api/frameio/status', async (req, res) => {
  const hasToken = !!(await kvOps.get('fio_refresh_token'));
  const accountId = await kvOps.get('fio_account_id');
  res.json({ connected: hasToken, accountId });
});

// DELETE /api/frameio/disconnect
app.delete('/api/frameio/disconnect', async (req, res) => {
  for (const k of ['fio_access_token', 'fio_refresh_token', 'fio_token_expiry', 'fio_account_id']) await kvOps.del(k);
  res.json({ ok: true });
});

// GET /api/frameio/debug-folder?folderId=...&projectId=... — raw response for debugging
app.get('/api/frameio/debug-folder', async (req, res) => {
  try {
    const { folderId, projectId } = req.query;
    const accountId = await kvOps.get('fio_account_id');
    if (!accountId) return res.status(400).json({ error: 'No account ID' });
    const results = {};
    if (folderId) {
      const r = await frameioGet(`/accounts/${accountId}/folders/${folderId}/children?page_size=50`).catch(e => ({ error: e.message }));
      results.folderChildren = r;
    }
    if (projectId) {
      const p = await frameioGet(`/accounts/${accountId}/projects/${projectId}`).catch(e => ({ error: e.message }));
      results.project = p;
      const rootId = p?.data?.root_folder_id || p?.root_folder_id;
      if (rootId) {
        const rc = await frameioGet(`/accounts/${accountId}/folders/${rootId}/children?page_size=50`).catch(e => ({ error: e.message }));
        results.rootFolderChildren = rc;
      }
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/frameio/media-url?fileId=... — returns signed inline/download URLs for client-side playback
app.get('/api/frameio/media-url', async (req, res) => {
  try {
    const { fileId } = req.query;
    if (!fileId) return res.status(400).json({ error: 'fileId required' });
    const accountId = await kvOps.get('fio_account_id');
    if (!accountId) return res.status(400).json({ error: 'No account ID stored' });
    const file = await frameioGet(`/accounts/${accountId}/files/${fileId}?include=media_links.original`);
    const fd = file?.data || file;
    const ml = fd?.media_links?.original;
    res.json({
      inlineUrl: ml?.inline_url || null,
      downloadUrl: ml?.download_url || null,
      name: fd?.name,
    });
  } catch (err) {
    console.error('[frameio/media-url]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/frameio/to-dropbox — copy a Frame.io file into the weekly Dropbox folder
app.post('/api/frameio/to-dropbox', async (req, res) => {
  try {
    const { fileId, fileName, weekEnding, memberName } = req.body;
    if (!fileId || !fileName) return res.status(400).json({ error: 'fileId and fileName required' });
    const accountId = await kvOps.get('fio_account_id');
    if (!accountId) return res.status(400).json({ error: 'No account ID stored' });

    // Get download URL from Frame.io — must include media_links.original
    const file = await frameioGet(`/accounts/${accountId}/files/${fileId}?include=media_links.original`);
    const fd = file?.data || file;
    const ml = fd?.media_links?.original;
    const downloadUrl = ml?.download_url || ml?.inline_url;
    if (!downloadUrl) return res.status(404).json({ error: 'No download URL for this file (media_links.original was null)' });

    // Stream from Frame.io → Dropbox upload-session
    // 1. Get Dropbox upload link
    const dbToken = await getDropboxToken();
    const sanitized = fileName.replace(/[^\w.\-_ ()]/g, '_');
    const basePath = (process.env.DROPBOX_PATH ?? '/Weekly Reports').replace(/\/$/, '');
    const folder = weekEnding ? weekFolder(weekEnding) : 'unknown';
    const member = memberName || 'unknown';
    const dropboxPath = `${basePath}/${folder}/${member}/${sanitized}`;

    // Fetch file from Frame.io
    const fileRes = await fetch(downloadUrl);
    if (!fileRes.ok) return res.status(502).json({ error: 'Failed to fetch file from Frame.io' });
    const fileBuffer = await fileRes.arrayBuffer();

    // Upload to Dropbox
    const uploadRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${dbToken}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: dropboxPath, mode: 'add', autorename: true, mute: false,
        }),
      },
      body: fileBuffer,
    });
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) return res.status(502).json({ error: uploadData?.error_summary || 'Dropbox upload failed' });
    res.json({ success: true, path: uploadData.path_display });
  } catch (err) {
    console.error('[frameio/to-dropbox]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/frameio/assets?reviewUrl=... — list video assets from a share/review/project link
app.get('/api/frameio/assets', async (req, res) => {
  try {
    const { reviewUrl, projectId } = req.query;
    let accountId = await kvOps.get('fio_account_id');
    if (!accountId) {
      try { accountId = await fetchAndStoreAccountId(); } catch (e) { console.error('[frameio/assets] failed to fetch accountId:', e.message); }
    }
    let assets = [];

    if (projectId) {
      // Explicit projectId param
      if (!accountId) return res.status(400).json({ error: 'No account ID stored. Re-authorize.' });
      const data = await frameioGet(`/accounts/${accountId}/projects/${projectId}/assets?type=file&page_size=50`);
      assets = (data.data || data || []).filter(a => a.media_type === 'video' || a.filetype?.startsWith('video'));

    } else if (reviewUrl) {
      // ── next.frame.io/project/{projectId}/{folderId} ──────────────────────
      const projectMatch = reviewUrl.match(/next\.frame\.io\/project\/([a-f0-9-]+)(?:\/([a-f0-9-]+))?/i);
      if (projectMatch) {
        const projId = projectMatch[1];
        const folderId = projectMatch[2];
        if (!accountId) return res.status(400).json({ error: 'No account ID stored. Re-authorize.' });
        try {
          let rawItems = [];
          if (folderId) {
            // V4 correct endpoint: /folders/{id}/children (not /assets/{id}/children)
            try {
              const data = await frameioGet(`/accounts/${accountId}/folders/${folderId}/children?page_size=50`);
              rawItems = data.data || data || [];
            } catch (childErr) {
              console.log('[frameio] folder children failed:', childErr.message);
            }
          }
          // Fall back: get project root folder, then list its children
          if (rawItems.length === 0) {
            try {
              const project = await frameioGet(`/accounts/${accountId}/projects/${projId}`);
              const rootFolderId = project?.data?.root_folder_id || project?.root_folder_id;
              if (rootFolderId) {
                const fallback = await frameioGet(`/accounts/${accountId}/folders/${rootFolderId}/children?page_size=50`);
                rawItems = fallback.data || fallback || [];
              }
            } catch (projErr) {
              console.log('[frameio] project root folder fallback failed:', projErr.message);
            }
          }
          // V4 items are version_stacks wrapping files — accept them and normalize
          const videoItems = rawItems.filter(a =>
            a.type === 'version_stack' ||
            (a.media_type || '').includes('video') ||
            (a.head_version?.media_type || '').includes('video')
          );
          // Fetch thumbnail for each from /files/{fileId}?include=media_links.thumbnail
          assets = await Promise.all(videoItems.map(async a => {
            const fileId = a.head_version?.id || a.id;
            let thumb = null;
            try {
              const file = await frameioGet(`/accounts/${accountId}/files/${fileId}?include=media_links.thumbnail`);
              const fd = file?.data || file;
              thumb = fd?.media_links?.thumbnail?.url || fd?.thumbnail_url || fd?.thumb;
            } catch (_) {}
            return {
              id: a.id,
              file_id: fileId,
              name: a.name,
              media_type: a.head_version?.media_type || a.media_type || 'video',
              duration: a.head_version?.duration || a.duration,
              view_url: a.view_url || (a.head_version?.view_url),
              thumb,
            };
          }));
        } catch (e) {
          return res.status(400).json({ error: `Frame.io fetch failed: ${e.message}` });
        }

      // ── app.frame.io/reviews/{token} or /shares/{token} ───────────────────
      } else {
        const match = reviewUrl.match(/\/(?:reviews|shares|v)\/([a-zA-Z0-9_-]+)/);
        if (!match) return res.status(400).json({ error: 'Could not parse Frame.io URL. Expected next.frame.io/project/... or app.frame.io/reviews/...' });
        const shareToken = match[1];
        const token = await getFrameioToken();
        const shareRes = await fetch(`${FRAMEIO_API}/share_links/${shareToken}/assets`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (shareRes.ok) {
          const data = await shareRes.json();
          assets = (data.data || data || []).filter(a => a.media_type === 'video' || (a.media_type || '').startsWith('video'));
        } else {
          // Fallback: try as v2 presentation
          const presRes = await fetch(`https://api.frame.io/v2/presentations/${shareToken}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (presRes.ok) {
            const pres = await presRes.json();
            assets = (pres.assets || []).map(a => ({
              id: a.id, name: a.name, thumb: a.thumb, download_url: a.original,
              filesize: a.filesize, duration: a.duration, media_type: 'video'
            }));
          } else {
            return res.status(404).json({ error: 'Could not fetch assets from this link. Check the URL.' });
          }
        }
      }
    } else {
      return res.status(400).json({ error: 'reviewUrl or projectId required' });
    }

    res.json({ assets });
  } catch (err) {
    console.error('[frameio/assets]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/frameio/thumbnail?assetId=... — proxy thumbnail to avoid CORS
app.get('/api/frameio/thumbnail', async (req, res) => {
  try {
    const { assetId } = req.query;
    const accountId = await kvOps.get('fio_account_id');
    const data = await frameioGet(`/accounts/${accountId}/assets/${assetId}`);
    const thumbUrl = data.thumb_1280 || data.thumb_1024 || data.thumb_640 || data.thumb;
    if (!thumbUrl) return res.status(404).json({ error: 'No thumbnail' });
    const imgRes = await fetch(thumbUrl);
    res.setHeader('Content-Type', imgRes.headers.get('content-type') || 'image/jpeg');
    imgRes.body.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/frameio/copy-to-dropbox — stream a Frame.io asset directly into Dropbox
app.post('/api/frameio/copy-to-dropbox', async (req, res) => {
  try {
    const { assetId, dropboxPath } = req.body;
    if (!assetId || !dropboxPath) return res.status(400).json({ error: 'assetId and dropboxPath required' });

    const accountId = await kvOps.get('fio_account_id');
    const fioToken = await getFrameioToken();

    // Get the asset to find its download URL and filename
    const assetRes = await fetch(`${FRAMEIO_API}/accounts/${accountId}/assets/${assetId}`, {
      headers: { Authorization: `Bearer ${fioToken}` }
    });
    if (!assetRes.ok) throw new Error('Failed to fetch asset details');
    const asset = await assetRes.json();
    const asset_data = asset.data || asset;
    const downloadUrl = asset_data.original || asset_data.download_url;
    const filename = asset_data.name || `${assetId}.mp4`;
    if (!downloadUrl) throw new Error('No download URL for this asset');

    // Stream download from Frame.io
    const dlRes = await fetch(downloadUrl);
    if (!dlRes.ok) throw new Error('Failed to download from Frame.io');

    // Upload to Dropbox
    const fullPath = dropboxPath.endsWith('/') ? `${dropboxPath}${filename}` : `${dropboxPath}/${filename}`;
    const dbxToken = await getDropboxToken();
    const uploadRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${dbxToken}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({ path: fullPath, mode: 'overwrite', autorename: true }),
      },
      body: dlRes.body,
      duplex: 'half',
    });
    if (!uploadRes.ok) throw new Error(`Dropbox upload failed: ${await uploadRes.text()}`);
    const uploaded = await uploadRes.json();
    res.json({ ok: true, path: uploaded.path_display, name: uploaded.name });
  } catch (err) {
    console.error('[frameio/copy-to-dropbox]', err);
    res.status(500).json({ error: err.message });
  }
});
// ── End Frame.io ───────────────────────────────────────────────────────────────

// ── Cron endpoint (Vercel Cron calls this every 15 min) ──────────────────────
app.post('/api/internal/cron-sync', async (req, res) => {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });
  try { await runSync(); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Init middleware (runs once on first request in serverless) ────────────────
let _initialized = false;
app.use(async (req, res, next) => {
  if (!_initialized) {
    try { await initDb(); await loadBoardCacheFromDb(); _initialized = true; } catch (e) { console.error('[init]', e); }
  }
  next();
});

// Start server — always listen (Vercel Services runs this as a persistent process)
const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`[Server] Running on port ${PORT}`);
  await initDb();
  startPoller();
  await loadBoardCacheFromDb();
});

module.exports = app;
