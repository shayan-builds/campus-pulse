require('dotenv').config({ quiet: true });

const fs = require('fs/promises');
const path = require('path');
const pool = require('../db');

async function runMigrations(database = pool) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const migrationFiles = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const name of migrationFiles) {
    const sql = await fs.readFile(path.join(migrationsDir, name), 'utf8');
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(1129333840)');
      const alreadyApplied = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
      if (alreadyApplied.rowCount) {
        await client.query('COMMIT');
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      console.log(`Applied database migration ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

if (require.main === module) {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error('DATABASE_URL is required to run database migrations.');
    process.exitCode = 1;
  } else {
    runMigrations()
      .then(() => console.log('Database migrations are up to date.'))
      .catch((error) => {
        console.error(`Database migration failed: ${error.message}`);
        process.exitCode = 1;
      })
      .finally(() => pool.end());
  }
}

module.exports = { runMigrations };
