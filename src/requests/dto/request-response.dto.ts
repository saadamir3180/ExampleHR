import { RequestStatus } from '../requests.entity';

export class RequestResponseDto {
  id: string;
  employeeId: string;
  locationId: string;
  days: number;
  status: RequestStatus;
  resolvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}
