import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getJwtAccessSecret } from '../jwt-config';
import { PrismaService } from '../../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtAccessSecret(configService),
    });
  }

  async validate(payload: JwtPayload) {
    // Token xác thực danh tính; quyền và trạng thái tài khoản lấy từ DB hiện tại.
    // Xóa/khóa tài khoản hoặc hạ vai trò phải có hiệu lực cả với access token còn hạn.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub, deletedAt: null, isActive: true },
      select: { id: true, email: true, role: true },
    });
    if (!user)
      throw new UnauthorizedException(
        'Tài khoản không còn hoạt động. Vui lòng đăng nhập lại.',
      );
    return user;
  }
}
