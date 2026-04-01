require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { db, messageOps, followUpOps, summaryOps } = require('./db');
const { resolveLinksInMessages } = require('./monday');
const { getWeekStartTs } = require('./timeUtils');

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const MODEL = 'claude-sonnet-4-5';

// In-memory processing state
const processingState = {
  running: false,
  startedAt: null,
  stage: null,
  lastResult: null,
  error: null
};

function getProcessingState() { return { ...processingState }; }

function getIsraelDate(daysBack = 0) {
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000);
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

function getUnanalyzedMessages() {
  const weekStartTs = getWeekStartTs();
  return db.prepare(`
    SELECT m.*, u.display_name, c.name as channel_name
    FROM messages m
    LEFT JOIN users u ON m.user_id = u.user_id
    LEFT JOIN channels c ON m.channel_id = c.channel_id
    WHERE m.analyzed_at IS NULL
      AND CAST(m.ts AS REAL) >= ?
      AND m.text != ''
      AND m.is_reply = 0
      AND (c.is_member = 1 OR c.is_member IS NULL)
    ORDER BY CAST(m.ts AS REAL) ASC
  `).all(weekStartTs);
}

function buildContext() {
  const openFollowUps = followUpOps.getOpenTexts();
  const candidateTexts = followUpOps.getCandidateTexts();
  const recentFinishedTexts = followUpOps.getRecentFinishedTexts();
  const dismissedTexts = followUpOps.getDismissedTexts();

  const openFollowUpsText = openFollowUps.length > 0
    ? openFollowUps.map(f => {
        const msgs = f.source_messages ? JSON.parse(f.source_messages) : [];
        const msgBlock = msgs.length > 0
          ? `\n  Original messages:\n${msgs.map(m => `    > ${m}`).join('\n')}` : '';
        return `[ID:${f.id}] ${f.text}${f.channel_name ? ` (in #${f.channel_name})` : ''}${f.context ? `\n  Context: ${f.context}` : ''}${msgBlock}`;
      }).join('\n\n')
    : 'None';

  return {
    openFollowUps,
    openFollowUpsText,
    recentFinishedList: recentFinishedTexts.length > 0
      ? recentFinishedTexts.map(t => `- ${t}`).join('\n') : 'None',
    dismissedList: dismissedTexts.length > 0
      ? dismissedTexts.map(t => `- ${t}`).join('\n') : 'None',
    candidateList: candidateTexts.length > 0
      ? candidateTexts.map(t => `- ${t}`).join('\n') : 'None'
  };
}

function sanitizeForPrompt(text, userMap = {}) {
  if (!text) return '';
  // Resolve <@USER_ID> mentions to real names
  let resolved = text.replace(/<@([A-Z0-9]+)>/g, (_, uid) => {
    const name = userMap[uid];
    return name ? `@${name}` : `@${uid}`;
  });
  return resolved
    .replace(/\r?\n/g, ' ')
    .replace(/"/g, '\u201c')
    .replace(/\\(?![/bfnrtu"])/g, '/')
    .slice(0, 200);
}

// Format a message clearly so Claude understands channel=who you're talking to, author=who wrote it
function formatMessage(msg, index, alonUserId = null, userMap = {}) {
  const author = msg.display_name || msg.user_id || 'Unknown';
  const channel = msg.channel_name || msg.channel_id;
  const isDM = !channel.startsWith('particle') && !channel.includes('-') && !channel.includes('_') && !channel.includes(' ');
  const channelLabel = isDM ? `DM with ${channel}` : `#${channel}`;
  const text = sanitizeForPrompt(msg.text, userMap);
  // Flag direct @mentions of Alon so Claude treats them as high-priority
  const mentionsAlon = alonUserId && msg.text?.includes(`<@${alonUserId}>`);
  const tag = mentionsAlon ? ' [⚑ @Alon MENTIONED]' : '';
  return `[${index}] ${channelLabel} | ${author} wrote:${tag} ${text}`;
}

// ─── Round 1 prompt: identify relevant message indices ────────────────────────
// Sonnet's job here is purely to reason about which messages deserve attention.
// It returns a simple JSON array of integers — no task extraction yet.
function buildTriagePrompt(allMessages, alonUserId = null, userMap = {}) {
  const messagesText = allMessages.map((msg, i) => formatMessage(msg, i, alonUserId, userMap)).join('\n');

  return `You are reviewing Slack messages for a manager named Alon Katz.

Your ONLY task: identify which messages are worth investigating for tasks, follow-ups, or completions.

**ALWAYS include** a message if it:
- Mentions "@Alon Katz" directly — this is a direct address to the manager and is always important
- Is tagged [⚑ @Alon MENTIONED] — same reason
- Is a self-note by Alon (anything written in a personal channel like "Alon Katz")

Also include if it:
- Contains any request, ask, or instruction — even implicit ("can you...", "please...", "we need to...")
- Shows a task being assigned, delegated, completed, or confirmed
- Involves a scheduling item, deadline, or meeting that may require action
- Raises a question or issue that likely needs Alon's attention
- Shows that something was resolved or delivered

Exclude only messages that are obviously pure noise: emoji-only reactions, one-word acknowledgments with no new information ("ok", "thanks", "👍"), or completely unrelated social chit-chat.

When uncertain — include it. Round 2 will make the final decision.

Messages (${allMessages.length} total):
${messagesText}

Return ONLY a JSON array of integer indices. Example: [0, 3, 7, 15, 42]
No explanation, no other text.`;
}

// ─── Round 2 prompt: extract and classify from filtered messages ──────────────
// Messages are shown with their ORIGINAL global indices so source_indices
// in the output map correctly back to allMessages[].
function buildClassifyPrompt(filteredMessages, ctx, alonUserId = null, userMap = {}) {
  const messagesText = filteredMessages
    .map(({ globalIndex, msg }) => formatMessage(msg, globalIndex, alonUserId, userMap))
    .join('\n');

  return `You are analyzing action-relevant Slack messages for a professional named Alon Katz.
These messages have already been filtered for relevance. Each [N] is the original message index — use these exact numbers in your response.

## OPEN FOLLOW-UPS (currently tracked — check these for resolution):
${ctx.openFollowUpsText}

## RECENTLY FINISHED (resolved this week — do NOT re-add):
${ctx.recentFinishedList}

## DISMISSED (deleted by user — do NOT re-add):
${ctx.dismissedList}

## AWAITING REVIEW (already candidates — do NOT re-flag):
${ctx.candidateList}

## MESSAGES TO ANALYZE (${filteredMessages.length} total):
${messagesText}

---

**PHASE 1 — Resolve existing tasks:**
Check every OPEN FOLLOW-UP. If these messages show it was completed (evidence the outcome happened in the real world: link shared, answer given, file sent, confirmed done with evidence) → resolved_follow_ups.

**PHASE 2 — Extract new items:**
- Clearly pending → "new_follow_ups"
- Requested AND actually completed (outcome delivered) → "completed_follow_ups"
- Unsure → "candidate_follow_ups"

**PHASE 3 — Lenient candidate pass:**
Flag anything that even remotely could be a task. Alon will decide.

CRITICAL — Completed vs Open:
The test is whether the work happened in the real world. INTENT or COMMITMENT (agreeing to do something, saying you'll handle it) means the task is still open — not completed. Only mark completed when there is concrete evidence of delivery.

For every item set:
- **priority**: "high" | "medium" | "low"
- **task_type**: "task" | "followup" | "decision"

Priority rules:
- "high": Tomer Wilf Lezmy or Omer Barak involved, external client (Ronja/Blurr/Sagi/Efi), Alon self-note in personal channel, explicit urgency ("ASAP", "urgent", "by EOD/tomorrow"), someone blocked waiting on Alon
- "medium": Ravit involved, implied time pressure, business impact
- "low": Quick single-step asks, routine questions, no urgency

Task type:
- "task": Someone asked Alon to DO something, OR Alon wrote a self-note
- "followup": Alon asked/delegated to someone and is waiting on them
- "decision": Needs judgment or agreement before action

Respond with ONLY this JSON:
{
  "resolved_follow_ups": [
    { "id": <ID from OPEN FOLLOW-UPS>, "evidence_indices": [0, 2] }
  ],
  "new_follow_ups": [
    {
      "text": "clear actionable description",
      "channel_name": "channel name (without #)",
      "context": "1 sentence: why this needs follow-up",
      "priority": "high|medium|low",
      "task_type": "task|followup|decision",
      "source_indices": [0, 1]
    }
  ],
  "completed_follow_ups": [
    {
      "text": "what was done",
      "channel_name": "channel name (without #)",
      "context": "1 sentence: what happened",
      "priority": "medium",
      "task_type": "task",
      "source_indices": [0],
      "evidence_indices": [3]
    }
  ],
  "candidate_follow_ups": [
    {
      "text": "potential task description",
      "channel_name": "channel name (without #)",
      "context": "1 sentence: why flagged",
      "priority": "low|medium|high",
      "task_type": "task|followup|decision",
      "source_indices": [2]
    }
  ],
  "skipped_duplicates": [
    { "existing_id": <ID>, "reason": "one short sentence" }
  ]
}

Rules:
- source_indices and evidence_indices are INTEGERS from the [N] numbers above. Never include message text.
- SEMANTIC DEDUP: New task semantically matching an existing one → skipped_duplicates.
- ONE TASK PER SITUATION: Multiple messages about same issue → ONE task.
- Max 20 new_follow_ups and 20 candidate_follow_ups total.
- Return ONLY the JSON.`;
}

// ─── JSON repair ──────────────────────────────────────────────────────────────

function repairJson(s) {
  let inString = false, escaped = false, out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escaped) { out += c; escaped = false; continue; }
    if (c === '\\' && inString) { out += c; escaped = true; continue; }
    if (c === '"') { inString = !inString; out += c; continue; }
    if (inString) {
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
    }
    out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function stripProblematicArrays(json) {
  const cutField = (j, field) => {
    const idx = j.lastIndexOf(`"${field}"`);
    if (idx === -1) return j;
    return j.slice(0, idx).trimEnd().replace(/,\s*$/, '') + '\n}';
  };
  let s = cutField(json, 'message_classifications');
  s = cutField(s, 'skipped_duplicates');
  return s.replace(/,(\s*[}\]])/g, '$1');
}

function parseClaudeJson(jsonStr) {
  try { return JSON.parse(jsonStr); } catch (_) {}
  try { return JSON.parse(repairJson(jsonStr)); } catch (_) {}
  const stripped = stripProblematicArrays(jsonStr);
  try { return JSON.parse(stripped); } catch (_) {}
  try { return JSON.parse(repairJson(stripped)); } catch (err) {
    throw new Error(`JSON repair failed: ${err.message} | near: ${jsonStr.slice(0, 80)}`);
  }
}

// Safe Claude call with timeout and 429 retry
async function claudeCall(prompt, maxTokens) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      }, { signal: controller.signal });
      clearTimeout(timeoutId);
      return response.content[0].text.trim();
    } catch (err) {
      clearTimeout(timeoutId);
      const is429 = err.status === 429 || err.message?.includes('rate_limit');
      const isTimeout = err.name === 'AbortError' || err.message?.includes('aborted');
      if (isTimeout) throw new Error('Claude timed out (>2min)');
      if (is429 && attempt === 0) {
        console.warn('[Claude] Rate limited — waiting 35s');
        await new Promise(r => setTimeout(r, 35000));
        continue;
      }
      throw err;
    }
  }
}

// ─── Process result ───────────────────────────────────────────────────────────

function processResult(result, allMessages) {
  const stats = { resolved: 0, added: 0, completed: 0, candidates: 0, skipped: 0 };

  function idxToMsg(i) {
    if (typeof i !== 'number' || i < 0 || i >= allMessages.length) return null;
    const m = allMessages[i];
    const person = m.display_name || m.user_id || 'Unknown';
    const channel = m.channel_name || m.channel_id;
    return `[#${channel}] [${person}]: ${(m.text || '').replace(/\r?\n/g, ' ').slice(0, 150)}`;
  }

  function indicesToMessages(indices) {
    if (!Array.isArray(indices) || indices.length === 0) return null;
    return indices.filter(i => typeof i === 'number').slice(0, 5).map(idxToMsg).filter(Boolean);
  }

  function indicesToDate(indices) {
    if (!Array.isArray(indices) || indices.length === 0) return null;
    const valid = indices.filter(i => typeof i === 'number' && i >= 0 && i < allMessages.length);
    if (valid.length === 0) return null;
    const latestTs = Math.max(...valid.map(i => parseFloat(allMessages[i].ts || 0)));
    return latestTs > 0 ? new Date(latestTs * 1000).toISOString() : null;
  }

  const currentKeys = new Set([
    ...followUpOps.getOpenTexts().map(f => f.text.toLowerCase().trim()),
    ...followUpOps.getCandidateTexts().map(t => t.toLowerCase().trim()),
    ...followUpOps.getRecentFinishedTexts().map(t => t.toLowerCase().trim())
  ]);

  for (const r of (result.resolved_follow_ups || [])) {
    if (!r.id) continue;
    const evidence = indicesToMessages(r.evidence_indices);
    const resolvedAt = indicesToDate(r.evidence_indices);
    followUpOps.resolve(r.id, 'claude', evidence ? JSON.stringify(evidence) : null, resolvedAt);
    console.log(`[Claude]   ✓ Resolved #${r.id}${resolvedAt ? ' (' + resolvedAt.slice(0,10) + ')' : ''}`);
    stats.resolved++;
  }

  for (const item of (result.new_follow_ups || [])) {
    const key = item.text.toLowerCase().trim();
    if (currentKeys.has(key)) { console.log(`[Claude]   ~ Deduped: ${item.text.slice(0,60)}`); continue; }
    followUpOps.insertCandidate({ ...item, source: 'claude', source_messages: indicesToMessages(item.source_indices) });
    currentKeys.add(key);
    console.log(`[Claude]   + Candidate (new): ${item.text.slice(0,80)}`);
    stats.added++;
  }

  for (const item of (result.completed_follow_ups || [])) {
    const key = item.text.toLowerCase().trim();
    if (currentKeys.has(key)) { console.log(`[Claude]   ~ Deduped completed: ${item.text.slice(0,60)}`); continue; }
    const resolvedAt = indicesToDate(item.evidence_indices) || indicesToDate(item.source_indices);
    followUpOps.insertCandidate({
      ...item,
      source: 'claude',
      source_messages: indicesToMessages(item.source_indices),
      preResolved: true,
      resolution_evidence: JSON.stringify(indicesToMessages(item.evidence_indices) || []),
    });
    currentKeys.add(key);
    console.log(`[Claude]   ~ Candidate (pre-resolved): ${item.text.slice(0,80)}`);
    stats.completed++;
  }

  for (const item of (result.candidate_follow_ups || [])) {
    const key = item.text.toLowerCase().trim();
    if (currentKeys.has(key)) { console.log(`[Claude]   ~ Deduped candidate: ${item.text.slice(0,60)}`); continue; }
    followUpOps.insertCandidate({ ...item, source: 'claude', source_messages: indicesToMessages(item.source_indices) });
    currentKeys.add(key);
    console.log(`[Claude]   ? Candidate: ${item.text.slice(0,80)}`);
    stats.candidates++;
  }

  for (const s of (result.skipped_duplicates || [])) {
    console.log(`[Claude]   ⊘ Dup ID ${s.existing_id}: ${s.reason}`);
    stats.skipped++;
  }

  return stats;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function generateSummary(forceRegenerate = false, sendProgress = null) {
  const today = getIsraelDate(0);
  const emit = (data) => { try { if (sendProgress) sendProgress(data); } catch (_) {} };

  if (forceRegenerate) {
    followUpOps.clearAll();
    summaryOps.clearAll();
    messageOps.markAllUnanalyzed();
    console.log('[Claude] Force refresh — full clean slate');
  }

  const allMessages = await resolveLinksInMessages(getUnanalyzedMessages());

  if (allMessages.length === 0) {
    emit({ currentChannel: null, channelsDone: 0, channelsTotal: 0, done: true });
    console.log('[Claude] No new messages to analyze');
    processingState.running = false;
    processingState.lastResult = {
      cached: true,
      summary: summaryOps.getLatest()?.summary_text || null,
      followUps: followUpOps.getAll('open'),
      finished: followUpOps.getAll('finished'),
      candidates: followUpOps.getAll('candidate'),
      generatedAt: new Date().toISOString(),
      newMessagesProcessed: 0
    };
    return processingState.lastResult;
  }

  const uniqueChannels = [...new Set(allMessages.map(m => m.channel_name || m.channel_id))];
  emit({ currentChannel: null, channelsDone: 0, channelsTotal: uniqueChannels.length });
  console.log(`[Claude] ── Round 1 (triage): ${allMessages.length} messages across ${uniqueChannels.length} channels`);

  processingState.running = true;
  processingState.startedAt = new Date().toISOString();
  processingState.error = null;

  // Build user ID → display name map for resolving <@USER_ID> mentions in messages
  let userMap = {};
  try {
    const allUsers = db.prepare('SELECT user_id, display_name FROM users WHERE display_name IS NOT NULL').all();
    for (const u of allUsers) userMap[u.user_id] = u.display_name;
  } catch (_) {}

  // Look up Alon's Slack user_id so we can detect direct @mentions
  let alonUserId = null;
  try {
    const alonUser = db.prepare(`SELECT user_id FROM users WHERE LOWER(display_name) LIKE '%alon%katz%' LIMIT 1`).get();
    if (alonUser) {
      alonUserId = alonUser.user_id;
      console.log(`[Claude] Alon's Slack user_id: ${alonUserId} | user map: ${Object.keys(userMap).length} users`);
    }
  } catch (_) {}

  // Force-include any message that directly @mentions Alon
  const mentionForcedIndices = new Set(
    alonUserId
      ? allMessages.map((m, i) => ({ i, text: m.text || '' }))
          .filter(({ text }) => text.includes(`<@${alonUserId}>`))
          .map(({ i }) => i)
      : []
  );
  if (mentionForcedIndices.size > 0) {
    console.log(`[Claude] ── Force-including ${mentionForcedIndices.size} messages that @mention Alon`);
  }

  processingState.stage = 'triage';
  let flaggedIndices;
  try {
    const triageRaw = await claudeCall(buildTriagePrompt(allMessages, alonUserId, userMap), 2000);
    const match = triageRaw.match(/\[[\d,\s\n\r]+\]/);
    if (!match) throw new Error(`No index array in response: ${triageRaw.slice(0, 80)}`);
    const triageIndices = JSON.parse(match[0])
      .filter(i => typeof i === 'number' && i >= 0 && i < allMessages.length);
    // Merge triage with force-included @mention messages
    flaggedIndices = [...new Set([...triageIndices, ...mentionForcedIndices])];
    console.log(`[Claude] ── Round 1 done: ${flaggedIndices.length}/${allMessages.length} flagged (${mentionForcedIndices.size} @mention force-included)`);
  } catch (err) {
    console.error('[Claude] Round 1 failed — falling back to all messages:', err.message);
    flaggedIndices = allMessages.map((_, i) => i);
  }

  if (flaggedIndices.length === 0) {
    console.log('[Claude] No action-relevant messages found');
    messageOps.markAnalyzed(allMessages.map(m => ({ ts: m.ts, channel_id: m.channel_id })));
    processingState.running = false;
    processingState.lastResult = {
      cached: false, summary: null,
      followUps: followUpOps.getAll('open'),
      finished: followUpOps.getAll('finished'),
      candidates: followUpOps.getAll('candidate'),
      generatedAt: new Date().toISOString(),
      newMessagesProcessed: allMessages.length
    };
    return processingState.lastResult;
  }

  // ── Round 2: Sonnet classify — extract and structure tasks ─────────────────
  processingState.stage = 'classify';
  // Preserve original global indices so source_indices in the output map correctly to allMessages[]
  const filteredMessages = flaggedIndices.map(i => ({ globalIndex: i, msg: allMessages[i] }));
  console.log(`[Claude] ── Round 2 (classify): ${filteredMessages.length} flagged messages → Sonnet`);
  emit({ currentChannel: 'classifying', channelsDone: uniqueChannels.length - 1, channelsTotal: uniqueChannels.length });

  const ctx = buildContext();
  let result;
  try {
    const classifyRaw = await claudeCall(buildClassifyPrompt(filteredMessages, ctx, alonUserId, userMap), 8000);
    const jsonMatch = classifyRaw.match(/\{[\s\S]*\}/);
    result = parseClaudeJson(jsonMatch ? jsonMatch[0] : classifyRaw);
  } catch (err) {
    console.error('[Claude] Round 2 classification failed:', err.message);
    processingState.running = false;
    processingState.error = err.message;
    throw err;
  }

  // Mark all messages analyzed (including ones filtered out in Round 1)
  messageOps.markAnalyzed(allMessages.map(m => ({ ts: m.ts, channel_id: m.channel_id })));

  const stats = processResult(result, allMessages);
  console.log(`[Claude] ══ Done. ${stats.resolved} resolved, ${stats.added} tasks, ${stats.completed} completed, ${stats.candidates} candidates | ${flaggedIndices.length}/${allMessages.length} msgs reached Round 2`);

  const summary = result.summary || null;
  summaryOps.upsert(today, summary, null, allMessages.length);

  processingState.running = false;
  processingState.stage = null;
  processingState.lastResult = {
    cached: false,
    summary,
    followUps: followUpOps.getAll('open'),
    finished: followUpOps.getAll('finished'),
    candidates: followUpOps.getAll('candidate'),
    generatedAt: new Date().toISOString(),
    newMessagesProcessed: allMessages.length
  };

  return processingState.lastResult;
}

// ─── Standup generator ────────────────────────────────────────────────────────
async function generateStandup() {
  const today = getIsraelDate(0);
  const yesterday = getIsraelDate(1);

  // Get recently resolved tasks (last 2 days)
  const recentDone = db.prepare(`
    SELECT text, context, channel_name FROM follow_ups
    WHERE status IN ('finished', 'resolved')
      AND resolved_at >= ?
    ORDER BY resolved_at DESC LIMIT 15
  `).all(new Date(Date.now() - 2 * 86400000).toISOString());

  // Get current open tasks
  const openTasks = followUpOps.getAll('open').slice(0, 15);

  const doneList = recentDone.length > 0
    ? recentDone.map(t => `- ${t.text}${t.channel_name ? ` (#${t.channel_name})` : ''}`).join('\n')
    : '- Nothing resolved recently';

  const openList = openTasks.length > 0
    ? openTasks.map(t => `- [${t.priority}] ${t.text}`).join('\n')
    : '- No open tasks';

  const prompt = `You are helping Alon Katz write his daily standup update for his team.

Based on the following:

## RECENTLY COMPLETED (yesterday/today)
${doneList}

## CURRENTLY OPEN TASKS
${openList}

Write a professional, concise standup in this format:
**Yesterday:**
[What was done — summarize from completed tasks, natural language, not bullet points]

**Today:**
[What he'll focus on — infer from open high priority tasks]

**Blockers:**
[Any blockers apparent from the task context, or write "None" if none detected]

Keep each section to 2-4 sentences. Be specific and professional. Do not use brackets or template placeholders.`;

  const result = await claudeCall(prompt, 1000);
  return result.trim();
}

module.exports = { generateSummary, generateStandup, getIsraelDate, getProcessingState };
