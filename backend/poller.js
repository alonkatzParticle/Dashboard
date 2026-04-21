require('dotenv').config();
const cron = require('node-cron');
const { fetchAllChannels, fetchMessages, getMyUserId } = require('./slack');
const { channelOps, syncOps, syncLogOps } = require('./db');
const { getWeekStartTs } = require('./timeUtils');

// Check if current time is within working hours (Israel time, Sun-Thu, 10am-7pm)
function isWorkingHours() {
  const now = new Date();
  // Convert to Israel time (UTC+3 for IDT)
  const israelTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const day = israelTime.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const hour = israelTime.getHours();

  const isWorkDay = day >= 0 && day <= 4; // Sunday–Thursday
  const isWorkHour = hour >= 10 && hour < 19; // 10am–7pm

  return isWorkDay && isWorkHour;
}

let isSyncing = false;
let lastSyncTime = null;
let nextSyncTime = null;

// Main sync function - fetches all channels from last_fetched to now
async function runSync(isManual = false) {
  if (isSyncing) {
    console.log('[Poller] Sync already in progress, skipping');
    return { skipped: true, reason: 'already_syncing' };
  }

  if (!isManual && !isWorkingHours()) {
    console.log('[Poller] Outside working hours, skipping scheduled sync');
    return { skipped: true, reason: 'outside_working_hours' };
  }

  isSyncing = true;
  const logId = await syncLogOps.start();
  const nowTs = Math.floor(Date.now() / 1000);
  let totalMessages = 0;
  let channelsSynced = 0;

  console.log(`[Poller] Starting sync at ${new Date().toISOString()} (${isManual ? 'manual' : 'scheduled'})`);

  try {
    // Ensure we know our own user ID
    await getMyUserId();

    // Refresh channel list
    await fetchAllChannels();

    const channels = channelOps.getAll();
    console.log(`[Poller] Syncing ${channels.length} channels`);

    const BATCH = 5 // parallel Slack API calls at once — safe under Tier 3 limits
    for (let i = 0; i < channels.length; i += BATCH) {
      const batch = channels.slice(i, i + BATCH)
      await Promise.all(batch.map(async (channel) => {
        try {
          const state = syncOps.get(channel.channel_id)
          const weekStartTs = getWeekStartTs()
          const oldestTs = state?.last_fetched_ts || weekStartTs

          if (oldestTs >= nowTs) return // already up to date

          const messages = await fetchMessages(channel.channel_id, oldestTs, nowTs)
          syncOps.update(channel.channel_id, nowTs, messages.length)

          totalMessages += messages.length
          channelsSynced++

          if (messages.length > 0) {
            console.log(`[Poller] ${channel.name}: fetched ${messages.length} messages`)
          }
        } catch (err) {
          console.error(`[Poller] Error syncing channel ${channel.name}:`, err.message)
        }
      }))
    }


    await syncLogOps.complete(logId, channelsSynced, totalMessages);
    lastSyncTime = new Date().toISOString();
    console.log(`[Poller] Sync complete: ${totalMessages} messages across ${channelsSynced} channels`);

    return { success: true, totalMessages, channelsSynced };
  } catch (err) {
    await syncLogOps.fail(logId, err.message);
    console.error('[Poller] Sync failed:', err.message);
    throw err;
  } finally {
    isSyncing = false;
  }
}

// Calculate next scheduled sync time
function updateNextSyncTime() {
  const now = new Date();
  const next = new Date(now.getTime() + 15 * 60 * 1000);
  nextSyncTime = next.toISOString();
}

// Start the polling scheduler
function startPoller() {
  console.log('[Poller] Starting scheduler (every 15 min, Sun-Thu 10am-7pm Israel time)');

  // Run a catch-up sync immediately on startup
  console.log('[Poller] Running startup catch-up sync...');
  runSync(true).catch(err => console.error('[Poller] Startup sync error:', err.message));

  // Schedule every 15 minutes
  cron.schedule('*/15 * * * *', () => {
    updateNextSyncTime();
    runSync(false).catch(err => console.error('[Poller] Scheduled sync error:', err.message));
  });

  updateNextSyncTime();
}

function getSyncStatus() {
  return {
    isSyncing,
    lastSyncTime,
    nextSyncTime,
    isWorkingHours: isWorkingHours()
  };
}

module.exports = { startPoller, runSync, getSyncStatus };
