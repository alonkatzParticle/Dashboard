require('dotenv').config();

const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;
const MONDAY_API_URL = 'https://api.monday.com/v2';

// In-memory cache: item_id → name (never expires during a run, fine for our use)
const itemCache = new Map();

// Extract all Monday item IDs from a block of text
// Handles both pulse URLs and board item URLs:
//   https://...monday.com/boards/123/pulses/456
//   https://...monday.com/boards/123/items/456 (newer format)
function extractMondayItemIds(text) {
  const ids = new Set();
  const re = /monday\.com\/[^\s"<>]*?\/(?:pulses|items)\/(\d+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    ids.add(m[1]);
  }
  return [...ids];
}

// Fetch item names from Monday API for a batch of IDs
async function fetchItemNames(ids) {
  if (!MONDAY_API_TOKEN || ids.length === 0) return {};

  const query = `
    query {
      items(ids: [${ids.join(',')}]) {
        id
        name
        board { name }
      }
    }
  `;

  try {
    const res = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': MONDAY_API_TOKEN,
        'API-Version': '2024-01'
      },
      body: JSON.stringify({ query })
    });
    const json = await res.json();
    const result = {};
    for (const item of (json?.data?.items || [])) {
      result[item.id] = item.board?.name
        ? `"${item.name}" (${item.board.name})`
        : `"${item.name}"`;
    }
    return result;
  } catch (err) {
    console.warn('[Monday] Failed to resolve item names:', err.message);
    return {};
  }
}

// Replace Monday URLs in a message text with human-readable names
// e.g. https://...monday.com/boards/123/pulses/456789 → Monday task "Neck Cream 12 Weeks Mobile" (Creative)
async function resolveMondayLinks(text) {
  if (!MONDAY_API_TOKEN || !text) return text;

  const ids = extractMondayItemIds(text);
  if (ids.length === 0) return text;

  // Check cache first, only fetch uncached IDs
  const uncached = ids.filter(id => !itemCache.has(id));
  if (uncached.length > 0) {
    const fetched = await fetchItemNames(uncached);
    for (const [id, name] of Object.entries(fetched)) {
      itemCache.set(id, name);
    }
  }

  // Replace each URL with a readable label
  let resolved = text;
  const re = /(https?:\/\/[^\s"<>]*?monday\.com\/[^\s"<>]*?\/(?:pulses|items)\/(\d+)[^\s"<>]*)/g;
  resolved = resolved.replace(re, (match, url, id) => {
    const name = itemCache.get(id);
    return name ? `Monday task ${name}` : match;
  });

  return resolved;
}

// Resolve all Monday links across an array of message objects (mutates .text in place)
async function resolveLinksInMessages(messages) {
  if (!MONDAY_API_TOKEN) return messages;

  // Collect all IDs from all messages first, then batch fetch
  const allIds = new Set();
  for (const msg of messages) {
    for (const id of extractMondayItemIds(msg.text || '')) {
      allIds.add(id);
    }
  }

  const uncached = [...allIds].filter(id => !itemCache.has(id));
  if (uncached.length > 0) {
    const fetched = await fetchItemNames(uncached);
    for (const [id, name] of Object.entries(fetched)) {
      itemCache.set(id, name);
    }
    if (uncached.length > 0) {
      console.log(`[Monday] Resolved ${Object.keys(fetched).length}/${uncached.length} item IDs`);
    }
  }

  // Now rewrite message texts
  for (const msg of messages) {
    if (msg.text && allIds.size > 0) {
      msg.text = await resolveMondayLinks(msg.text);
    }
  }

  return messages;
}

module.exports = { resolveLinksInMessages, resolveMondayLinks, extractMondayItemIds };
