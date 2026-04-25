import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BalanceModule } from '../balance/balance.module';
import { RoleGuard } from '../common/guards/role.guard';
import { HcmModule } from '../hcm/hcm.module';
import { TimeOffRequest } from './requests.entity';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

@Module({
  imports: [TypeOrmModule.forFeature([TimeOffRequest]), BalanceModule, HcmModule],
  controllers: [RequestsController],
  providers: [RequestsService, RoleGuard],
  exports: [RequestsService],
})
export class RequestsModule {}
