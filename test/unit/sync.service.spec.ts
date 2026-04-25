import { Repository } from 'typeorm';
import { Balance } from '../../src/balance/balance.entity';
import { BalanceService } from '../../src/balance/balance.service';
import { HcmService } from '../../src/hcm/hcm.service';
import { BatchSyncItemDto } from '../../src/sync/dto/batch-sync.dto';
import { SyncLog, SyncSource } from '../../src/sync/sync-log.entity';
import { SyncService } from '../../src/sync/sync.service';

describe('SyncService', () => {
  let service: SyncService;
  let syncLogRepository: jest.Mocked<Repository<SyncLog>>;
  let balanceService: jest.Mocked<BalanceService>;
  let hcmService: jest.Mocked<HcmService>;

  const payload: BatchSyncItemDto[] = [
    { employeeId: 'emp-001', locationId: 'LOC-001', availableDays: 10 },
    { employeeId: 'emp-002', locationId: 'LOC-001', availableDays: 4 },
  ];

  beforeEach(() => {
    syncLogRepository = {
      create: jest.fn().mockImplementation((value) => value),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<SyncLog>>;

    balanceService = {
      upsertBalance: jest.fn(),
      refreshFromHcm: jest.fn(),
    } as unknown as jest.Mocked<BalanceService>;
    hcmService = {
      notifyBatch: jest.fn(),
    } as unknown as jest.Mocked<HcmService>;

    service = new SyncService(syncLogRepository, balanceService, hcmService);
  });

  describe('processBatch', () => {
    it('upserts all balance rows from batch payload', async () => {
      balanceService.upsertBalance.mockResolvedValue({} as Balance);

      await service.processBatch(payload);

      expect(balanceService.upsertBalance).toHaveBeenCalledTimes(2);
      expect(balanceService.upsertBalance).toHaveBeenNthCalledWith(
        1,
        'emp-001',
        'LOC-001',
        10,
      );
      expect(balanceService.upsertBalance).toHaveBeenNthCalledWith(
        2,
        'emp-002',
        'LOC-001',
        4,
      );
    });

    it('returns correct { processed, skipped } counts', async () => {
      balanceService.upsertBalance
        .mockResolvedValueOnce({} as Balance)
        .mockRejectedValueOnce(new Error('fail'));

      const result = await service.processBatch(payload);
      expect(result).toEqual({ processed: 1, skipped: 1 });
    });

    it("writes a SyncLog record with source 'batch'", async () => {
      balanceService.upsertBalance.mockResolvedValue({} as Balance);
      syncLogRepository.save.mockResolvedValue({} as SyncLog);
      hcmService.notifyBatch.mockResolvedValue(undefined);

      await service.processBatch(payload);

      expect(syncLogRepository.create).toHaveBeenCalledWith({
        source: SyncSource.BATCH,
        rowsAffected: 2,
      });
      expect(syncLogRepository.save).toHaveBeenCalledTimes(1);
      expect(hcmService.notifyBatch).toHaveBeenCalledWith(payload);
    });

    it('is idempotent — running same payload twice produces same final state', async () => {
      const state = new Map<string, number>();
      balanceService.upsertBalance.mockImplementation(async (employeeId, locationId, days) => {
        state.set(`${employeeId}:${locationId}`, days);
        return {} as Balance;
      });

      await service.processBatch(payload);
      const firstState = Array.from(state.entries());

      await service.processBatch(payload);
      const secondState = Array.from(state.entries());

      expect(secondState).toEqual(firstState);
    });

    it('does not modify any time_off_requests rows', async () => {
      balanceService.upsertBalance.mockResolvedValue({} as Balance);

      await service.processBatch(payload);

      expect(balanceService.refreshFromHcm).not.toHaveBeenCalled();
      expect(balanceService.upsertBalance).toHaveBeenCalled();
    });
  });

  describe('processRealtime', () => {
    it('calls BalanceService.refreshFromHcm with correct params', async () => {
      const refreshed = {
        employeeId: 'emp-001',
        locationId: 'LOC-001',
        availableDays: 11,
      } as Balance;
      balanceService.refreshFromHcm.mockResolvedValue(refreshed);
      syncLogRepository.save.mockResolvedValue({} as SyncLog);

      await service.processRealtime('emp-001', 'LOC-001');

      expect(balanceService.refreshFromHcm).toHaveBeenCalledWith(
        'emp-001',
        'LOC-001',
      );
    });

    it("writes a SyncLog record with source 'realtime' and employeeId", async () => {
      const refreshed = {
        employeeId: 'emp-001',
        locationId: 'LOC-001',
        availableDays: 11,
      } as Balance;
      balanceService.refreshFromHcm.mockResolvedValue(refreshed);
      syncLogRepository.save.mockResolvedValue({} as SyncLog);

      await service.processRealtime('emp-001', 'LOC-001');

      expect(syncLogRepository.create).toHaveBeenCalledWith({
        source: SyncSource.REALTIME,
        employeeId: 'emp-001',
        rowsAffected: 1,
      });
    });

    it('returns the updated balance', async () => {
      const refreshed = {
        employeeId: 'emp-001',
        locationId: 'LOC-001',
        availableDays: 11,
      } as Balance;
      balanceService.refreshFromHcm.mockResolvedValue(refreshed);
      syncLogRepository.save.mockResolvedValue({} as SyncLog);

      const result = await service.processRealtime('emp-001', 'LOC-001');
      expect(result).toEqual(refreshed);
    });
  });
});
