import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Balance } from '../balance/balance.entity';
import { BalanceService } from '../balance/balance.service';
import { HcmService } from '../hcm/hcm.service';
import { BatchSyncItemDto } from './dto/batch-sync.dto';
import { SyncLog, SyncSource } from './sync-log.entity';

@Injectable()
export class SyncService {
  constructor(
    @InjectRepository(SyncLog)
    private readonly syncLogRepository: Repository<SyncLog>,
    private readonly balanceService: BalanceService,
    private readonly hcmService: HcmService,
  ) {}

  /**
   * Processes a batch payload by upserting balances and recording a sync log entry.
   */
  async processBatch(
    items: BatchSyncItemDto[],
  ): Promise<{ processed: number; skipped: number }> {
    let processed = 0;
    let skipped = 0;

    for (const item of items) {
      try {
        await this.balanceService.upsertBalance(
          item.employeeId,
          item.locationId,
          item.availableDays,
        );
        processed += 1;
      } catch (error) {
        skipped += 1;
      }
    }

    await this.syncLogRepository.save(
      this.syncLogRepository.create({
        source: SyncSource.BATCH,
        rowsAffected: processed,
      }),
    );
    await this.hcmService.notifyBatch(items);

    return { processed, skipped };
  }

  /**
   * Processes a realtime sync for one employee/location and records a log entry.
   */
  async processRealtime(employeeId: string, locationId: string): Promise<Balance> {
    const refreshedBalance = await this.balanceService.refreshFromHcm(
      employeeId,
      locationId,
    );

    await this.syncLogRepository.save(
      this.syncLogRepository.create({
        source: SyncSource.REALTIME,
        employeeId,
        rowsAffected: 1,
      }),
    );

    return refreshedBalance;
  }
}
