// dropbox_lib.js — ported from lib/dropbox.ts
// IMPORTANT: encodeDropboxArg is a critical bug fix for non-ASCII characters
// (smart quotes, Hebrew chars, multiplication signs, etc.) in file/folder names.
// These crash the Dropbox-API-Arg header if sent as raw UTF-8.
// Do NOT remove or simplify this function.

// Cache the short-lived access token so we don't refresh on every request
let cachedToken = null;
let tokenExpiresAt = 0;

function encodeDropboxArg(arg) {
  return JSON.stringify(arg).replace(/[\u007F-\uFFFF]/g, chr =>
    '\\u' + ('0000' + chr.charCodeAt(0).toString(16)).slice(-4)
  );
}

async function getDropboxToken() {
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;

  // If refresh credentials exist, use them (auto-refresh when near expiry)
  if (refreshToken && appKey && appSecret) {
    if (cachedToken && Date.now() < tokenExpiresAt - 5 * 60 * 1000) {
      return cachedToken;
    }
    const res = await fetch('https://api.dropbox.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: appKey,
        client_secret: appSecret,
      }),
    });
    if (!res.ok) throw new Error(`Dropbox token refresh failed: ${await res.text()}`);
    const data = await res.json();
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return cachedToken;
  }

  // Fall back to static token
  const staticToken = process.env.DROPBOX_TOKEN;
  if (!staticToken) throw new Error('No Dropbox credentials configured');
  return staticToken;
}

async function uploadToDropbox(fileBuffer, fileName, dropboxPath, accessToken) {
  const path = `${dropboxPath}/${fileName}`.replace(/\/+/g, '/');

  const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Dropbox-API-Arg': encodeDropboxArg({
        path,
        mode: 'add',
        autorename: true,
        mute: false,
      }),
      'Content-Type': 'application/octet-stream',
    },
    body: fileBuffer,
  });

  if (!response.ok) {
    const error = await response.text();
    return { success: false, error: `Dropbox upload failed: ${error}` };
  }

  const result = await response.json();
  return { success: true, path: result.path_display };
}

module.exports = { encodeDropboxArg, getDropboxToken, uploadToDropbox };
