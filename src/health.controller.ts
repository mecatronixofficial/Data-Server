import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Controller('health')
export class HealthController {
  private lastSuccessfulPing = 0;
  private pingInFlight?: Promise<void>;

  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    try {
      if (!this.connection.db) throw new Error('Database is not connected');
      const now = Date.now();
      if (now - this.lastSuccessfulPing >= 1_000) {
        this.pingInFlight ??= this.connection.db.admin().ping().then(() => {
          this.lastSuccessfulPing = Date.now();
        }).finally(() => {
          this.pingInFlight = undefined;
        });
        await this.pingInFlight;
      }
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Database is not ready');
    }
  }
}
