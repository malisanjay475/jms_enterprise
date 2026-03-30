import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves a user by their exact username. 
   * Crucial for the initial step of the Authentication flow.
   */
  async findByUsername(username: string) {
    return this.prisma.user.findUnique({
      where: { username },
    });
  }

  /**
   * Creates a new user, automatically hashing their password using bcrypt 
   * with a high work factor (salt rounds = 12) for Enterprise-level security.
   */
  async createUser(data: { username: string; passwordRaw: string; factoryId?: number; role: Role }) {
    // Ensure the user doesn't already exist
    const existing = await this.findByUsername(data.username);
    if (existing) {
      throw new ConflictException('Username is already taken.');
    }

    // Hash the password purely on the server-side before it ever touches Prisma
    const saltRounds = 12; 
    const hashedPassword = await bcrypt.hash(data.passwordRaw, saltRounds);

    // Persist securely
    return this.prisma.user.create({
      data: {
        username: data.username,
        password: hashedPassword,
        factory_id: data.factoryId || null,
        role: data.role,
      },
      // Do not return the password hash back to the invoker
      select: {
        id: true,
        username: true,
        role: true,
        factory_id: true,
        is_active: true,
        created_at: true,
      }
    });
  }
}
