import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Balance } from '../balance/balance.entity';
import { BalanceService } from '../balance/balance.service';
import { HcmService } from '../hcm/hcm.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { RequestStatus, TimeOffRequest } from './requests.entity';

const NO_BALANCE_FOUND_MESSAGE = 'No balance record found for this employee and location';
const REQUEST_NOT_FOUND_MESSAGE = 'Request not found';
const REQUEST_NOT_PENDING_MESSAGE = 'Request is not pending';
const INSUFFICIENT_HCM_BALANCE_MESSAGE = 'Insufficient balance per HCM';
const INSUFFICIENT_APPROVAL_BALANCE_MESSAGE = 'Insufficient balance at time of approval';
const CANCEL_PENDING_ONLY_MESSAGE = 'Only pending requests can be cancelled';
const REQUEST_OWNER_FORBIDDEN_MESSAGE = 'You cannot cancel this request';
const HCM_POST_DEDUCT_MISMATCH_MESSAGE =
  'HCM did not apply the expected deduction';

@Injectable()
export class RequestsService {
  constructor(
    @InjectRepository(TimeOffRequest)
    private readonly requestsRepository: Repository<TimeOffRequest>,
    private readonly balanceService: BalanceService,
    private readonly hcmService: HcmService,
  ) {}

  /**
   * Creates a pending time-off request after local and HCM balance validation.
   */
  async createRequest(dto: CreateRequestDto): Promise<TimeOffRequest> {
    let localBalance: Balance | null = null;
    try {
      localBalance = await this.balanceService.getLocalBalance(dto.employeeId, dto.locationId);
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
    }
    const hcmBalance = await this.getHcmBalanceOrThrowNotFound(
      dto.employeeId,
      dto.locationId,
    );
    if (
      !localBalance ||
      !this.isSameBalance(hcmBalance, Number(localBalance.availableDays))
    ) {
      localBalance = await this.balanceService.upsertBalance(
        dto.employeeId,
        dto.locationId,
        hcmBalance,
      );
    }
    if (hcmBalance < dto.days) {
      throw new BadRequestException(INSUFFICIENT_HCM_BALANCE_MESSAGE);
    }

    const request = this.requestsRepository.create({
      employeeId: dto.employeeId,
      locationId: dto.locationId,
      days: dto.days,
      status: RequestStatus.PENDING,
    });

    return this.requestsRepository.save(request);
  }

  /**
   * Approves a pending request with live HCM re-validation and optimistic locking.
   */
  async approveRequest(requestId: string, managerId: string): Promise<TimeOffRequest> {
    const request = await this.requestsRepository.findOne({ where: { id: requestId } });
    if (!request) {
      throw new NotFoundException(REQUEST_NOT_FOUND_MESSAGE);
    }
    if (request.status !== RequestStatus.PENDING) {
      throw new BadRequestException(REQUEST_NOT_PENDING_MESSAGE);
    }

    let localBalance: Balance;
    let preDeductHcmBalance: number | null = null;
    try {
      localBalance = await this.balanceService.getLocalBalance(
        request.employeeId,
        request.locationId,
      );
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
      preDeductHcmBalance = await this.getHcmBalanceOrThrowNotFound(
        request.employeeId,
        request.locationId,
      );
      localBalance = await this.balanceService.upsertBalance(
        request.employeeId,
        request.locationId,
        preDeductHcmBalance,
      );
    }
    let currentVersion = localBalance.version;
    if (preDeductHcmBalance === null) {
      preDeductHcmBalance = await this.getHcmBalanceOrThrowNotFound(
        request.employeeId,
        request.locationId,
      );
    }
    if (!this.isSameBalance(preDeductHcmBalance, Number(localBalance.availableDays))) {
      localBalance = await this.balanceService.upsertBalance(
        request.employeeId,
        request.locationId,
        preDeductHcmBalance,
      );
      currentVersion = localBalance.version;
    }
    if (preDeductHcmBalance < Number(request.days)) {
      throw new BadRequestException(INSUFFICIENT_APPROVAL_BALANCE_MESSAGE);
    }

    await this.balanceService.deductLocalBalance(
      request.employeeId,
      request.locationId,
      Number(request.days),
      currentVersion,
    );

    try {
      await this.hcmService.deductBalance(
        request.employeeId,
        request.locationId,
        Number(request.days),
      );

      const postDeductHcmBalance = await this.getHcmBalanceOrThrowNotFound(
        request.employeeId,
        request.locationId,
      );
      const expectedPostDeductBalance = this.toTwoDecimalPlaces(
        preDeductHcmBalance - Number(request.days),
      );
      if (
        !this.isSameBalance(postDeductHcmBalance, expectedPostDeductBalance)
      ) {
        throw new ConflictException(HCM_POST_DEDUCT_MISMATCH_MESSAGE);
      }
    } catch (error) {
      await this.balanceService.restoreLocalBalance(
        request.employeeId,
        request.locationId,
        Number(request.days),
      );
      throw error;
    }

    request.status = RequestStatus.APPROVED;
    request.resolvedBy = managerId;
    return this.requestsRepository.save(request);
  }

  /**
   * Rejects a pending request without changing balances.
   */
  async rejectRequest(requestId: string, managerId: string): Promise<TimeOffRequest> {
    const request = await this.requestsRepository.findOne({ where: { id: requestId } });
    if (!request) {
      throw new NotFoundException(REQUEST_NOT_FOUND_MESSAGE);
    }
    if (request.status !== RequestStatus.PENDING) {
      throw new BadRequestException(REQUEST_NOT_PENDING_MESSAGE);
    }

    request.status = RequestStatus.REJECTED;
    request.resolvedBy = managerId;
    return this.requestsRepository.save(request);
  }

  /**
   * Cancels a pending request owned by the calling employee.
   */
  async cancelRequest(requestId: string, employeeId: string): Promise<TimeOffRequest> {
    const request = await this.requestsRepository.findOne({ where: { id: requestId } });
    if (!request) {
      throw new NotFoundException(REQUEST_NOT_FOUND_MESSAGE);
    }
    if (request.employeeId !== employeeId) {
      throw new ForbiddenException(REQUEST_OWNER_FORBIDDEN_MESSAGE);
    }
    if (request.status !== RequestStatus.PENDING) {
      throw new BadRequestException(CANCEL_PENDING_ONLY_MESSAGE);
    }

    await this.balanceService.restoreLocalBalance(
      request.employeeId,
      request.locationId,
      Number(request.days),
    );

    request.status = RequestStatus.CANCELLED;
    return this.requestsRepository.save(request);
  }

  /**
   * Retrieves a request by identifier.
   */
  async getRequest(requestId: string): Promise<TimeOffRequest> {
    const request = await this.requestsRepository.findOne({ where: { id: requestId } });
    if (!request) {
      throw new NotFoundException(REQUEST_NOT_FOUND_MESSAGE);
    }
    return request;
  }

  private async getHcmBalanceOrThrowNotFound(
    employeeId: string,
    locationId: string,
  ): Promise<number> {
    try {
      return await this.hcmService.getBalance(employeeId, locationId);
    } catch (error) {
      if (this.isNotFoundError(error)) {
        throw new NotFoundException(NO_BALANCE_FOUND_MESSAGE);
      }
      throw error;
    }
  }

  private isNotFoundError(error: unknown): boolean {
    return (
      error instanceof NotFoundException ||
      (error instanceof HttpException &&
        error.getStatus() === HttpStatus.NOT_FOUND)
    );
  }

  private isSameBalance(left: number, right: number): boolean {
    return Math.abs(left - right) < 0.0001;
  }

  private toTwoDecimalPlaces(value: number): number {
    return Number(value.toFixed(2));
  }
}
