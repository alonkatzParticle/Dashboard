require('dotenv').config();
const { fetchTeamTasks } = require('./monday_boards');
const { getBoards, getMembers } = require('./db');

const token = process.env.MONDAY_API_TOKEN;
const next_week_start = '2026-04-20';
const next_week_end   = '2026-04-26';
const week_start      = '2026-04-13';
const week_end        = '2026-04-19';

(async () => {
  const boards  = await getBoards();
  const members = await getMembers();
  const boardIds     = boards.map(b => b.board_id);
  const validUserIds = members.filter(m => m.monday_user_id).map(m => String(m.monday_user_id));

  console.log('Boards:', boardIds.join(', '));
  console.log('Members:', members.map(m => m.name + ' -> ' + m.monday_user_id).join(', '));

  const [lastWeek, thisWeek] = await Promise.all([
    fetchTeamTasks(boardIds, validUserIds, token, week_start, week_end, true),
    fetchTeamTasks(boardIds, validUserIds, token, next_week_start, next_week_end, true),
  ]);

  const omri = members.find(m => /omri/i.test(m.name));
  if (!omri) { console.log('Omri not found in members'); return; }
  const uid = String(omri.monday_user_id);

  const lw = lastWeek[uid] || [];
  const tw = thisWeek[uid] || [];
  console.log('\n=== OMRI raw (before date filter) ===');
  console.log('lw count:', lw.length, '  tw count:', tw.length);

  const all = [...lw, ...tw];
  const seen = new Set();
  const deduped = all.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });

  console.log('\nAll tasks with timeline dates:');
  deduped.forEach(t =>
    console.log(' -', (t.name || '').substring(0,55).padEnd(55), '| start:', t.timeline_start, '| end:', t.timeline_end)
  );

  const twFiltered = tw.filter(t => {
    if (!t.timeline_start && !t.timeline_end) return false;
    const s = t.timeline_start ?? t.timeline_end;
    const e = t.timeline_end   ?? t.timeline_start;
    return e >= next_week_start && s <= next_week_end;
  });
  console.log('\nPASSED this-week filter (' + next_week_start + ' to ' + next_week_end + '):', twFiltered.length);
  twFiltered.forEach(t => console.log('  PASS:', t.name));
  
  const twFailed = tw.filter(t => {
    const s = t.timeline_start ?? t.timeline_end;
    const e = t.timeline_end ?? t.timeline_start;
    return !(e >= next_week_start && s <= next_week_end);
  });
  console.log('\nFAILED filter:', twFailed.length);
  twFailed.forEach(t => console.log('  FAIL:', (t.name || '').substring(0,55), '| start:', t.timeline_start, '| end:', t.timeline_end));
})().catch(e => { console.error(e); process.exit(1); });
