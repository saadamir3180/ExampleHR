import { Body, Controller, HttpCode, ParseArrayPipe, Post } from '@nestjs/common';
import { BalanceResponseDto } from '../balance/dto/balance-response.dto';
import { BatchSyncItemDto, RealtimeSyncDto } from './dto/batch-sync.dto';
import { SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('batch')
  @HttpCode(200)
  async processBatch(
    @Body(new ParseArrayPipe({ items: BatchSyncItemDto }))
    body: BatchSyncItemDto[],
  ): Promise<{ processed: number; skipped: number }> {
    return this.syncService.processBatch(body);
  }

  @Post('realtime')
  @HttpCode(200)
  async processRealtime(@Body() body: RealtimeSyncDto): Promise<BalanceResponseDto> {
    return this.syncService.processRealtime(body.employeeId, body.locationId);
  }
}
