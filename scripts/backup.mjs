// scripts/backup.mjs
// Exports core Oasis tables from Supabase and uploads a timestamped JSON
// snapshot into the "backups" Storage bucket. Run nightly via GitHub Actions.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars.');
  process.exit(1);
}

// Tables included in the backup. Add/remove names here as needed.
const TABLES = ['staff', 'customers', 'orders', 'payments'];

async function fetchTable(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${table}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  console.log('Starting Oasis backup...');

  const snapshot = { generated_at: new Date().toISOString() };

  for (const table of TABLES) {
    console.log(`Fetching ${table}...`);
    snapshot[table] = await fetchTable(table);
  }

  const filename = `backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  const body = JSON.stringify(snapshot, null, 2);

  console.log(`Uploading ${filename} (${(body.length / 1024).toFixed(1)} KB)...`);

  const uploadRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/backups/${filename}`,
    {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body,
    }
  );

  if (!uploadRes.ok) {
    throw new Error(`Upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }

  console.log('Backup uploaded successfully:', filename);
}

main().catch((err) => {
  console.error('Backup failed:', err);
  process.exit(1);
});
