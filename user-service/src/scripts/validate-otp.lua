-- Validates an OTP, and on success, atomically issues a registration
-- token bound to the verified email before consuming the OTP.
--
-- Failed guesses are counted per issued OTP (per generation). Reaching the
-- limit revokes the OTP by bumping the generation counter, so its record no
-- longer matches and the user must request a new one.
--
-- Every rejected condition returns `0`.
--
-- The token record and the OTP consumption happen in one atomic unit, so an
-- OTP can never be consumed without a token being issued, nor replayed for a
-- second token.
--
-- KEYS[1] = otp record key
-- KEYS[2] = generation counter key
-- KEYS[3] = registration token record key
-- KEYS[4] = failed-attempt hash key (one field per generation)
-- ARGV[1] = createdAt / consumedAt ISO string
-- ARGV[2] = registration token TTL (seconds)
-- ARGV[3] = verified email
-- ARGV[4] = maximum failed attempts per issued OTP
-- ARGV[5] = failed-attempt hash TTL (seconds)

local counter = redis.call("GET", KEYS[2])

-- No OTP is currently issued for this email: nothing to validate or revoke.
if not counter then
	return 0
end

local record = redis.call("HGETALL", KEYS[1])

-- OTP doesn't exist in the DB: a wrong guess, or an expired/revoked record.
-- Count it against the generation currently issued to this email.
if #record == 0 then
	-- counter is a field on <OTP_PREFIX>:attempts:<email>
	-- whenever we check against a newly-generated otp, counter
	-- is incremented and hence the integer resets to 0.
	local attempts = redis.call("HINCRBY", KEYS[4], counter, 1)
	redis.call("EXPIRE", KEYS[4], ARGV[5])
	if attempts >= tonumber(ARGV[4]) then
		-- Bumping the generation revokes the issued OTP: its record is stamped
		-- with the old generation and will never match again.
		redis.call("INCR", KEYS[2])
	end
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

-- Ensure that the separate email counter matches
-- this OTP's counter, so we don't validate revoked tokens.
if tonumber(counter) ~= tonumber(fields["count"]) then
	return 0
end

-- All checks passed: issue the registration token record with expiry.
redis.call("HSET", KEYS[3], "email", ARGV[3], "createdAt", ARGV[1])
redis.call("EXPIRE", KEYS[3], ARGV[2])

-- Record consumption of the OTP
redis.call("HSET", KEYS[1], "consumedAt", ARGV[1])

return 1
