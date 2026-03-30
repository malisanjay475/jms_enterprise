import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Validates raw credentials and issues a heavily-secured JSON Web Token.
   */
  async login(username: string, passwordRaw: string) {
    // 1. Fetch user map
    const user = await this.usersService.findByUsername(username);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 2. Prevent deactivated user from establishing a session
    if (!user.is_active) {
      throw new UnauthorizedException('Account suspended');
    }

    // 3. Cryptographically compare the password
    const passwordMatch = await bcrypt.compare(passwordRaw, user.password);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 4. Construct JWT Payload (Excluding sensitive data)
    // We include factory_id in the payload so that the JWT Strategy can
    // establish Row-Level Security contexts efficiently later.
    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      factoryId: user.factory_id, 
    };

    return {
      access_token: this.jwtService.sign(payload),
      // Future-proofing: return user subset for immediate UI rendering
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        factoryId: user.factory_id
      }
    };
  }
}
