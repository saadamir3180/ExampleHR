import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import axios from 'axios';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { Balance } from '../../src/balance/balance.entity';
import { Employee } from '../../src/employees/employee.entity';
import { TimeOffRequest } from '../../src/requests/requests.entity';

const HCM_BASE_URL = 'http://localhost:3001';

const EMPLOYEE_SEED = [
  { id: 'emp-001', name: 'Alice Smith', locationId: 'LOC-001' },
  { id: 'emp-001-loc2', name: 'Alice Smith', locationId: 'LOC-002' },
  { id: 'emp-002', name: 'Bob Jones', locationId: 'LOC-001' },
  { id: 'emp-003', name: 'Carol White', locationId: 'LOC-001' },
];

const BALANCE_SEED = [
  { employeeId: 'emp-001', locationId: 'LOC-001', availableDays: 10, version: 1 },
  { employeeId: 'emp-001', locationId: 'LOC-002', availableDays: 5, version: 1 },
  { employeeId: 'emp-002', locationId: 'LOC-001', availableDays: 3, version: 1 },
  { employeeId: 'emp-003', locationId: 'LOC-001', availableDays: 0, version: 1 },
];

describe('Requests API (integration)', () => {
  let app: INestApplication;
  let employeeRepository: Repository<Employee>;
  let balanceRepository: Repository<Balance>;
  let requestRepository: Repository<TimeOffRequest>;

  const resetHcm = async (): Promise<void> => {
    await axios.post(`${HCM_BASE_URL}/hcm/test/reset`);
  };

  const setHcmBalance = async (
    employeeId: string,
    locationId: string,
    availableDays: number,
  ): Promise<void> => {
    await axios.post(`${HCM_BASE_URL}/hcm/test/set-balance`, {
      employeeId,
      locationId,
      availableDays,
    });
  };

  const setHcmDeductMode = async (
    employeeId: string,
    locationId: string,
    mode: 'normal' | 'silent-noop',
  ): Promise<void> => {
    await axios.post(`${HCM_BASE_URL}/hcm/test/set-deduct-mode`, {
      employeeId,
      locationId,
      mode,
    });
  };

  const setLocalBalance = async (
    employeeId: string,
    locationId: string,
    availableDays: number,
  ): Promise<void> => {
    const existing = await balanceRepository.findOne({
      where: { employeeId, locationId },
    });
    if (!existing) {
      throw new Error('Seeded local balance row not found');
    }

    existing.availableDays = availableDays;
    existing.version += 1;
    await balanceRepository.save(existing);
  };

  const seedDatabase = async (): Promise<void> => {
    await requestRepository.clear();
    await balanceRepository.clear();
    await employeeRepository.clear();

    await employeeRepository.save(EMPLOYEE_SEED);
    await balanceRepository.save(BALANCE_SEED);
  };

  const createPendingRequest = async (days: number): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/requests')
      .send({
        employeeId: 'emp-001',
        locationId: 'LOC-001',
        days,
      })
      .expect(201);
    return response.body.id;
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3002';
    process.env.DATABASE_PATH = ':memory:';
    process.env.HCM_BASE_URL = HCM_BASE_URL;
    process.env.HCM_API_KEY = 'mock-hcm-key';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    employeeRepository = moduleFixture.get<Repository<Employee>>(
      getRepositoryToken(Employee),
    );
    balanceRepository = moduleFixture.get<Repository<Balance>>(
      getRepositoryToken(Balance),
    );
    requestRepository = moduleFixture.get<Repository<TimeOffRequest>>(
      getRepositoryToken(TimeOffRequest),
    );

    await resetHcm();
    await seedDatabase();
  });

  beforeEach(async () => {
    await resetHcm();
    await seedDatabase();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /requests', () => {
    it("returns 201 with status 'pending' when balance is sufficient", async () => {
      const response = await request(app.getHttpServer())
        .post('/requests')
        .send({
          employeeId: 'emp-001',
          locationId: 'LOC-001',
          days: 3,
        })
        .expect(201);

      expect(response.body.status).toBe('pending');
    });

    it('returns 400 when local balance is insufficient', async () => {
      await request(app.getHttpServer())
        .post('/requests')
        .send({
          employeeId: 'emp-003',
          locationId: 'LOC-001',
          days: 1,
        })
        .expect(400);
    });

    it('reconciles stale local cache with HCM before create validation', async () => {
      await setLocalBalance('emp-001', 'LOC-001', 1);

      const response = await request(app.getHttpServer())
        .post('/requests')
        .send({
          employeeId: 'emp-001',
          locationId: 'LOC-001',
          days: 3,
        })
        .expect(201);

      expect(response.body.status).toBe('pending');
      const localBalance = await balanceRepository.findOne({
        where: { employeeId: 'emp-001', locationId: 'LOC-001' },
      });
      expect(Number(localBalance?.availableDays)).toBe(10);
    });

    it('returns 400 when HCM balance is insufficient (set HCM balance to 0 via test helper)', async () => {
      await setHcmBalance('emp-001', 'LOC-001', 0);

      await request(app.getHttpServer())
        .post('/requests')
        .send({
          employeeId: 'emp-001',
          locationId: 'LOC-001',
          days: 1,
        })
        .expect(400);
    });

    it('returns 404 when employeeId/locationId combination has no balance record', async () => {
      await request(app.getHttpServer())
        .post('/requests')
        .send({
          employeeId: 'emp-999',
          locationId: 'LOC-999',
          days: 1,
        })
        .expect(404);
    });

    it("returns 400 when 'days' field is missing from body", async () => {
      await request(app.getHttpServer())
        .post('/requests')
        .send({
          employeeId: 'emp-001',
          locationId: 'LOC-001',
        })
        .expect(400);
    });

    it("returns 400 when 'days' is zero or negative", async () => {
      await request(app.getHttpServer())
        .post('/requests')
        .send({
          employeeId: 'emp-001',
          locationId: 'LOC-001',
          days: 0,
        })
        .expect(400);

      await request(app.getHttpServer())
        .post('/requests')
        .send({
          employeeId: 'emp-001',
          locationId: 'LOC-001',
          days: -1,
        })
        .expect(400);
    });
  });

  describe('GET /requests/:id', () => {
    it('returns 200 with correct request data after creation', async () => {
      const requestId = await createPendingRequest(3);

      const response = await request(app.getHttpServer())
        .get(`/requests/${requestId}`)
        .expect(200);

      expect(response.body.id).toBe(requestId);
      expect(response.body.status).toBe('pending');
    });

    it('returns 404 for unknown request id', async () => {
      await request(app.getHttpServer()).get('/requests/unknown-id').expect(404);
    });
  });

  describe('PATCH /requests/:id/approve', () => {
    it("returns 200 and sets status to 'approved'", async () => {
      const requestId = await createPendingRequest(3);

      const response = await request(app.getHttpServer())
        .patch(`/requests/${requestId}/approve`)
        .set('x-role', 'manager')
        .set('x-manager-id', 'mgr-001')
        .expect(200);

      expect(response.body.status).toBe('approved');
    });

    it('deducts balance from local store after approval', async () => {
      const requestId = await createPendingRequest(3);

      await request(app.getHttpServer())
        .patch(`/requests/${requestId}/approve`)
        .set('x-role', 'manager')
        .set('x-manager-id', 'mgr-001')
        .expect(200);

      const balance = await balanceRepository.findOne({
        where: { employeeId: 'emp-001', locationId: 'LOC-001' },
      });

      expect(Number(balance?.availableDays)).toBe(7);
    });

    it('returns 400 when HCM balance was changed to insufficient via test helper before approval', async () => {
      const requestId = await createPendingRequest(3);
      await setHcmBalance('emp-001', 'LOC-001', 1);

      await request(app.getHttpServer())
        .patch(`/requests/${requestId}/approve`)
        .set('x-role', 'manager')
        .set('x-manager-id', 'mgr-001')
        .expect(400);
    });

    it('returns 400 when request is already approved', async () => {
      const requestId = await createPendingRequest(1);

      await request(app.getHttpServer())
        .patch(`/requests/${requestId}/approve`)
        .set('x-role', 'manager')
        .set('x-manager-id', 'mgr-001')
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/requests/${requestId}/approve`)
        .set('x-role', 'manager')
        .set('x-manager-id', 'mgr-001')
        .expect(400);
    });

    it('returns 404 for unknown request id', async () => {
      await request(app.getHttpServer())
        .patch('/requests/unknown-id/approve')
        .set('x-role', 'manager')
        .set('x-manager-id', 'mgr-001')
        .expect(404);
    });
  });

  describe('PATCH /requests/:id/reject', () => {
    it("returns 200 and sets status to 'rejected'", async () => {
      const requestId = await createPendingRequest(2);

      const response = await request(app.getHttpServer())
        .patch(`/requests/${requestId}/reject`)
        .set('x-role', 'manager')
        .set('x-manager-id', 'mgr-001')
        .expect(200);

      expect(response.body.status).toBe('rejected');
    });

    it('does not change local balance after rejection', async () => {
      const requestId = await createPendingRequest(2);
      const before = await balanceRepository.findOne({
        where: { employeeId: 'emp-001', locationId: 'LOC-001' },
      });

      await request(app.getHttpServer())
        .patch(`/requests/${requestId}/reject`)
        .set('x-role', 'manager')
        .set('x-manager-id', 'mgr-001')
        .expect(200);

      const after = await balanceRepository.findOne({
        where: { employeeId: 'emp-001', locationId: 'LOC-001' },
      });

      expect(Number(after?.availableDays)).toBe(Number(before?.availableDays));
    });

    it('returns 400 when request is not pending', async () => {
      const requestId = await createPendingRequest(2);

      await request(app.getHttpServer())
        .patch(`/requests/${requestId}/reject`)
        .set('x-role', 'manager')
        .set('x-manager-id', 'mgr-001')
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/requests/${requestId}/reject`)
        .set('x-role', 'manager')
        .set('x-manager-id', 'mgr-001')
        .expect(400);
    });
  });

  describe('PATCH /requests/:id/cancel', () => {
    it("returns 200 and sets status to 'cancelled'", async () => {
      const requestId = await createPendingRequest(2);

      const response = await request(app.getHttpServer())
        .patch(`/requests/${requestId}/cancel`)
        .set('x-employee-id', 'emp-001')
        .expect(200);

      expect(response.body.status).toBe('cancelled');
    });

    it('restores local balance after cancellation', async () => {
      const requestId = await createPendingRequest(2);

      await request(app.getHttpServer())
        .patch(`/requests/${requestId}/cancel`)
        .set('x-employee-id', 'emp-001')
        .expect(200);

      const balance = await balanceRepository.findOne({
        where: { employeeId: 'emp-001', locationId: 'LOC-001' },
      });
      expect(Number(balance?.availableDays)).toBe(10);
    });

    it('returns 400 when request is not pending', async () => {
      const requestId = await createPendingRequest(2);

      await request(app.getHttpServer())
        .patch(`/requests/${requestId}/approve`)
        .set('x-role', 'manager')
        .set('x-manager-id', 'mgr-001')
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/requests/${requestId}/cancel`)
        .set('x-employee-id', 'emp-001')
        .expect(400);
    });

    it('returns 403 when x-employee-id does not match request owner', async () => {
      const requestId = await createPendingRequest(2);

      await request(app.getHttpServer())
        .patch(`/requests/${requestId}/cancel`)
        .set('x-employee-id', 'emp-999')
        .expect(403);
    });
  });
});
