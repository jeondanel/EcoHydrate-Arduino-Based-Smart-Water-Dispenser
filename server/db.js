const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'ecohydrate.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
  }
});

// Initialize database schema
db.serialize(() => {
  // Event log table (bottle insertions, dispenses, errors)
  db.run(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Device status snapshots (for status history tracking)
  db.run(`
    CREATE TABLE IF NOT EXISTS status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      water_low INTEGER NOT NULL,  -- 0 for false, 1 for true
      bin_full INTEGER NOT NULL,   -- 0 for false, 1 for true
      tokens INTEGER NOT NULL,
      device_state INTEGER NOT NULL,
      logged_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Helper functions for database operations
const logEvent = (eventType, details) => {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO activity_logs (event_type, details) VALUES (?, ?)',
      [eventType, details],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

const logStatus = (waterLow, binFull, tokens, state) => {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO status_history (water_low, bin_full, tokens, device_state) VALUES (?, ?, ?, ?)',
      [waterLow ? 1 : 0, binFull ? 1 : 0, tokens, state],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

const getRecentLogs = (limit = 50) => {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT ?',
      [limit],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
};

const getStatusHistory = (limit = 100) => {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM status_history ORDER BY logged_at DESC LIMIT ?',
      [limit],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
};

const getAnalytics = () => {
  return new Promise((resolve, reject) => {
    const queries = {
      today: `
        SELECT 
          COALESCE(SUM(CASE WHEN event_type = 'TOKEN_ADDED' THEN 1 ELSE 0 END), 0) as bottles_collected,
          COALESCE(SUM(CASE WHEN event_type = 'TOKEN_SPENT' THEN 1 ELSE 0 END), 0) as tokens_spent
        FROM activity_logs 
        WHERE created_at >= datetime('now', 'start of day')
      `,
      week: `
        SELECT 
          COALESCE(SUM(CASE WHEN event_type = 'TOKEN_ADDED' THEN 1 ELSE 0 END), 0) as bottles_collected,
          COALESCE(SUM(CASE WHEN event_type = 'TOKEN_SPENT' THEN 1 ELSE 0 END), 0) as tokens_spent
        FROM activity_logs 
        WHERE created_at >= datetime('now', '-7 days')
      `,
      month: `
        SELECT 
          COALESCE(SUM(CASE WHEN event_type = 'TOKEN_ADDED' THEN 1 ELSE 0 END), 0) as bottles_collected,
          COALESCE(SUM(CASE WHEN event_type = 'TOKEN_SPENT' THEN 1 ELSE 0 END), 0) as tokens_spent
        FROM activity_logs 
        WHERE created_at >= datetime('now', 'start of month')
      `,
      year: `
        SELECT 
          COALESCE(SUM(CASE WHEN event_type = 'TOKEN_ADDED' THEN 1 ELSE 0 END), 0) as bottles_collected,
          COALESCE(SUM(CASE WHEN event_type = 'TOKEN_SPENT' THEN 1 ELSE 0 END), 0) as tokens_spent
        FROM activity_logs 
        WHERE created_at >= datetime('now', 'start of year')
      `
    };

    let results = {};
    db.get(queries.today, [], (err, todayRow) => {
      if (err) return reject(err);
      results.today = todayRow || { bottles_collected: 0, tokens_spent: 0 };
      
      db.get(queries.week, [], (err, weekRow) => {
        if (err) return reject(err);
        results.week = weekRow || { bottles_collected: 0, tokens_spent: 0 };
        
        db.get(queries.month, [], (err, monthRow) => {
          if (err) return reject(err);
          results.month = monthRow || { bottles_collected: 0, tokens_spent: 0 };
          
          db.get(queries.year, [], (err, yearRow) => {
            if (err) return reject(err);
            results.year = yearRow || { bottles_collected: 0, tokens_spent: 0 };
            
            resolve(results);
          });
        });
      });
    });
  });
};

module.exports = {
  db,
  logEvent,
  logStatus,
  getRecentLogs,
  getStatusHistory,
  getAnalytics
};
