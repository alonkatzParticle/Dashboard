require('dotenv').config();
const axios = require('axios');
const { tokenOps, userOps, channelOps, messageOps } = require('./db');

const SLACK_API = 'https://slack.com/api';

// Initialize tokens from env if DB is empty
function initTokensIfNeeded() {
  const existing = tokenOps.get();
  if (!existing) {
    console.log('[Slack] Initializing tokens from .env (no rotation — token is permanent)');
    // Token rotation is not enabled, so use a far-future expiry (1 year)
    const oneYearFromNow = Date.now() + 365 * 24 * 60 * 60 * 1000;
    tokenOps.upsert(
      process.env.SLACK_ACCESS_TOKEN,
      process.env.SLACK_REFRESH_TOKEN,
      oneYearFromNow
    );
  }
}

// Get a valid access token, refreshing only if rotation is enabled
async function getValidToken() {
  initTokensIfNeeded();
  const tokens = tokenOps.get();

  // Only attempt refresh if token expires within 5 minutes
  const fiveMinutes = 5 * 60 * 1000;
  if (!tokens || tokens.expires_at < Date.now() + fiveMinutes) {
    console.log('[Slack] Token near expiry, attempting refresh...');
    try {
      return await refreshAccessToken(tokens?.refresh_token || process.env.SLACK_REFRESH_TOKEN);
    } catch (err) {
      if (err.message.includes('token_rotation_not_enabled')) {
        // Rotation is off — token is permanent, extend expiry
        console.log('[Slack] Token rotation is not enabled, token is permanent. Extending expiry.');
        const oneYearFromNow = Date.now() + 365 * 24 * 60 * 60 * 1000;
        tokenOps.upsert(tokens.access_token, tokens.refresh_token, oneYearFromNow);
        return tokens.access_token;
      }
      throw err;
    }
  }

  return tokens.access_token;
}

// Refresh the access token using the refresh token
async function refreshAccessToken(currentRefreshToken) {
  try {
    const params = new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      grant_type: 'refresh_token',
      token: currentRefreshToken
    });

    const response = await axios.post('https://slack.com/api/oauth.v2.exchange', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const data = response.data;
    if (!data.ok) {
      console.error('[Slack] Full refresh error response:', JSON.stringify(data));
      throw new Error(`Token refresh failed: ${data.error}`);
    }

    const expiresAt = Date.now() + (data.expires_in * 1000);
    tokenOps.upsert(data.access_token, data.refresh_token, expiresAt);

    console.log('[Slack] Token refreshed, expires in', Math.round(data.expires_in / 3600), 'hours');
    return data.access_token;
  } catch (err) {
    console.error('[Slack] Token refresh error:', err.message);
    throw err;
  }
}

// Make an authenticated GET to Slack API
async function slackGet(endpoint, params = {}) {
  const token = await getValidToken();
  const response = await axios.get(`${SLACK_API}/${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
    params
  });

  if (!response.data.ok) {
    throw new Error(`Slack API ${endpoint}: ${response.data.error}`);
  }

  return response.data;
}

// Fetch and cache a user by ID
async function resolveUser(userId) {
  if (!userId) return null;

  const cached = userOps.get(userId);
  if (cached) return cached;

  try {
    const data = await slackGet('users.info', { user: userId });
    const profile = data.user.profile;
    const user = {
      user_id: userId,
      display_name: profile.display_name || profile.real_name || data.user.name,
      real_name: profile.real_name || data.user.name,
      username: data.user.name,
      avatar_url: profile.image_48 || null
    };
    userOps.upsert(user);
    return user;
  } catch (err) {
    console.warn(`[Slack] Could not fetch user ${userId}:`, err.message);
    return { user_id: userId, display_name: userId, real_name: userId, username: userId, avatar_url: null };
  }
}

// Fetch all channels (public, private, DMs)
async function fetchAllChannels() {
  const allChannels = [];
  const types = ['public_channel', 'private_channel', 'mpim', 'im'];

  for (const type of types) {
    let cursor = null;
    do {
      const params = { types: type, limit: 200, exclude_archived: true };
      if (cursor) params.cursor = cursor;

      let data;
      try {
        data = await slackGet('conversations.list', params);
      } catch (err) {
        console.warn(`[Slack] Could not list ${type}:`, err.message);
        break;
      }

      for (const ch of data.channels) {
        if (ch.is_member === false && type !== 'im') continue;

        // For DMs, resolve the other person's name
        let name = ch.name || ch.id;
        if (type === 'im' && ch.user) {
          const user = await resolveUser(ch.user);
          name = user?.display_name || user?.real_name || ch.user;
        }

        // For group DMs (mpim), fetch members and build a names list
        if (type === 'mpim') {
          try {
            const myId = await getMyUserId();
            const membersData = await slackGet('conversations.members', { channel: ch.id, limit: 20 });
            const otherIds = (membersData.members || []).filter(id => id !== myId);
            const names = await Promise.all(otherIds.map(async id => {
              const u = await resolveUser(id);
              return u?.display_name || u?.real_name || id;
            }));
            if (names.length > 0) name = names.join(', ');
          } catch (err) {
            console.warn(`[Slack] Could not resolve group DM members for ${ch.id}:`, err.message);
          }
        }

        const channel = {
          channel_id: ch.id,
          name,
          type,
          is_member: ch.is_member !== false
        };
        channelOps.upsert(channel);
        allChannels.push(channel);
      }

      cursor = data.response_metadata?.next_cursor || null;
    } while (cursor);
  }

  console.log(`[Slack] Discovered ${allChannels.length} channels`);
  return allChannels;
}

// Fetch messages for a channel between two Unix timestamps
async function fetchMessages(channelId, oldestTs, latestTs) {
  const messages = [];
  let cursor = null;

  do {
    const params = {
      channel: channelId,
      oldest: oldestTs.toString(),
      latest: latestTs.toString(),
      limit: 200,
      inclusive: false
    };
    if (cursor) params.cursor = cursor;

    let data;
    try {
      data = await slackGet('conversations.history', params);
    } catch (err) {
      if (err.message.includes('not_in_channel') || err.message.includes('channel_not_found')) {
        console.warn(`[Slack] Skipping ${channelId}: ${err.message}`);
        return messages;
      }
      throw err;
    }

    for (const msg of data.messages) {
      if (msg.type !== 'message' || msg.subtype === 'channel_join') continue;

      await resolveUser(msg.user);

      messageOps.upsert({
        ts: msg.ts,
        channel_id: channelId,
        user_id: msg.user || null,
        text: msg.text || '',
        thread_ts: msg.thread_ts || null,
        is_reply: !!(msg.thread_ts && msg.thread_ts !== msg.ts),
        has_replies: (msg.reply_count || 0) > 0,
        reply_count: msg.reply_count || 0,
        reactions: msg.reactions || [],
        message_type: 'message',
        raw_json: msg
      });

      messages.push(msg);
    }

    cursor = data.response_metadata?.next_cursor || null;
  } while (cursor);

  return messages;
}

// Get the authenticated user's own Slack user ID
let _myUserId = null;
async function getMyUserId() {
  if (_myUserId) return _myUserId;
  const data = await slackGet('auth.test');
  _myUserId = data.user_id;
  return _myUserId;
}

module.exports = { getValidToken, refreshAccessToken, fetchAllChannels, fetchMessages, resolveUser, getMyUserId };
