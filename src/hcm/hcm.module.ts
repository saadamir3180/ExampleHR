import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { HcmService } from './hcm.service';

@Module({
  imports: [HttpModule],
  providers: [HcmService],
  exports: [HcmService],
})
export class HcmModule {}
