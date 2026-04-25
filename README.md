# Time-Off Service
## Prerequisites
- Node.js 18+
- npm 9+
## Installation
```bash
npm install
```
## Running the Mock HCM Server
The mock HCM server must be running before starting the app or running integration tests.
```bash
npm run hcm:mock
```
The mock server starts on port 3001.
## Running the App
```bash
npm run start:dev
```
The app starts on port 3000.
## Running Tests
**Unit tests only:**
```bash
npm run test
```
**Unit tests with coverage:**
```bash
npm run test:cov
```
**Integration + E2E tests (requires mock HCM server running):**
```bash
npm run hcm:mock &
npm run test:integration
```
**All tests with full coverage:**
```bash
npm run hcm:mock &
npm run test:all
```
## API Reference
| Method | Path | Description |
| --- | --- | --- |
| GET | `/balance/:employeeId/:locationId` | Get cached local balance for an employee/location pair |
| POST | `/requests` | Create a new pending time-off request |
| GET | `/requests/:id` | Get a time-off request by id |
| PATCH | `/requests/:id/approve` | Approve a pending request (manager role required) |
| PATCH | `/requests/:id/reject` | Reject a pending request (manager role required) |
| PATCH | `/requests/:id/cancel` | Cancel a pending request (request owner only) |
| POST | `/sync/batch` | Batch-upsert local balances from payload |
| POST | `/sync/realtime` | Refresh one employee/location balance from HCM |
## Architecture Notes
This service uses a tiered consistency model to balance responsiveness with correctness:
- Read operations return cached balance plus `lastSyncedAt` (eventual consistency for reads).
- Write operations (`POST /requests`, approve flow) re-check live HCM balances before committing (strong consistency for writes).
- Optimistic locking via the `version` field prevents race conditions during concurrent approvals.