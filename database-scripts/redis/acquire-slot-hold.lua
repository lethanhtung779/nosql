-- KEYS[1] = slot-index:<staffId>:<yyyy-mm-dd>
-- KEYS[2] = slot-hold:<token>
-- ARGV[1] = newEndMs - 1
-- ARGV[2] = newStartMs
-- ARGV[3] = JSON payload
-- ARGV[4] = TTL seconds (900 by default)
-- ARGV[5] = hold token

local members = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
for _, token in ipairs(members) do
  local raw = redis.call('GET', 'slot-hold:' .. token)
  if raw then
    local current = cjson.decode(raw)
    if tonumber(current.endMs) > tonumber(ARGV[2]) then
      return 0
    end
  else
    redis.call('ZREM', KEYS[1], token)
  end
end

redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4], 'NX')
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[5])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]) + 60)
return 1

