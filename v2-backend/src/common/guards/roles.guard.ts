import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. Check if the controller or method has the @Roles() metadata mapped to it
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // 2. If no @Roles() were attached to the route, it is accessible to anyone
    // who managed to pass the JWT Strategy (meaning any valid user).
    if (!requiredRoles) {
      return true;
    }

    // 3. Extract the `user` property injected by the Passport JWT Strategy
    const { user } = context.switchToHttp().getRequest();

    // 4. Ensure the user's role exists anywhere inside the permitted array.
    // E.g., @Roles(Role.SUPERADMIN, Role.FACTORY_ADMIN) 
    return requiredRoles.some((role) => user.role === role);
  }
}
