import { Controller, Get, Param } from '@nestjs/common';
import { BalanceResponseDto } from './dto/balance-response.dto';
import { BalanceService } from './balance.service';

@Controller('balance')
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  @Get(':employeeId/:locationId')
  async getBalance(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
  ): Promise<BalanceResponseDto> {
    const balance = await this.balanceService.getLocalBalance(employeeId, locationId);

    return {
      employeeId: balance.employeeId,
      locationId: balance.locationId,
      availableDays: Number(balance.availableDays),
      lastSyncedAt: balance.lastSyncedAt,
    };
  }
}
