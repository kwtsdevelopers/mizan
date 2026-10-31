import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { DatabaseService } from '../database/database.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Public()
  @Get()
  health(): { status: string; time: string } {
    return { status: 'ok', time: new Date().toISOString() };
  }

  @Public()
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready(): Promise<{ status: string; database: string }> {
    const dbOk = await this.db.healthy();
    if (!dbOk) throw new ServiceUnavailableException({ status: 'degraded', database: 'down' });
    return { status: 'ok', database: 'up' };
  }
}
