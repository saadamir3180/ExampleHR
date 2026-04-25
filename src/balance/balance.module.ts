import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HcmModule } from '../hcm/hcm.module';
import { BalanceController } from './balance.controller';
import { Balance } from './balance.entity';
import { BalanceService } from './balance.service';

@Module({
  imports: [TypeOrmModule.forFeature([Balance]), HcmModule],
  controllers: [BalanceController],
  providers: [BalanceService],
  exports: [BalanceService],
})
export class BalanceModule {}
