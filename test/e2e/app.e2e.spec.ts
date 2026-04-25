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

describe('Full Time-Off Request Lifecycle (E2E)', () => {
  let app: INestApplication;
  let employeeRepository: Repository<Employee>;
  let balanceRepository: Repository<Balance>;
  let requestRepository: Repository<TimeOffRequest>;

  const resetHcm = async (): Promise<void> => {
    await axios.post(`${HCM_BASE_URL}/hcm/test/reset`);
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
  });

  beforeEach(async () => {
    await resetHcm();
    await seedDatabase();
  });

  afterAll(async () => {
    await app.close();
  });

  it('runs the complete request lifecycle', async () => {
    const balance1 = await request(app.getHttpServer())
      .get('/balance/emp-001/LOC-001')
      .expect(200);
    expect(Number(balance1.body.availableDays)).toBe(10);

    const createFirst = await request(app.getHttpServer())
      .post('/requests')
      .send({
        employeeId: 'emp-001',
        locationId: 'LOC-001',
        days: 3,
      })
      .expect(201);
    expect(createFirst.body.status).toBe('pending');
    const firstRequestId = createFirst.body.id as string;

    const getFirst = await request(app.getHttpServer())
      .get(`/requests/${firstRequestId}`)
      .expect(200);
    expect(getFirst.body.status).toBe('pending');

    const approved = await request(app.getHttpServer())
      .patch(`/requests/${firstRequestId}/approve`)
      .set('x-role', 'manager')
      .set('x-manager-id', 'mgr-001')
      .expect(200);
    expect(approved.body.status).toBe('approved');

    const balance2 = await request(app.getHttpServer())
      .get('/balance/emp-001/LOC-001')
      .expect(200);
    expect(Number(balance2.body.availableDays)).toBe(7);

    await request(app.getHttpServer())
      .post('/requests')
      .send({
        employeeId: 'emp-001',
        locationId: 'LOC-001',
        days: 8,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/sync/batch')
      .send([
        {
          employeeId: 'emp-001',
          locationId: 'LOC-001',
          availableDays: 15,
        },
      ])
      .expect(200);

    const balance3 = await request(app.getHttpServer())
      .get('/balance/emp-001/LOC-001')
      .expect(200);
    expect(Number(balance3.body.availableDays)).toBe(15);

    const createSecond = await request(app.getHttpServer())
      .post('/requests')
      .send({
        employeeId: 'emp-001',
        locationId: 'LOC-001',
        days: 5,
      })
      .expect(201);
    expect(createSecond.body.status).toBe('pending');

    const secondRequestId = createSecond.body.id as string;
    const cancelled = await request(app.getHttpServer())
      .patch(`/requests/${secondRequestId}/cancel`)
      .set('x-employee-id', 'emp-001')
      .expect(200);
    expect(cancelled.body.status).toBe('cancelled');

    const balance4 = await request(app.getHttpServer())
      .get('/balance/emp-001/LOC-001')
      .expect(200);
    expect(Number(balance4.body.availableDays)).toBe(15);
  });
});
