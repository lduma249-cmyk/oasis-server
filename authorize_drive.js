/**
 * One-time Google Drive authorization script.
 *
 * Run this ONCE:   node authorize_drive.js
 *
 * It opens a URL for you to visit, log in as yourself, and approve access.
 * Google then shows you a code — paste it back into the terminal.
 * This saves a token.json file that server_fixed.js will reuse forever
 * (until you revoke access), so you never have to do this again.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(__dirname, 'oauth-credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error('\n✗ Missing oauth-credentials.json');
    console.error('  Save the JSON you downloaded from Cloud Console as exactly:');
    console.error('  ' + CREDENTIALS_PATH + '\n');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  return raw.installed || raw.web;
}

async function main() {
  const { client_id, client_secret, redirect_uris } = loadCredentials();
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    (redirect_uris && redirect_uris[0]) || 'http://localhost'
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline', // gets us a refresh_token so this never expires
    scope: SCOPES,
    prompt: 'consent'
  });

  console.log('\n1) Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('\n2) Log in, click Allow.');
  console.log('3) Google will show you an address bar like http://localhost/?code=XXXX (it may show "site can\'t be reached" — that\'s fine, ignore it).');
  console.log('4) Copy just the code value after "code=" and paste it below.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Paste the code here: ', async (code) => {
    rl.close();
    try {
      const { tokens } = await oAuth2Client.getToken(code.trim());
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
      console.log('\n✓ Saved token to', TOKEN_PATH);
      console.log('  You will NOT need to do this again. server_fixed.js will use this automatically.\n');
    } catch (e) {
      console.error('\n✗ Failed to exchange code for token:', e.message);
      console.error('  Make sure you pasted only the code, not the whole URL.\n');
    }
  });
}

main();
