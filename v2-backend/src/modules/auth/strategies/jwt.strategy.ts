import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly configService: ConfigService) {
    // Standard Enterprise Setup: Read JWT explicitly from the Bearer Token
    // Fail immediately if there's no JWT_SECRET env defined.
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false, // Force re-login when tokens expire for security
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  /**
   * Passport runs this function IF AND ONLY IF the token's cryptographic signature 
   * is perfectly valid. The `payload` argument is the decoded internal JSON.
   */
  async validate(payload: any) {
    // 10/10 Enterprise Note: Attaching this object to `req.user` allows 
    // the Prisma Middleware to grab `req.user.factoryId` globally 
    // and automatically enforce Row-Level Security!
    return {
      userId: payload.sub,
      username: payload.username,
      role: payload.role,
      factoryId: payload.factoryId,
    };
  }
}
