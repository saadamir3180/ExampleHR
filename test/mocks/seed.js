const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const RESOLVED_DATABASE_PATH = process.env.DATABASE_PATH || './data/timeoff.sqlite';
const DATABASE_PATH =
  RESOLVED_DATABASE_PATH === ':memory:'
    ? ':memory:'
    : path.resolve(process.cwd(), RESOLVED_DATABASE_PATH);

if (DATABASE_PATH !== ':memory:') {
  fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
}

const db = new Database(DATABASE_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    locationId TEXT NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS balances (
    id TEXT PRIMARY KEY,
    employeeId TEXT NOT NULL,
    locationId TEXT NOT NULL,
    availableDays DECIMAL(5,2) NOT NULL,
    lastSyncedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    version INTEGER DEFAULT 1,
    UNIQUE(employeeId, locationId)
  );
`);

db.exec('DELETE FROM employees;');
db.exec('DELETE FROM balances;');

const employees = [
  { id: 'emp-001', name: 'Alice Smith', locationId: 'LOC-001' },
  { id: 'emp-001-loc2', name: 'Alice Smith', locationId: 'LOC-002' },
  { id: 'emp-002', name: 'Bob Jones', locationId: 'LOC-001' },
  { id: 'emp-003', name: 'Carol White', locationId: 'LOC-001' },
];

const balances = [
  { employeeId: 'emp-001', locationId: 'LOC-001', availableDays: 10 },
  { employeeId: 'emp-001', locationId: 'LOC-002', availableDays: 5 },
  { employeeId: 'emp-002', locationId: 'LOC-001', availableDays: 3 },
  { employeeId: 'emp-003', locationId: 'LOC-001', availableDays: 0 },
];

const employeeInsert = db.prepare(
  'INSERT INTO employees (id, name, locationId, createdAt) VALUES (?, ?, ?, ?)',
);
const balanceInsert = db.prepare(
  'INSERT INTO balances (id, employeeId, locationId, availableDays, lastSyncedAt, version) VALUES (?, ?, ?, ?, ?, ?)',
);

const now = new Date().toISOString();

const transaction = db.transaction(() => {
  for (const employee of employees) {
    employeeInsert.run(employee.id, employee.name, employee.locationId, now);
  }

  for (const balance of balances) {
    balanceInsert.run(
      crypto.randomUUID(),
      balance.employeeId,
      balance.locationId,
      balance.availableDays,
      now,
      1,
    );
  }
});

transaction();
db.close();

console.log(`Seed completed for database: ${DATABASE_PATH}`);
