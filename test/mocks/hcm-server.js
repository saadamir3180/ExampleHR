const express = require('express');

const app = express();
app.use(express.json());

const PORT = 3001;

const INITIAL_STORE = {
  'emp-001:LOC-001': 10,
  'emp-001:LOC-002': 5,
  'emp-002:LOC-001': 3,
  'emp-003:LOC-001': 0,
};

let store = { ...INITIAL_STORE };
let deductModes = {};

const buildKey = (employeeId, locationId) => `${employeeId}:${locationId}`;

app.get('/hcm/balance/:employeeId/:locationId', (req, res) => {
  const { employeeId, locationId } = req.params;
  const key = buildKey(employeeId, locationId);

  if (!(key in store)) {
    return res.status(404).json({ error: 'Not found' });
  }

  return res.json({
    employeeId,
    locationId,
    availableDays: store[key],
  });
});

app.post('/hcm/deduct', (req, res) => {
  const { employeeId, locationId, days } = req.body;
  const key = buildKey(employeeId, locationId);

  if (!(key in store)) {
    return res.status(404).json({ error: 'Not found' });
  }

  const deductMode = deductModes[key] ?? 'normal';
  if (deductMode === 'silent-noop') {
    return res.json({ success: true, remainingDays: store[key] });
  }

  if (store[key] < Number(days)) {
    if (Math.random() < 0.7) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    return res.status(200).end();
  }

  store[key] -= Number(days);
  return res.json({ success: true, remainingDays: store[key] });
});

app.post('/hcm/batch', (req, res) => {
  const payload = Array.isArray(req.body) ? req.body : [];

  for (const item of payload) {
    const key = buildKey(item.employeeId, item.locationId);
    store[key] = Number(item.availableDays);
  }

  return res.json({ received: payload.length });
});

app.post('/hcm/test/set-balance', (req, res) => {
  const { employeeId, locationId, availableDays } = req.body;
  const key = buildKey(employeeId, locationId);
  store[key] = Number(availableDays);
  return res.json({ ok: true });
});

app.post('/hcm/test/set-deduct-mode', (req, res) => {
  const { employeeId, locationId, mode } = req.body;
  const key = buildKey(employeeId, locationId);
  deductModes[key] = mode ?? 'normal';
  return res.json({ ok: true });
});

app.post('/hcm/test/reset', (_req, res) => {
  store = { ...INITIAL_STORE };
  deductModes = {};
  return res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Mock HCM server running on port ${PORT}`);
});
