import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../common/decorators/role.decorator';
import { RoleGuard } from '../common/guards/role.guard';
import { CreateRequestDto } from './dto/create-request.dto';
import { RequestResponseDto } from './dto/request-response.dto';
import { RequestsService } from './requests.service';

const MANAGER_ID_HEADER = 'x-manager-id';
const EMPLOYEE_ID_HEADER = 'x-employee-id';
const MANAGER_ID_REQUIRED_MESSAGE = 'x-manager-id header is required';
const EMPLOYEE_ID_REQUIRED_MESSAGE = 'x-employee-id header is required';

@Controller('requests')
@UseGuards(RoleGuard)
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post()
  async createRequest(@Body() dto: CreateRequestDto): Promise<RequestResponseDto> {
    return this.requestsService.createRequest(dto);
  }

  @Get(':id')
  async getRequest(@Param('id') requestId: string): Promise<RequestResponseDto> {
    return this.requestsService.getRequest(requestId);
  }

  @Patch(':id/approve')
  @Roles('manager')
  async approveRequest(
    @Param('id') requestId: string,
    @Headers(MANAGER_ID_HEADER) managerId?: string,
  ): Promise<RequestResponseDto> {
    if (!managerId) {
      throw new BadRequestException(MANAGER_ID_REQUIRED_MESSAGE);
    }
    return this.requestsService.approveRequest(requestId, managerId);
  }

  @Patch(':id/reject')
  @Roles('manager')
  async rejectRequest(
    @Param('id') requestId: string,
    @Headers(MANAGER_ID_HEADER) managerId?: string,
  ): Promise<RequestResponseDto> {
    if (!managerId) {
      throw new BadRequestException(MANAGER_ID_REQUIRED_MESSAGE);
    }
    return this.requestsService.rejectRequest(requestId, managerId);
  }

  @Patch(':id/cancel')
  async cancelRequest(
    @Param('id') requestId: string,
    @Headers(EMPLOYEE_ID_HEADER) employeeId?: string,
  ): Promise<RequestResponseDto> {
    if (!employeeId) {
      throw new BadRequestException(EMPLOYEE_ID_REQUIRED_MESSAGE);
    }
    return this.requestsService.cancelRequest(requestId, employeeId);
  }
}
