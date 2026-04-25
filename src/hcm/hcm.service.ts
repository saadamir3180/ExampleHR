import { HttpService } from '@nestjs/axios';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { firstValueFrom } from 'rxjs';

interface HcmBalanceResponse {
  employeeId: string;
  locationId: string;
  availableDays: number;
}

interface HcmDeductPayload {
  employeeId: string;
  locationId: string;
  days: number;
}

interface HcmBatchPayloadItem {
  employeeId: string;
  locationId: string;
  availableDays: number;
}

const API_KEY_HEADER = 'x-api-key';
const HCM_BALANCE_PATH = '/hcm/balance';
const HCM_DEDUCT_PATH = '/hcm/deduct';
const HCM_BATCH_PATH = '/hcm/batch';

const HCM_UNREACHABLE_ERROR = 'HCM service is unreachable';
const HCM_BALANCE_NOT_FOUND_ERROR = 'Balance record not found in HCM';
const HCM_DEDUCT_CONFLICT_ERROR = 'HCM rejected deduction request';

@Injectable()
export class HcmService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Fetches current available balance from the HCM system.
   */
  async getBalance(employeeId: string, locationId: string): Promise<number> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<HcmBalanceResponse>(
          `${this.baseUrl}${HCM_BALANCE_PATH}/${employeeId}/${locationId}`,
          { headers: this.headers },
        ),
      );
      return Number(response.data.availableDays);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === HttpStatus.NOT_FOUND) {
        throw new HttpException(HCM_BALANCE_NOT_FOUND_ERROR, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(HCM_UNREACHABLE_ERROR, HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Requests a balance deduction in the HCM system.
   */
  async deductBalance(
    employeeId: string,
    locationId: string,
    days: number,
  ): Promise<void> {
    const payload: HcmDeductPayload = { employeeId, locationId, days };

    try {
      await firstValueFrom(
        this.httpService.post(`${this.baseUrl}${HCM_DEDUCT_PATH}`, payload, {
          headers: this.headers,
        }),
      );
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const statusCode = error.response?.status;
        if (statusCode === HttpStatus.BAD_REQUEST || statusCode === HttpStatus.UNPROCESSABLE_ENTITY) {
          throw new HttpException(HCM_DEDUCT_CONFLICT_ERROR, HttpStatus.CONFLICT);
        }
        if (statusCode === HttpStatus.NOT_FOUND) {
          throw new HttpException(HCM_BALANCE_NOT_FOUND_ERROR, HttpStatus.NOT_FOUND);
        }
      }
      throw new HttpException(HCM_UNREACHABLE_ERROR, HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Sends batch balance payload to HCM in fire-and-forget mode.
   */
  async notifyBatch(payload: HcmBatchPayloadItem[]): Promise<void> {
    void firstValueFrom(
      this.httpService.post(`${this.baseUrl}${HCM_BATCH_PATH}`, payload, {
        headers: this.headers,
      }),
    ).catch(() => undefined);
  }

  private get baseUrl(): string {
    return this.configService.get<string>('HCM_BASE_URL') ?? '';
  }

  private get headers(): Record<string, string> {
    return {
      [API_KEY_HEADER]: this.configService.get<string>('HCM_API_KEY') ?? '',
    };
  }
}
