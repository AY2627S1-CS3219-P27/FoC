-- Bumps the per-account generation counter and stores the reset token record
-- in one atomic unit. The INCR's result is stamped onto the record as
-- its generation; validation later compares it against the counter, so issuing
-- a new token implicitly revokes every prior unconsumed one without ever
-- touching their records — the same mechanism that revokes stale OTPs.
--
-- The counter TTL is comfortably longer than the record TTL so the counter is
-- guaranteed alive for the lifetime of any pending record.
--
-- KEYS[1] = generation counter key
-- KEYS[2] = reset token record key
-- ARGV[1] = counter TTL (seconds)
-- ARGV[2] = email the token is issued for
-- ARGV[3] = createdAt ISO string
-- ARGV[4] = record TTL (seconds)
local count = redis.call("INCR", KEYS[1])
redis.call("EXPIRE", KEYS[1], ARGV[1])

-- Allowlist entry. The hashed token is the key; consumedAt is absent
-- until the token is redeemed. Expiry is the record TTL, like OTP records.
redis.call("HSET", KEYS[2], "count", count, "email", ARGV[2], "createdAt", ARGV[3])
redis.call("EXPIRE", KEYS[2], ARGV[4])

return count