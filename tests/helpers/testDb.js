// Shared test database setup/teardown
// Requires a local PostgreSQL database named 'gridworld_test'
// Create it once with: createdb gridworld_test

require('dotenv').config({ path: require('path').join(__dirname, '../.env.test') });

const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

async function setupDb() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      prolific_pid TEXT,
      study_id TEXT,
      session_id TEXT,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      final_human_score INTEGER,
      final_ai_score INTEGER,
      total_steps INTEGER,
      completed BOOLEAN DEFAULT FALSE
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS game_events (
      id SERIAL PRIMARY KEY,
      session_id INTEGER REFERENCES sessions(id),
      turn_number INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      mode TEXT,
      action TEXT,
      thoughts TEXT,
      score INTEGER,
      position TEXT,
      test_phase BOOLEAN,
      robot_hiding BOOLEAN,
      ai_active BOOLEAN,
      response_time_ms INTEGER,
      message_text TEXT,
      snapshot JSONB
    )
  `);
}

async function clearTables() {
  const db = getPool();
  await db.query('TRUNCATE sessions, game_events RESTART IDENTITY CASCADE');
}

async function teardownDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getPool, setupDb, clearTables, teardownDb };
