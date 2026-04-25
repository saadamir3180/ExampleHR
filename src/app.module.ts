import { ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Balance } from './balance/balance.entity';
import { BalanceModule } from './balance/balance.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { Employee } from './employees/employee.entity';
import { EmployeesModule } from './employees/employees.module';
import { HcmModule } from './hcm/hcm.module';
import { TimeOffRequest } from './requests/requests.entity';
import { RequestsModule } from './requests/requests.module';
import { SyncLog } from './sync/sync-log.entity';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'better-sqlite3',
        database: config.get<string>('DATABASE_PATH'),
        entities: [Employee, Balance, TimeOffRequest, SyncLog],
        synchronize: true,
      }),
    }),
    EmployeesModule,
    BalanceModule,
    RequestsModule,
    HcmModule,
    SyncModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
  ],
})
export class AppModule {}
