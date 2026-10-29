/* The client ID and optional extension public key are public configuration, never secrets. */
const fs = require('node:fs');
const path = require('node:path');
function configureManifest(manifest, clientId, extensionKey) {
  if (!/^\d+-[\w-]+\.apps\.googleusercontent\.com$/.test(clientId || '')) {
    throw new Error('Supply the public Chrome-extension OAuth client ID from Google Cloud.');
  }
  if (extensionKey && (!/^[A-Za-z0-9+/]+={0,2}$/.test(extensionKey) || extensionKey.length < 100)) {
    throw new Error('The optional extension key must be its base64 public key.');
  }
  return {
    ...structuredClone(manifest),
    ...(extensionKey ? { key: extensionKey } : {}),
    oauth2: { client_id: clientId, scopes: [
      'openid', 'email', 'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/calendar.app.created',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly'
    ] }
  };
}
if (require.main === module) {
  try {
    const manifestPath = path.join(__dirname, '..', 'manifest.json');
    const clientId = process.argv[2];
    const keyIndex = process.argv.indexOf('--extension-key');
    const extensionKey = keyIndex < 0 ? undefined : process.argv[keyIndex + 1];
    if (keyIndex >= 0 && !extensionKey) throw new Error('Supply the public key after --extension-key.');
    const result = configureManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), clientId, extensionKey);
    fs.writeFileSync(manifestPath, JSON.stringify(result, null, 2) + '\n');
    console.log('Public OAuth configuration saved. Reload UM Spec and refresh Spectrum.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { configureManifest };
