-- Bumps the generation counter and writes the OTP record as one atomic unit.
-- The INCR's result is used inside the script to stamp the record with the
-- generation, which a client-side MULTI cannot do (queued command arguments
-- are fixed before EXEC; results are only available after). The counter TTL
-- is comfortably longer than the record TTL so the counter is guaranteed
-- alive for the lifetime of any pending record.
--
-- KEYS[1] = generation counter key
-- KEYS[2] = otp record key
-- ARGV[1] = counter TTL (seconds)
-- ARGV[2] = issuedAt ISO string
-- ARGV[3] = record TTL (seconds)
local count = redis.call("INCR", KEYS[1])
redis.call("EXPIRE", KEYS[1], ARGV[1])
redis.call("HSET", KEYS[2], "count", count, "issuedAt", ARGV[2])
redis.call("EXPIRE", KEYS[2], ARGV[3])
return count
