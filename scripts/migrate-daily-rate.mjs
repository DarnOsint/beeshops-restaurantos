import pg from 'pg'

const projectRef = 'qdibeyhdrcrddckouqmc'
const jwt = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!jwt) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY env var')
  process.exit(1)
}

const configs = [
  // Direct connection (IPv4 might work with some DNS configs)
  {
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: jwt,
    ssl: { rejectUnauthorized: false },
  },
  // Session pooler
  {
    host: 'aws-0-eu-west-1.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: `postgres.${projectRef}`,
    password: jwt,
    ssl: { rejectUnauthorized: false },
  },
  // Transaction pooler
  {
    host: 'aws-0-eu-west-1.pooler.supabase.com',
    port: 6599,
    database: 'postgres',
    user: `postgres.${projectRef}`,
    password: jwt,
    ssl: { rejectUnauthorized: false },
  },
]

for (const config of configs) {
  const client = new pg.Client(config)
  try {
    console.log(`Trying ${config.host}:${config.port} as ${config.user}...`)
    await client.connect()
    console.log('  Connected!')
    const result = await client.query("ALTER TABLE payroll ADD COLUMN IF NOT EXISTS daily_rate numeric(12,2) NOT NULL DEFAULT 0;")
    console.log('  Migration applied:', result.command)
    await client.end()
    console.log('  ✅ Success!')
    process.exit(0)
  } catch (err) {
    console.log(`  ❌ ${err.message}`)
    try { await client.end() } catch {}
  }
}

console.log('\nAll connection methods failed.')
