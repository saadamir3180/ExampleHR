import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { Balance } from '../../src/balance/balance.entity';
import { BalanceService } from '../../src/balance/balance.service';
import { HcmService } from '../../src/hcm/hcm.service';
import { CreateRequestDto } from '../../src/requests/dto/create-request.dto';
import {
  RequestStatus,
  TimeOffRequest,
} from '../../src/requests/requests.entity';
import { RequestsService } from '../../src/requests/requests.service';

describe('RequestsService', () => {
  let service: RequestsService;
  let requestsRepository: jest.Mocked<Repository<TimeOffRequest>>;
  let balanceService: jest.Mocked<BalanceService>;
  let hcmService: jest.Mocked<HcmService>;

  const createDto: CreateRequestDto = {
    employeeId: 'emp-001',
    locationId: 'LOC-001',
    days: 3,
  };

  const pendingRequest = {
    id: 'req-001',
    employeeId: 'emp-001',
    locationId: 'LOC-001',
    days: 3,
    status: RequestStatus.PENDING,
    resolvedBy: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as TimeOffRequest;

  const localBalance = {
    employeeId: 'emp-001',
    locationId: 'LOC-001',
    availableDays: 10,
    version: 1,
  } as Balance;

  beforeEach(() => {
    requestsRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<TimeOffRequest>>;

    balanceService = {
      getLocalBalance: jest.fn(),
      upsertBalance: jest.fn(),
      deductLocalBalance: jest.fn(),
      restoreLocalBalance: jest.fn(),
      refreshFromHcm: jest.fn(),
    } as unknown as jest.Mocked<BalanceService>;

    hcmService = {
      getBalance: jest.fn(),
      deductBalance: jest.fn(),
    } as unknown as jest.Mocked<HcmService>;

    service = new RequestsService(requestsRepository, balanceService, hcmService);
  });

  describe('createRequest', () => {
    it("creates a PENDING request when local and HCM balances are sufficient", async () => {
      requestsRepository.create.mockReturnValue(pendingRequest);
      requestsRepository.save.mockResolvedValue(pendingRequest);
      balanceService.getLocalBalance.mockResolvedValue(localBalance);
      hcmService.getBalance.mockResolvedValue(10);

      const result = await service.createRequest(createDto);

      expect(result.status).toBe(RequestStatus.PENDING);
      expect(requestsRepository.save).toHaveBeenCalledWith(pendingRequest);
    });
    it('throws NotFoundException when no balance record exists in either local cache or HCM', async () => {
      balanceService.getLocalBalance.mockRejectedValue(new NotFoundException('missing'));
      hcmService.getBalance.mockRejectedValue(new NotFoundException('missing'));

      await expect(service.createRequest(createDto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('creates request when local cache is stale low but HCM has sufficient balance', async () => {
      balanceService.getLocalBalance.mockResolvedValue({
        ...localBalance,
        availableDays: 1,
      } as Balance);
      hcmService.getBalance.mockResolvedValue(10);
      balanceService.upsertBalance.mockResolvedValue({
        ...localBalance,
        availableDays: 10,
      } as Balance);
      requestsRepository.create.mockReturnValue(pendingRequest);
      requestsRepository.save.mockResolvedValue(pendingRequest);

      const result = await service.createRequest(createDto);

      expect(result.status).toBe(RequestStatus.PENDING);
      expect(balanceService.upsertBalance).toHaveBeenCalledWith(
        createDto.employeeId,
        createDto.locationId,
        10,
      );
    });

    it('creates request when local cache row is missing but HCM has a valid balance', async () => {
      balanceService.getLocalBalance.mockRejectedValue(new NotFoundException('missing'));
      hcmService.getBalance.mockResolvedValue(10);
      balanceService.upsertBalance.mockResolvedValue(localBalance);
      requestsRepository.create.mockReturnValue(pendingRequest);
      requestsRepository.save.mockResolvedValue(pendingRequest);

      const result = await service.createRequest(createDto);

      expect(result.status).toBe(RequestStatus.PENDING);
      expect(balanceService.upsertBalance).toHaveBeenCalledWith(
        createDto.employeeId,
        createDto.locationId,
        10,
      );
    });

    it('throws BadRequestException when HCM balance is insufficient', async () => {
      balanceService.getLocalBalance.mockResolvedValue(localBalance);
      hcmService.getBalance.mockResolvedValue(1);

      await expect(service.createRequest(createDto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('reconciles local balance when HCM balance differs from local cache', async () => {
      balanceService.getLocalBalance.mockResolvedValue({
        ...localBalance,
        availableDays: 6,
      } as Balance);
      hcmService.getBalance.mockResolvedValue(10);
      balanceService.upsertBalance.mockResolvedValue(localBalance);
      requestsRepository.create.mockReturnValue(pendingRequest);
      requestsRepository.save.mockResolvedValue(pendingRequest);

      await service.createRequest(createDto);

      expect(balanceService.upsertBalance).toHaveBeenCalledWith(
        createDto.employeeId,
        createDto.locationId,
        10,
      );
    });

    it("saves request with status 'pending'", async () => {
      balanceService.getLocalBalance.mockResolvedValue(localBalance);
      hcmService.getBalance.mockResolvedValue(10);
      requestsRepository.create.mockReturnValue(pendingRequest);
      requestsRepository.save.mockResolvedValue(pendingRequest);

      await service.createRequest(createDto);

      expect(requestsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: RequestStatus.PENDING }),
      );
    });
  });

  describe('approveRequest', () => {
    it("sets status to 'approved' and deducts balance end-to-end", async () => {
      requestsRepository.findOne.mockResolvedValue({ ...pendingRequest });
      balanceService.getLocalBalance.mockResolvedValue(localBalance);
      hcmService.getBalance.mockResolvedValueOnce(10).mockResolvedValueOnce(7);
      balanceService.deductLocalBalance.mockResolvedValue({
        ...localBalance,
        availableDays: 7,
        version: 2,
      } as Balance);
      hcmService.deductBalance.mockResolvedValue(undefined);
      requestsRepository.save.mockResolvedValue({
        ...pendingRequest,
        status: RequestStatus.APPROVED,
        resolvedBy: 'mgr-001',
      } as TimeOffRequest);

      const result = await service.approveRequest('req-001', 'mgr-001');

      expect(result.status).toBe(RequestStatus.APPROVED);
      expect(balanceService.deductLocalBalance).toHaveBeenCalledWith(
        'emp-001',
        'LOC-001',
        3,
        1,
      );
    });

    it('throws NotFoundException when request does not exist', async () => {
      requestsRepository.findOne.mockResolvedValue(null);

      await expect(service.approveRequest('missing', 'mgr-001')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws BadRequestException when request is not in pending status', async () => {
      requestsRepository.findOne.mockResolvedValue({
        ...pendingRequest,
        status: RequestStatus.APPROVED,
      } as TimeOffRequest);

      await expect(service.approveRequest('req-001', 'mgr-001')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('re-fetches HCM balance before approving (detects stale cache)', async () => {
      requestsRepository.findOne.mockResolvedValue({ ...pendingRequest });
      balanceService.getLocalBalance.mockResolvedValue({
        ...localBalance,
        availableDays: 5,
        version: 1,
      } as Balance);
      hcmService.getBalance.mockResolvedValueOnce(9).mockResolvedValueOnce(6);
      balanceService.upsertBalance.mockResolvedValue({
        ...localBalance,
        availableDays: 9,
        version: 2,
      } as Balance);
      balanceService.deductLocalBalance.mockResolvedValue({
        ...localBalance,
        availableDays: 6,
        version: 3,
      } as Balance);
      hcmService.deductBalance.mockResolvedValue(undefined);
      requestsRepository.save.mockResolvedValue({
        ...pendingRequest,
        status: RequestStatus.APPROVED,
        resolvedBy: 'mgr-001',
      } as TimeOffRequest);

      await service.approveRequest('req-001', 'mgr-001');

      expect(hcmService.getBalance).toHaveBeenCalledWith('emp-001', 'LOC-001');
      expect(balanceService.upsertBalance).toHaveBeenCalledWith(
        'emp-001',
        'LOC-001',
        9,
      );
      expect(balanceService.deductLocalBalance).toHaveBeenCalledWith(
        'emp-001',
        'LOC-001',
        3,
        2,
      );
    });

    it('throws BadRequestException when HCM balance is insufficient at approval time', async () => {
      requestsRepository.findOne.mockResolvedValue({ ...pendingRequest });
      balanceService.getLocalBalance.mockResolvedValue(localBalance);
      hcmService.getBalance.mockResolvedValue(2);
      balanceService.upsertBalance.mockResolvedValue({
        ...localBalance,
        availableDays: 2,
        version: 2,
      } as Balance);

      await expect(service.approveRequest('req-001', 'mgr-001')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(balanceService.deductLocalBalance).not.toHaveBeenCalled();
    });

    it('restores local balance if HCM deduct call fails (rollback)', async () => {
      requestsRepository.findOne.mockResolvedValue({ ...pendingRequest });
      balanceService.getLocalBalance.mockResolvedValue(localBalance);
      hcmService.getBalance.mockResolvedValue(10);
      balanceService.deductLocalBalance.mockResolvedValue({
        ...localBalance,
        availableDays: 7,
      } as Balance);
      hcmService.deductBalance.mockRejectedValue(new Error('deduct failed'));
      balanceService.restoreLocalBalance.mockResolvedValue(localBalance);

      await expect(service.approveRequest('req-001', 'mgr-001')).rejects.toThrow(
        'deduct failed',
      );
      expect(balanceService.restoreLocalBalance).toHaveBeenCalledWith(
        'emp-001',
        'LOC-001',
        3,
      );
    });

    it('restores local balance and throws ConflictException when HCM post-deduct balance is unchanged', async () => {
      requestsRepository.findOne.mockResolvedValue({ ...pendingRequest });
      balanceService.getLocalBalance.mockResolvedValue(localBalance);
      hcmService.getBalance.mockResolvedValueOnce(10).mockResolvedValueOnce(10);
      balanceService.deductLocalBalance.mockResolvedValue({
        ...localBalance,
        availableDays: 7,
      } as Balance);
      hcmService.deductBalance.mockResolvedValue(undefined);
      balanceService.restoreLocalBalance.mockResolvedValue(localBalance);

      await expect(service.approveRequest('req-001', 'mgr-001')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(balanceService.restoreLocalBalance).toHaveBeenCalledWith(
        'emp-001',
        'LOC-001',
        3,
      );
    });

    it('propagates ConflictException from deductLocalBalance (optimistic lock)', async () => {
      requestsRepository.findOne.mockResolvedValue({ ...pendingRequest });
      balanceService.getLocalBalance.mockResolvedValue(localBalance);
      hcmService.getBalance.mockResolvedValue(10);
      balanceService.deductLocalBalance.mockRejectedValue(
        new ConflictException('Concurrent modification detected'),
      );

      await expect(service.approveRequest('req-001', 'mgr-001')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(hcmService.deductBalance).not.toHaveBeenCalled();
    });

    it('sets resolvedBy to the managerId provided', async () => {
      requestsRepository.findOne.mockResolvedValue({ ...pendingRequest });
      balanceService.getLocalBalance.mockResolvedValue(localBalance);
      hcmService.getBalance.mockResolvedValueOnce(10).mockResolvedValueOnce(7);
      balanceService.deductLocalBalance.mockResolvedValue({
        ...localBalance,
        availableDays: 7,
      } as Balance);
      hcmService.deductBalance.mockResolvedValue(undefined);
      requestsRepository.save.mockImplementation(
        async (request) => request as TimeOffRequest,
      );

      const result = await service.approveRequest('req-001', 'mgr-xyz');
      expect(result.resolvedBy).toBe('mgr-xyz');
    });
  });

  describe('rejectRequest', () => {
    it("sets status to 'rejected' without modifying balance", async () => {
      requestsRepository.findOne.mockResolvedValue({ ...pendingRequest });
      requestsRepository.save.mockImplementation(
        async (request) => request as TimeOffRequest,
      );

      const result = await service.rejectRequest('req-001', 'mgr-001');
      expect(result.status).toBe(RequestStatus.REJECTED);
      expect(balanceService.deductLocalBalance).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when request does not exist', async () => {
      requestsRepository.findOne.mockResolvedValue(null);

      await expect(service.rejectRequest('missing', 'mgr-001')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws BadRequestException when request is not pending', async () => {
      requestsRepository.findOne.mockResolvedValue({
        ...pendingRequest,
        status: RequestStatus.REJECTED,
      } as TimeOffRequest);

      await expect(service.rejectRequest('req-001', 'mgr-001')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('cancelRequest', () => {
    it("sets status to 'cancelled' and restores local balance", async () => {
      requestsRepository.findOne.mockResolvedValue({ ...pendingRequest });
      balanceService.restoreLocalBalance.mockResolvedValue(localBalance);
      requestsRepository.save.mockImplementation(
        async (request) => request as TimeOffRequest,
      );

      const result = await service.cancelRequest('req-001', 'emp-001');

      expect(result.status).toBe(RequestStatus.CANCELLED);
      expect(balanceService.restoreLocalBalance).toHaveBeenCalledWith(
        'emp-001',
        'LOC-001',
        3,
      );
      expect(balanceService.refreshFromHcm).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when request does not exist', async () => {
      requestsRepository.findOne.mockResolvedValue(null);

      await expect(service.cancelRequest('missing', 'emp-001')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when employeeId does not match request owner', async () => {
      requestsRepository.findOne.mockResolvedValue({ ...pendingRequest });

      await expect(service.cancelRequest('req-001', 'emp-999')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws BadRequestException when request is not in pending status', async () => {
      requestsRepository.findOne.mockResolvedValue({
        ...pendingRequest,
        status: RequestStatus.APPROVED,
      } as TimeOffRequest);

      await expect(service.cancelRequest('req-001', 'emp-001')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('getRequest', () => {
    it('returns request by id', async () => {
      requestsRepository.findOne.mockResolvedValue({ ...pendingRequest });

      const result = await service.getRequest('req-001');
      expect(result.id).toBe('req-001');
    });

    it('throws NotFoundException when request does not exist', async () => {
      requestsRepository.findOne.mockResolvedValue(null);

      await expect(service.getRequest('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
