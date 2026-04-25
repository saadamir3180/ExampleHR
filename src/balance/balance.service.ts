import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { HcmService } from '../hcm/hcm.service';
import { Balance } from './balance.entity';

const BALANCE_NOT_FOUND_MESSAGE = 'Balance record not found';
const CONCURRENCY_ERROR_MESSAGE = 'Concurrent modification detected';
const INSUFFICIENT_LOCAL_BALANCE_MESSAGE = 'Insufficient local balance';

@Injectable()
export class BalanceService {
  constructor(
    @InjectRepository(Balance)
    private readonly balanceRepository: Repository<Balance>,
    private readonly dataSource: DataSource,
    private readonly hcmService: HcmService,
  ) {}

  /**
   * Retrieves the local cached balance for an employee at a specific location.
   */
  async getLocalBalance(employeeId: string, locationId: string): Promise<Balance> {
    const balance = await this.balanceRepository.findOne({
      where: { employeeId, locationId },
    });

    if (!balance) {
      throw new NotFoundException(BALANCE_NOT_FOUND_MESSAGE);
    }

    return this.normalizeBalance(balance);
  }

  /**
   * Creates or updates a balance row for an employee/location pair.
   */
  async upsertBalance(
    employeeId: string,
    locationId: string,
    days: number,
  ): Promise<Balance> {
    const existingBalance = await this.balanceRepository.findOne({
      where: { employeeId, locationId },
    });

    if (!existingBalance) {
      const created = this.balanceRepository.create({
        employeeId,
        locationId,
        availableDays: days,
        version: 1,
      });
      const savedCreated = await this.balanceRepository.save(created);
      return this.normalizeBalance(savedCreated);
    }

    existingBalance.availableDays = days;
    existingBalance.version += 1;
    const savedUpdated = await this.balanceRepository.save(existingBalance);
    return this.normalizeBalance(savedUpdated);
  }

  /**
   * Deducts local balance with optimistic locking inside a transaction.
   */
  async deductLocalBalance(
    employeeId: string,
    locationId: string,
    days: number,
    knownVersion: number,
  ): Promise<Balance> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const currentBalance = await queryRunner.manager.findOne(Balance, {
        where: { employeeId, locationId },
      });

      if (!currentBalance) {
        throw new NotFoundException(BALANCE_NOT_FOUND_MESSAGE);
      }

      if (this.toNumber(currentBalance.availableDays) < days) {
        throw new BadRequestException(INSUFFICIENT_LOCAL_BALANCE_MESSAGE);
      }

      const updateResult = await queryRunner.manager
        .createQueryBuilder()
        .update(Balance)
        .set({
          availableDays: () => `availableDays - ${days}`,
          version: () => 'version + 1',
        })
        .where('employeeId = :employeeId', { employeeId })
        .andWhere('locationId = :locationId', { locationId })
        .andWhere('version = :knownVersion', { knownVersion })
        .execute();

      if (!updateResult.affected) {
        throw new ConflictException(CONCURRENCY_ERROR_MESSAGE);
      }

      const updatedBalance = await queryRunner.manager.findOne(Balance, {
        where: { employeeId, locationId },
      });

      if (!updatedBalance) {
        throw new NotFoundException(BALANCE_NOT_FOUND_MESSAGE);
      }

      await queryRunner.commitTransaction();
      return this.normalizeBalance(updatedBalance);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Restores local balance by adding days back for retries and cancellations.
   */
  async restoreLocalBalance(
    employeeId: string,
    locationId: string,
    days: number,
  ): Promise<Balance> {
    const currentBalance = await this.balanceRepository.findOne({
      where: { employeeId, locationId },
    });

    if (!currentBalance) {
      throw new NotFoundException(BALANCE_NOT_FOUND_MESSAGE);
    }

    currentBalance.availableDays = this.toNumber(currentBalance.availableDays) + days;
    currentBalance.version += 1;

    const savedBalance = await this.balanceRepository.save(currentBalance);
    return this.normalizeBalance(savedBalance);
  }

  /**
   * Refreshes local balance from HCM and persists the latest value.
   */
  async refreshFromHcm(employeeId: string, locationId: string): Promise<Balance> {
    const hcmDays = await this.hcmService.getBalance(employeeId, locationId);
    return this.upsertBalance(employeeId, locationId, hcmDays);
  }

  private normalizeBalance(balance: Balance): Balance {
    balance.availableDays = this.toNumber(balance.availableDays);
    return balance;
  }

  private toNumber(value: number | string): number {
    return typeof value === 'number' ? value : Number(value);
  }
}
