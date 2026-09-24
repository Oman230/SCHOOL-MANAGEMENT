// config/db.js
// This file sets up ONE shared connection pool to our PostgreSQL database.
// Every other file in the app imports "pool" from here instead of opening
// its own connection, which is more efficient and is the standard pattern.

const { Pool } = require('pg'); // "pg" is the official PostgreSQL client for Node.js
require('dotenv').config();     // loads variables from the .env file into process.env

// Create the pool using the credentials from our .env file
const pool = new Pool({
  host: process.env.DB_HOST,         // e.g. "localhost"
  port: process.env.DB_PORT,         // e.g. 5432
  database: process.env.DB_NAME,     // e.g. "school_system"
  user: process.env.DB_USER,         // e.g. "postgres"
  password: process.env.DB_PASSWORD, // your postgres password
});

const migrationQueries = [
  "ALTER TABLE teachers ADD COLUMN IF NOT EXISTS photo_url TEXT;",
  "ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_url TEXT;",
  "ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_name VARCHAR(100);",
  "ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_phone VARCHAR(20);",
  "ALTER TABLE teachers ALTER COLUMN photo_url TYPE TEXT;",
  "ALTER TABLE students ALTER COLUMN photo_url TYPE TEXT;",
  "CREATE TABLE IF NOT EXISTS announcements (id SERIAL PRIMARY KEY, title VARCHAR(150) NOT NULL, message TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW());",
];

async function ensureDatabaseSchema() {
  for (const query of migrationQueries) {
    try {
      await pool.query(query);
    } catch (error) {
      console.error('Schema migration failed:', error.message);
    }
  }
}

// Log a message the first time we successfully connect, just so we know it worked
pool.on('connect', async () => {
  console.log('✅ Connected to PostgreSQL database');
  await ensureDatabaseSchema();
});

// If something goes wrong with an idle client, log it instead of crashing silently
pool.on('error', (err) => {
  console.error('❌ Unexpected PostgreSQL error:', err);
});

pool.photoMigrationQueries = migrationQueries;

// Export the pool so routes/controllers can run queries like: pool.query('SELECT ...')
module.exports = pool;
