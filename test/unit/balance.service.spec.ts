import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Balance } from '../../src/balance/balance.entity';
import { BalanceService } from '../../src/balance/balance.service';
import { HcmService } from '../../src/hcm/hcm.service';

type QueryRunnerMock = {
  connect: jest.Mock;
  startTransaction: jest.Mock;
  commitTransaction: jest.Mock;
  rollbackTransaction: jest.Mock;
  release: jest.Mock;
  manager: {
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
};

describe('BalanceService', () => {
  let service: BalanceService;
  let balanceRepository: jest.Mocked<Repository<Balance>>;
  let dataSource: jest.Mocked<DataSource>;
  let hcmService: jest.Mocked<HcmService>;
  let queryRunner: QueryRunnerMock;
  let queryBuilder: {
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    execute: jest.Mock;
  };

  beforeEach(() => {
    balanceRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<Balance>>;

    queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn(),
    };

    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        findOne: jest.fn(),
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      },
    };

    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    } as unknown as jest.Mocked<DataSource>;

    hcmService = {
      getBalance: jest.fn(),
    } as unknown as jest.Mocked<HcmService>;

    service = new BalanceService(balanceRepository, dataSource, hcmService);
  });

  describe('getLocalBalance', () => {
    it('returns balance when (employeeId, locationId) exists', async () => {
      const balance = {
        employeeId: 'emp-001',
        locationId: 'LOC-001',
        availableDays: 10,
      } as Balance;
      balanceRepository.findOne.mockResolvedValue(balance);

      const result = await service.getLocalBalance('emp-001', 'LOC-001');
      expect(result).toEqual(balance);
    });

    it('throws NotFoundException when record does not exist', async () => {
      balanceRepository.findOne.mockResolvedValue(null);

      await expect(service.getLocalBalance('emp-001', 'LOC-001')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('upsertBalance', () => {
    it('creates a new row when none exists for the (employeeId, locationId) pair', async () => {
      const created = {
        employeeId: 'emp-001',
        locationId: 'LOC-001',
        availableDays: 8,
        version: 1,
      } as Balance;
      balanceRepository.findOne.mockResolvedValue(null);
      balanceRepository.create.mockReturnValue(created);
      balanceRepository.save.mockResolvedValue(created);

      await service.upsertBalance('emp-001', 'LOC-001', 8);

      expect(balanceRepository.create).toHaveBeenCalledWith({
        employeeId: 'emp-001',
        locationId: 'LOC-001',
        availableDays: 8,
        version: 1,
      });
      expect(balanceRepository.save).toHaveBeenCalledWith(created);
    });

    it('updates availableDays and increments version when row already exists', async () => {
      const existing = {
        employeeId: 'emp-001',
        locationId: 'LOC-001',
        availableDays: 10,
        version: 2,
      } as Balance;
      const saved = { ...existing, availableDays: 6, version: 3 } as Balance;

      balanceRepository.findOne.mockResolvedValue(existing);
      balanceRepository.save.mockResolvedValue(saved);

      const result = await service.upsertBalance('emp-001', 'LOC-001', 6);

      expect(existing.availableDays).toBe(6);
      expect(existing.version).toBe(3);
      expect(result.version).toBe(3);
    });

    it('returns the saved entity after upsert', async () => {
      const created = {
        employeeId: 'emp-002',
        locationId: 'LOC-001',
        availableDays: 3,
        version: 1,
      } as Balance;
      balanceRepository.findOne.mockResolvedValue(null);
      balanceRepository.create.mockReturnValue(created);
      balanceRepository.save.mockResolvedValue(created);

      const result = await service.upsertBalance('emp-002', 'LOC-001', 3);
      expect(result).toEqual(created);
    });
  });

  describe('deductLocalBalance', () => {
    it('successfully deducts when balance is sufficient and version matches', async () => {
      queryRunner.manager.findOne
        .mockResolvedValueOnce({
          employeeId: 'emp-001',
          locationId: 'LOC-001',
          availableDays: 10,
          version: 1,
        } as Balance)
        .mockResolvedValueOnce({
          employeeId: 'emp-001',
          locationId: 'LOC-001',
          availableDays: 7,
          version: 2,
        } as Balance);
      queryBuilder.execute.mockResolvedValue({ affected: 1 });

      const result = await service.deductLocalBalance('emp-001', 'LOC-001', 3, 1);

      expect(result.availableDays).toBe(7);
      expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestException when availableDays < requested days', async () => {
      queryRunner.manager.findOne.mockResolvedValue({
        employeeId: 'emp-001',
        locationId: 'LOC-001',
        availableDays: 1,
        version: 1,
      } as Balance);

      await expect(service.deductLocalBalance('emp-001', 'LOC-001', 3, 1)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('throws ConflictException when version does not match (concurrent modification)', async () => {
      queryRunner.manager.findOne.mockResolvedValue({
        employeeId: 'emp-001',
        locationId: 'LOC-001',
        availableDays: 10,
        version: 2,
      } as Balance);
      queryBuilder.execute.mockResolvedValue({ affected: 0 });

      await expect(service.deductLocalBalance('emp-001', 'LOC-001', 3, 1)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('runs deduction inside a transaction', async () => {
      queryRunner.manager.findOne
        .mockResolvedValueOnce({
          employeeId: 'emp-001',
          locationId: 'LOC-001',
          availableDays: 5,
          version: 1,
        } as Balance)
        .mockResolvedValueOnce({
          employeeId: 'emp-001',
          locationId: 'LOC-001',
          availableDays: 4,
          version: 2,
        } as Balance);
      queryBuilder.execute.mockResolvedValue({ affected: 1 });

      await service.deductLocalBalance('emp-001', 'LOC-001', 1, 1);

      expect(queryRunner.startTransaction).toHaveBeenCalledTimes(1);
      expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
      expect(queryRunner.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('restoreLocalBalance', () => {
    it('adds days back to availableDays correctly', async () => {
      const existing = {
        employeeId: 'emp-001',
        locationId: 'LOC-001',
        availableDays: 5,
        version: 1,
      } as Balance;
      const restored = { ...existing, availableDays: 7, version: 2 } as Balance;

      balanceRepository.findOne.mockResolvedValue(existing);
      balanceRepository.save.mockResolvedValue(restored);

      const result = await service.restoreLocalBalance('emp-001', 'LOC-001', 2);
      expect(result.availableDays).toBe(7);
    });
  });

  describe('refreshFromHcm', () => {
    it('calls HcmService.getBalance and then calls upsertBalance with result', async () => {
      const updated = {
        employeeId: 'emp-001',
        locationId: 'LOC-001',
        availableDays: 9,
      } as Balance;
      hcmService.getBalance.mockResolvedValue(9);
      const upsertSpy = jest.spyOn(service, 'upsertBalance').mockResolvedValue(updated);

      await service.refreshFromHcm('emp-001', 'LOC-001');

      expect(hcmService.getBalance).toHaveBeenCalledWith('emp-001', 'LOC-001');
      expect(upsertSpy).toHaveBeenCalledWith('emp-001', 'LOC-001', 9);
    });

    it('returns the updated balance entity', async () => {
      const updated = {
        employeeId: 'emp-001',
        locationId: 'LOC-001',
        availableDays: 9,
      } as Balance;
      hcmService.getBalance.mockResolvedValue(9);
      jest.spyOn(service, 'upsertBalance').mockResolvedValue(updated);

      const result = await service.refreshFromHcm('emp-001', 'LOC-001');
      expect(result).toEqual(updated);
    });
  });
});
