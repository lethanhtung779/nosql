import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export type SlotHold = {
  token: string; userId: string; staffId: string; branchId: string;
  serviceIds: string[]; startTime: string; endTime: string;
};

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 2, enableReadyCheck: true
  });

  ping() { return this.client.ping(); }
  async onModuleDestroy() { await this.client.quit(); }

  async cacheGet<T>(key: string): Promise<T | null> {
    const value = await this.client.get(`cache:${key}`);
    return value ? JSON.parse(value) : null;
  }
  async cacheSet(key: string, value: unknown, ttlSeconds = 300) {
    await this.client.set(`cache:${key}`, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async acquireHold(hold: SlotHold, ttlSeconds = 900) {
    const day = hold.startTime.slice(0, 10);
    const indexKey = `slot-index:${hold.staffId}:${day}`;
    const holdKey = `slot-hold:${hold.token}`;
    const lua = `
      local members = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
      for _, token in ipairs(members) do
        local raw = redis.call('GET', 'slot-hold:' .. token)
        if raw then
          local current = cjson.decode(raw)
          if tonumber(current.endMs) > tonumber(ARGV[2]) then return 0 end
        else redis.call('ZREM', KEYS[1], token) end
      end
      redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4], 'NX')
      redis.call('ZADD', KEYS[1], ARGV[2], ARGV[5])
      redis.call('EXPIRE', KEYS[1], ARGV[4] + 60)
      return 1`;
    const payload = JSON.stringify({ ...hold, startMs: Date.parse(hold.startTime), endMs: Date.parse(hold.endTime) });
    const acquired = await this.client.eval(lua, 2, indexKey, holdKey, Date.parse(hold.endTime) - 1, Date.parse(hold.startTime), payload, ttlSeconds, hold.token);
    return acquired === 1;
  }

  async getHold(token: string): Promise<SlotHold | null> {
    const raw = await this.client.get(`slot-hold:${token}`);
    return raw ? JSON.parse(raw) : null;
  }

  async releaseHold(hold: SlotHold) {
    const day = hold.startTime.slice(0, 10);
    await this.client.multi().del(`slot-hold:${hold.token}`).zrem(`slot-index:${hold.staffId}:${day}`, hold.token).exec();
  }
}
