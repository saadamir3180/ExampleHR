import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import axios from 'axios';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { Balance } from '../../src/balance/balance.entity';
import { Employee } from '../../src/employees/employee.entity';
import { TimeOffRequest, RequestStatus } from '../../src/requests/requests.entity';

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

describe('Sync API (integration)', () => {
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

  const seedDatabase = async (): Promise<void> => {
    await requestRepository.clear();
    await balanceRepository.clear();
    await employeeRepository.clear();

    await employeeRepository.save(EMPLOYEE_SEED);
    await balanceRepository.save(BALANCE_SEED);
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

  describe('POST /sync/batch', () => {
    it('returns 200 and updates all balance rows in local db', async () => {
      const payload = [
        { employeeId: 'emp-001', locationId: 'LOC-001', availableDays: 15 },
        { employeeId: 'emp-002', locationId: 'LOC-001', availableDays: 6 },
      ];

      await request(app.getHttpServer()).post('/sync/batch').send(payload).expect(200);

      const balance1 = await balanceRepository.findOne({
        where: { employeeId: 'emp-001', locationId: 'LOC-001' },
      });
      const balance2 = await balanceRepository.findOne({
        where: { employeeId: 'emp-002', locationId: 'LOC-001' },
      });

      expect(Number(balance1?.availableDays)).toBe(15);
      expect(Number(balance2?.availableDays)).toBe(6);
    });

    it('running same batch payload twice produces identical db state (idempotent)', async () => {
      const payload = [
        { employeeId: 'emp-001', locationId: 'LOC-001', availableDays: 12 },
        { employeeId: 'emp-002', locationId: 'LOC-001', availableDays: 8 },
      ];

      await request(app.getHttpServer()).post('/sync/batch').send(payload).expect(200);

      const firstState = (
        await balanceRepository.find({
          where: [
            { employeeId: 'emp-001', locationId: 'LOC-001' },
            { employeeId: 'emp-002', locationId: 'LOC-001' },
          ],
        })
      )
        .map((item) => `${item.employeeId}:${item.locationId}:${Number(item.availableDays)}`)
        .sort();

      await request(app.getHttpServer()).post('/sync/batch').send(payload).expect(200);

      const secondState = (
        await balanceRepository.find({
          where: [
            { employeeId: 'emp-001', locationId: 'LOC-001' },
            { employeeId: 'emp-002', locationId: 'LOC-001' },
          ],
        })
      )
        .map((item) => `${item.employeeId}:${item.locationId}:${Number(item.availableDays)}`)
        .sort();

      expect(secondState).toEqual(firstState);
    });

    it('does not affect any time_off_requests rows', async () => {
      await requestRepository.save({
        employeeId: 'emp-001',
        locationId: 'LOC-001',
        days: 2,
        status: RequestStatus.PENDING,
      });

      const beforeCount = await requestRepository.count();

      await request(app.getHttpServer())
        .post('/sync/batch')
        .send([
          { employeeId: 'emp-001', locationId: 'LOC-001', availableDays: 11 },
        ])
        .expect(200);

      const afterCount = await requestRepository.count();
      expect(afterCount).toBe(beforeCount);
    });

    it('returns correct { processed, skipped } counts', async () => {
      const payload = [
        { employeeId: 'emp-001', locationId: 'LOC-001', availableDays: 9 },
        { employeeId: 'emp-002', locationId: 'LOC-001', availableDays: 4 },
      ];

      const response = await request(app.getHttpServer())
        .post('/sync/batch')
        .send(payload)
        .expect(200);

      expect(response.body).toEqual({ processed: 2, skipped: 0 });
    });
  });

  describe('POST /sync/realtime', () => {
    it('returns 200 with updated balance from mock HCM', async () => {
      await setHcmBalance('emp-001', 'LOC-001', 14);

      const response = await request(app.getHttpServer())
        .post('/sync/realtime')
        .send({ employeeId: 'emp-001', locationId: 'LOC-001' })
        .expect(200);

      expect(Number(response.body.availableDays)).toBe(14);
    });

    it('updates the local balance row lastSyncedAt timestamp', async () => {
      const before = await balanceRepository.findOne({
        where: { employeeId: 'emp-001', locationId: 'LOC-001' },
      });
      await setHcmBalance('emp-001', 'LOC-001', 13);

      await request(app.getHttpServer())
        .post('/sync/realtime')
        .send({ employeeId: 'emp-001', locationId: 'LOC-001' })
        .expect(200);

      const after = await balanceRepository.findOne({
        where: { employeeId: 'emp-001', locationId: 'LOC-001' },
      });

      expect(after).toBeDefined();
      expect(before).toBeDefined();
      expect(new Date(after!.lastSyncedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(before!.lastSyncedAt).getTime(),
      );
    });

    it('returns 502 when HCM server is unreachable (shut down mock and verify)', async () => {
      const originalHcmBaseUrl = process.env.HCM_BASE_URL;

      process.env.HCM_BASE_URL = 'http://127.0.0.1:3999';

      const isolatedModule: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      const isolatedApp = isolatedModule.createNestApplication();
      await isolatedApp.init();

      const isolatedEmployeeRepository = isolatedModule.get<Repository<Employee>>(
        getRepositoryToken(Employee),
      );
      const isolatedBalanceRepository = isolatedModule.get<Repository<Balance>>(
        getRepositoryToken(Balance),
      );
      const isolatedRequestRepository = isolatedModule.get<Repository<TimeOffRequest>>(
        getRepositoryToken(TimeOffRequest),
      );

      await isolatedRequestRepository.clear();
      await isolatedBalanceRepository.clear();
      await isolatedEmployeeRepository.clear();
      await isolatedEmployeeRepository.save(EMPLOYEE_SEED);
      await isolatedBalanceRepository.save(BALANCE_SEED);

      await request(isolatedApp.getHttpServer())
        .post('/sync/realtime')
        .send({ employeeId: 'emp-001', locationId: 'LOC-001' })
        .expect(502);

      await isolatedApp.close();
      process.env.HCM_BASE_URL = originalHcmBaseUrl;
    });
  });
});
