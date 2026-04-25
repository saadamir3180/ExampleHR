import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AppRole, ROLES_KEY } from '../decorators/role.decorator';

const ROLE_HEADER_NAME = 'x-role';
const FORBIDDEN_ROLE_MESSAGE = 'Forbidden resource';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AppRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const headerValue = request.headers[ROLE_HEADER_NAME];
    const role = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!role || !requiredRoles.includes(role as AppRole)) {
      throw new ForbiddenException(FORBIDDEN_ROLE_MESSAGE);
    }

    return true;
  }
}
