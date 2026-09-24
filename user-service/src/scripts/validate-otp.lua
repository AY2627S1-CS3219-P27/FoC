-- Validates an OTP, and on success, atomically issues a registration
-- token bound to the verified email before consuming the OTP.
--
-- Every rejected condition (unknown/expired, revoked, already consumed)
-- returns `0`.
--
-- The token record and the OTP consumption happen in one atomic unit, so an
-- OTP can never be consumed without a token being issued, nor replayed for a
-- second token.
--
-- KEYS[1] = otp record key
-- KEYS[2] = generation counter key
-- KEYS[3] = registration token record key
-- ARGV[1] = createdAt / consumedAt ISO string
-- ARGV[2] = registration token TTL (seconds)
-- ARGV[3] = verified email
local record = redis.call("HGETALL", KEYS[1])

-- OTP doesn't exist in the DB
if #record == 0 then
	return 0
end

-- HGETALL returns an alternating key, value list.
-- We store { key: value } in fields for easy lookup.
local fields = {}
for i = 1, #record, 2 do
	fields[record[i]] = record[i + 1]
end

-- OTP may be consumed already
-- Double-check this is not a stale token
-- (Reading an absent key returns nil)
if fields["consumedAt"] ~= nil then
	return 0
end

-- Per-email counters are stored as a separate key
-- Ensure that the separate email counter matches
-- this OTP's counter, so we don't validate revoked tokens.
local counter = redis.call("GET", KEYS[2])
if not counter or tonumber(counter) ~= tonumber(fields["count"]) then
	return 0
end

-- All checks passed: issue the registration token record with expiry.
redis.call("HSET", KEYS[3], "email", ARGV[3], "createdAt", ARGV[1])
redis.call("EXPIRE", KEYS[3], ARGV[2])

-- Record consumption of the OTP
redis.call("HSET", KEYS[1], "consumedAt", ARGV[1])

return 1
