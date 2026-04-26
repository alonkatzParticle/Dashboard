// monday_boards.js — ported from lib/monday.ts
// Handles full Monday.com board fetching, caching, and task processing
// for the Weekly Report, Status Report, and Studio pages.

const { mondayOps } = require('./db');

const MONDAY_API_URL = 'https://api.monday.com/v2';
const EXCLUDED_GROUPS = ['form requests', 'ready for assignment'];
const COMPLETED_STATUSES = ['approved', 'completed', 'done', 'for approval', 'sent to client', 'upload complete'];

// ── In-memory caches ────────────────────────────────────────────────────────
const boardMetaCache = new Map();   // boardId → BoardMeta
const boardItemCache = new Map();   // boardId → BoardCache
const inflightFetches = new Map();  // boardId → Promise<BoardCache>

const BOARD_META_TTL = 60 * 60 * 1000;  // 1 hour
const BOARD_ITEM_TTL = 5 * 60 * 1000;   // 5 minutes

function clearBoardCache() {
  boardMetaCache.clear();
  boardItemCache.clear();
  inflightFetches.clear();
}

// ── GraphQL helper ───────────────────────────────────────────────────────────
async function mondayQuery(query, token) {
  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token,
      'API-Version': '2024-01',
    },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(`Monday.com API error: ${response.statusText}`);
  const data = await response.json();
  if (data.errors) throw new Error(`Monday.com GraphQL error: ${JSON.stringify(data.errors)}`);
  return data.data;
}

// ── Board metadata (columns, status colors) ──────────────────────────────────
async function fetchBoardMeta(boardId, token) {
  const cached = boardMetaCache.get(boardId);
  if (cached && Date.now() - cached.fetchedAt < BOARD_META_TTL) return cached;

  const data = await mondayQuery(
    `query { boards(ids: [${boardId}]) { name columns { id type title settings_str } } }`,
    token
  );
  const board = data?.boards?.[0];
  if (!board?.name) return { name: '', timelineColId: null, neededColumnIds: [], statusColors: {}, fetchedAt: Date.now() };

  const cols = board.columns ?? [];
  const timelineCol = cols.find(c => c.type === 'timeline');
  const personCols = cols.filter(c => c.type === 'multiple-person' || c.type === 'people' || c.id === 'person' || c.id === 'people');
  const priorityCol = cols.find(c => c.type === 'status' && (c.id.toLowerCase().includes('priority') || c.title?.toLowerCase().includes('priority')));
  const statusCol = cols.find(c => c.type === 'status' && c.id === 'status')
    ?? cols.find(c => c.type === 'status' && c.title?.toLowerCase() === 'status');
  const dropboxCols = cols.filter(c => c.type === 'link' || c.title?.toLowerCase().includes('dropbox'));
  const departmentCol = cols.find(c => c.type === 'status' && c.title?.toLowerCase() === 'department');

  const needed = new Set();
  if (timelineCol) needed.add(timelineCol.id);
  personCols.forEach(c => needed.add(c.id));
  if (priorityCol) needed.add(priorityCol.id);
  if (statusCol) needed.add(statusCol.id);
  dropboxCols.forEach(c => needed.add(c.id));
  if (departmentCol) needed.add(departmentCol.id);

  const statusColors = {};
  const allStatusCols = cols.filter(c => c.type === 'status');
  for (const col of allStatusCols) {
    try {
      const settings = JSON.parse(col.settings_str ?? '{}');
      const labels = settings.labels ?? {};
      const colors = settings.labels_colors ?? {};
      for (const [idx, label] of Object.entries(labels)) {
        if (colors[idx]?.color) statusColors[label.toLowerCase()] = colors[idx].color;
      }
    } catch {}
  }

  const meta = { name: board.name, timelineColId: timelineCol?.id ?? null, neededColumnIds: Array.from(needed), statusColors, fetchedAt: Date.now() };
  boardMetaCache.set(boardId, meta);
  return meta;
}

// ── Board items (cached) ─────────────────────────────────────────────────────
async function fetchBoardItems(boardId, token, force = false) {
  if (!force) {
    const cached = boardItemCache.get(boardId);
    if (cached && Date.now() - cached.fetchedAt < BOARD_ITEM_TTL) return cached;
  }

  if (!force) {
    const inflight = inflightFetches.get(boardId);
    if (inflight) return inflight;
  }

  const promise = (async () => {
    try {
      const meta = await fetchBoardMeta(boardId, token);
      if (!meta.name) return { name: '', items: [], statusColors: {}, fetchedAt: Date.now() };

      const colIdsArg = meta.neededColumnIds.length > 0
        ? `ids: [${meta.neededColumnIds.map(id => `"${id}"`).join(', ')}]`
        : '';
      const selectedCols = `column_values(${colIdsArg}) { id type text value }`;
      const fields = `id name url group { title } ${selectedCols}`;
      const queryParams = meta.timelineColId
        ? `query_params: { rules: [{ column_id: "${meta.timelineColId}", compare_value: [], operator: is_not_empty }] }`
        : '';

      const firstData = await mondayQuery(`
        query {
          boards(ids: [${boardId}]) {
            items_page(limit: 500, ${queryParams}) {
              cursor
              items { ${fields} }
            }
          }
        }
      `, token);

      const page = firstData?.boards?.[0]?.items_page;
      let cursor = page?.cursor ?? null;
      const items = [...(page?.items ?? [])];

      while (cursor) {
        const next = await mondayQuery(
          `query { next_items_page(limit: 500, cursor: "${cursor}") { cursor items { ${fields} } } }`,
          token
        );
        cursor = next?.next_items_page?.cursor ?? null;
        items.push(...(next?.next_items_page?.items ?? []));
      }

      const result = { name: meta.name, items, statusColors: meta.statusColors, fetchedAt: Date.now() };
      boardItemCache.set(boardId, result);
      // Persist to DB so cache survives restarts
      setImmediate(() => saveBoardCache(boardId, result));
      return result;
    } finally {
      inflightFetches.delete(boardId);
    }
  })();

  inflightFetches.set(boardId, promise);
  return promise;
}

// ── Item processing helpers ──────────────────────────────────────────────────
function getItemAssigneeIds(item) {
  const cols = item.column_values ?? [];
  const personCols = cols.filter(c => c.type === 'multiple-person' || c.type === 'people' || c.id === 'person' || c.id === 'people');
  const ids = [];
  for (const pc of personCols) {
    if (!pc?.value) continue;
    try {
      const pv = JSON.parse(pc.value);
      if (pv?.personsAndTeams) for (const p of pv.personsAndTeams) if (p.id) ids.push(String(p.id));
    } catch {}
  }
  return ids;
}

function processItem(item, boardName, mondayUserId, statusColors = {}) {
  const groupTitle = item.group?.title?.toLowerCase() ?? '';
  if (EXCLUDED_GROUPS.some(g => groupTitle.includes(g))) return null;

  const cols = item.column_values ?? [];
  const timelineCol = cols.find(c => c.type === 'timeline' || c.id === 'timeline');
  const priorityCol = cols.find(c => c.type === 'status' && (c.id.includes('priority') || c.id.includes('Priority')));
  const statusCol = cols.find(c => c.type === 'status' && c.id === 'status')
    ?? cols.find(c => c.type === 'status' && c.id.includes('status') && !c.id.toLowerCase().includes('priority'))
    ?? cols.find(c => c.type === 'status' && !c.id.toLowerCase().includes('priority') && c.text && c.text !== '-');

  const assigneeIds = getItemAssigneeIds(item);
  if (!assigneeIds.includes(String(mondayUserId))) return null;

  let timelineStart = null, timelineEnd = null;
  if (timelineCol?.value) {
    try { const tv = JSON.parse(timelineCol.value); timelineStart = tv?.from ?? null; timelineEnd = tv?.to ?? null; } catch {}
  }

  let dropboxLink = null;
  let frameioLink = null;
  for (const c of cols) {
    try {
      if (c.value && c.value !== 'null') {
        const parsed = JSON.parse(c.value);
        const url = parsed?.url ?? (typeof parsed === 'string' ? parsed : null);
        if (url?.includes('dropbox.com') && !dropboxLink) dropboxLink = url;
        if ((url?.includes('frame.io') || url?.includes('app.frame.io')) && !frameioLink) frameioLink = url;
      }
    } catch {}
    if (c.text?.includes('dropbox.com') && !dropboxLink) dropboxLink = c.text;
    if ((c.text?.includes('frame.io') || c.text?.includes('app.frame.io')) && !frameioLink) frameioLink = c.text;
  }

  return {
    id: item.id,
    name: item.name,
    board_name: boardName,
    assignee_id: String(mondayUserId),
    timeline_start: timelineStart,
    timeline_end: timelineEnd,
    priority: priorityCol?.text ?? 'Normal',
    status: statusCol?.text ?? '',
    status_color: statusColors[(statusCol?.text ?? '').toLowerCase()] ?? null,
    monday_url: item.url ?? null,
    dropbox_link: dropboxLink,
    frameio_link: frameioLink,
  };
}

function processTeamItem(item, boardName, statusColors = {}) {
  const groupTitle = item.group?.title?.toLowerCase() ?? '';
  if (EXCLUDED_GROUPS.some(g => groupTitle.includes(g))) return null;

  const cols = item.column_values ?? [];
  const timelineCol = cols.find(c => c.type === 'timeline' || c.id === 'timeline');
  const priorityCol = cols.find(c => c.type === 'status' && (c.id.includes('priority') || c.id.includes('Priority')));
  const statusCol = cols.find(c => c.type === 'status' && c.id === 'status')
    ?? cols.find(c => c.type === 'status' && c.id.includes('status') && !c.id.toLowerCase().includes('priority'))
    ?? cols.find(c => c.type === 'status' && !c.id.toLowerCase().includes('priority') && c.text && c.text !== '-');

  const departmentCol = cols.find(c => c.type === 'status' && (c.id === 'status_1__1' || c.id === 'label') && !c.id.toLowerCase().includes('priority'))
    ?? cols.find(c => c.type === 'status' && /department/i.test(c.id + ' ' + (c.title ?? '')));

  const assignee_ids = getItemAssigneeIds(item);
  if (assignee_ids.length === 0) return null;

  let timelineStart = null, timelineEnd = null;
  if (timelineCol?.value) {
    try { const tv = JSON.parse(timelineCol.value); timelineStart = tv?.from ?? null; timelineEnd = tv?.to ?? null; } catch {}
  }

  let dropboxLink = null;
  let frameioLink = null;
  for (const c of cols) {
    try {
      if (c.value && c.value !== 'null') {
        const parsed = JSON.parse(c.value);
        const url = parsed?.url ?? (typeof parsed === 'string' ? parsed : null);
        if (url?.includes('dropbox.com') && !dropboxLink) dropboxLink = url;
        if ((url?.includes('frame.io') || url?.includes('app.frame.io')) && !frameioLink) frameioLink = url;
      }
    } catch {}
    if (c.text?.includes('dropbox.com') && !dropboxLink) dropboxLink = c.text;
    if ((c.text?.includes('frame.io') || c.text?.includes('app.frame.io')) && !frameioLink) frameioLink = c.text;
  }

  return {
    id: item.id,
    name: item.name,
    board_name: boardName,
    assignee_ids,
    timeline_start: timelineStart,
    timeline_end: timelineEnd,
    priority: priorityCol?.text ?? 'Normal',
    status: statusCol?.text ?? '',
    department: departmentCol?.text ?? null,
    status_color: statusColors[(statusCol?.text ?? '').toLowerCase()] ?? null,
    monday_url: item.url ?? null,
    dropbox_link: dropboxLink,
    frameio_link: frameioLink,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

async function fetchTasksForUser(boardIds, mondayUserId, token, weekStart, nextWeekEnd, force = false) {
  const results = await Promise.allSettled(boardIds.map(id => fetchBoardItems(id, token, force)));
  const tasks = [];
  results.forEach((result, i) => {
    if (result.status === 'rejected') { console.error(`Board ${boardIds[i]} error:`, result.reason); return; }
    const { name: boardName, items, statusColors } = result.value;
    if (!boardName) return;
    for (const item of items) {
      const task = processItem(item, boardName, mondayUserId, statusColors);
      if (task) tasks.push(task);
    }
  });
  return tasks;
}

async function fetchAllBoardTasks(boardIds, token, force = false) {
  const results = await Promise.allSettled(boardIds.map(id => fetchBoardItems(id, token, force)));
  const tasks = [];
  results.forEach((result, i) => {
    if (result.status === 'rejected') { console.error(`Board ${boardIds[i]} error:`, result.reason); return; }
    const { name: boardName, items, statusColors } = result.value;
    if (!boardName) return;
    for (const item of items) {
      const task = processTeamItem(item, boardName, statusColors);
      if (task) tasks.push(task);
    }
  });
  return tasks;
}

async function fetchTeamTasks(boardIds, validUserIds, token, weekStart, nextWeekEnd, force = false) {
  const tasksByUser = {};
  validUserIds.forEach(id => { tasksByUser[id] = []; });

  const results = await Promise.allSettled(boardIds.map(id => fetchBoardItems(id, token, force)));
  results.forEach((result, i) => {
    if (result.status === 'rejected') { console.error(`Board ${boardIds[i]} error:`, result.reason); return; }
    const { name: boardName, items, statusColors } = result.value;
    if (!boardName) return;
    for (const item of items) {
      const teamTask = processTeamItem(item, boardName, statusColors);
      if (!teamTask) continue;
      for (const assignee of teamTask.assignee_ids) {
        if (validUserIds.includes(assignee)) {
          tasksByUser[assignee].push({
            id: teamTask.id, name: teamTask.name, board_name: teamTask.board_name,
            assignee_id: assignee, timeline_start: teamTask.timeline_start, timeline_end: teamTask.timeline_end,
            priority: teamTask.priority, status: teamTask.status, department: teamTask.department ?? null,
            status_color: teamTask.status_color,
            monday_url: teamTask.monday_url, dropbox_link: teamTask.dropbox_link, frameio_link: teamTask.frameio_link,
          });
        }
      }
    }
  });
  return tasksByUser;
}

async function fetchDailyActivity(boardIds, token, force = false) {
  const todayLocalMidnight = new Date();
  todayLocalMidnight.setHours(0, 0, 0, 0);
  const from = todayLocalMidnight.toISOString();
  const to = new Date().toISOString();

  const boardResults = await Promise.allSettled(boardIds.map(id => fetchBoardItems(id, token, force)));

  const itemMap = new Map();
  boardResults.forEach(result => {
    if (result.status === 'rejected') return;
    const { name: boardName, items, statusColors } = result.value;
    if (!boardName) return;
    for (const item of items) itemMap.set(String(item.id), { item, boardName, statusColors });
  });

  const completedIds = new Set();
  const completedTasks = [];

  await Promise.allSettled(boardIds.map(async (boardId, idx) => {
    const boardResult = boardResults[idx];
    if (boardResult.status === 'rejected') return;
    const { name: boardName, statusColors } = boardResult.value;
    if (!boardName) return;

    try {
      const data = await mondayQuery(`
        query {
          boards(ids: [${boardId}]) {
            activity_logs(limit: 500, from: "${from}", to: "${to}") {
              id event data created_at
            }
          }
        }
      `, token);

      const logs = data?.boards?.[0]?.activity_logs ?? [];
      for (const log of logs) {
        if (log.event !== 'update_column_value') continue;
        try {
          const logData = JSON.parse(log.data ?? '{}');
          if (logData.column_type !== 'color') continue;
          const newStatus = logData.value?.label?.text ?? '';
          if (!COMPLETED_STATUSES.some(s => newStatus.toLowerCase().includes(s))) continue;
          const pulseId = String(logData.pulse_id);
          if (completedIds.has(pulseId)) continue;
          completedIds.add(pulseId);

          const cached = itemMap.get(pulseId);
          let assignee_ids = [], timeline_end = null, monday_url = null;
          if (cached) {
            assignee_ids = getItemAssigneeIds(cached.item);
            const cols = cached.item.column_values ?? [];
            const timelineCol = cols.find(c => c.type === 'timeline' || c.id === 'timeline');
            if (timelineCol?.value) { try { timeline_end = JSON.parse(timelineCol.value)?.to ?? null; } catch {} }
            monday_url = cached.item.url ?? null;
          }

          const statusColor = logData.value?.label?.style?.color ?? statusColors[newStatus.toLowerCase()] ?? null;
          completedTasks.push({ id: pulseId, name: logData.pulse_name ?? 'Unknown task', board_name: boardName, assignee_ids, status: newStatus, status_color: statusColor, timeline_end, monday_url });
        } catch {}
      }
    } catch (err) { console.error(`[daily] Board ${boardId} error:`, err); }
  }));

  const inProgressTasks = [];
  boardResults.forEach(result => {
    if (result.status === 'rejected') return;
    const { name: boardName, items, statusColors } = result.value;
    if (!boardName) return;
    for (const item of items) {
      const task = processTeamItem(item, boardName, statusColors);
      if (!task) continue;
      if (completedIds.has(task.id)) continue;
      if (COMPLETED_STATUSES.some(s => task.status.toLowerCase().includes(s))) continue;
      inProgressTasks.push({ id: task.id, name: task.name, board_name: task.board_name, assignee_ids: task.assignee_ids, status: task.status, status_color: task.status_color, timeline_end: task.timeline_end, monday_url: task.monday_url });
    }
  });

  return { completedToday: completedTasks, inProgress: inProgressTasks };
}

module.exports = { clearBoardCache, loadBoardCacheFromDb, incrementalSync, fetchTasksForUser, fetchAllBoardTasks, fetchTeamTasks, fetchDailyActivity, COMPLETED_STATUSES };

// ── Board cache DB persistence ───────────────────────────────────────────────
function saveBoardCache(boardId, cacheEntry) {
  try {
    mondayOps.saveBoardCacheEntry(
      boardId,
      cacheEntry.name,
      cacheEntry.items,
      cacheEntry.statusColors,
      cacheEntry.fetchedAt
    );
  } catch (e) {
    console.error('[monday] Failed to persist board cache:', e);
  }
}

async function loadBoardCacheFromDb() {
  try {
    const rows = await mondayOps.loadAllBoardCacheEntries();
    let count = 0;
    for (const { boardId, name, items, statusColors, fetchedAt } of rows) {
      if (!boardItemCache.has(boardId)) {
        boardItemCache.set(boardId, { name, items, statusColors, fetchedAt });
        count++;
      }
    }
    if (count > 0) console.log(`[monday] Loaded ${count} board(s) from DB cache`);
  } catch (e) {
    console.error('[monday] Failed to load board cache from DB:', e);
  }
}

async function incrementalSync(boardIds, token) {
  const lastSynced = (await mondayOps.getCacheMeta('last_synced')) ?? new Date(Date.now() - 60_000).toISOString();
  const now = new Date().toISOString();

  // 1. Fetch activity logs since lastSynced to find changed item IDs per board
  const changedByBoard = new Map();

  await Promise.allSettled(boardIds.map(async (boardId) => {
    try {
      const data = await mondayQuery(`
        query {
          boards(ids: [${boardId}]) {
            activity_logs(limit: 500, from: "${lastSynced}", to: "${now}") {
              id event data
            }
          }
        }
      `, token);

      const logs = data?.boards?.[0]?.activity_logs ?? [];
      const ids = new Set();
      for (const log of logs) {
        try {
          const logData = JSON.parse(log.data ?? '{}');
          const pulseId = String(logData.pulse_id);
          if (pulseId && pulseId !== 'undefined') ids.add(pulseId);
        } catch {}
      }
      if (ids.size > 0) changedByBoard.set(boardId, ids);
    } catch (err) {
      console.error(`[sync] Activity log error for board ${boardId}:`, err);
    }
  }));

  // 2. For each board with changes, re-fetch only those items and merge into cache
  let totalUpdated = 0;

  await Promise.allSettled(Array.from(changedByBoard.entries()).map(async ([boardId, itemIds]) => {
    try {
      const cached = boardItemCache.get(boardId);
      if (!cached) return;

      const meta = await fetchBoardMeta(boardId, token);
      const colIdsArg = meta.neededColumnIds.length > 0
        ? `ids: [${meta.neededColumnIds.map(id => `"${id}"`).join(', ')}]`
        : '';

      const data = await mondayQuery(`
        query {
          items(ids: [${Array.from(itemIds).join(', ')}]) {
            id name url group { title }
            column_values(${colIdsArg}) { id type text value }
          }
        }
      `, token);

      const freshItems = data?.items ?? [];
      if (freshItems.length === 0) return;

      // Merge fresh items into cached items
      const itemMap = new Map(cached.items.map(item => [String(item.id), item]));
      for (const item of freshItems) itemMap.set(String(item.id), item);

      const updated = { ...cached, items: Array.from(itemMap.values()), fetchedAt: Date.now() };
      boardItemCache.set(boardId, updated);
      setImmediate(() => saveBoardCache(boardId, updated));
      totalUpdated += freshItems.length;
    } catch (err) {
      console.error(`[sync] Item update error for board ${boardId}:`, err);
    }
  }));

  await mondayOps.setCacheMeta('last_synced', now);
  return { updatedItems: totalUpdated };
}
