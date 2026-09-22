-- Validates an OTP and consumes it atomically if valid.
--
-- Every rejected condition (unknown/expired, revoked, already consumed)
-- returns`0`
--
-- Tokens inspected as valid are instantly marked as consumed.
--
-- KEYS[1] = otp record key
-- KEYS[2] = generation counter key
-- ARGV[1] = consumedAt ISO string
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

-- OTP may be consumed or revoked already
-- Double-check this is not a stale token
-- (Reading an absent key returns nil)
if fields["consumedAt"] ~= nil or fields["revokedAt"] ~= nil then
	return 0
end

-- Per-email counters are stored as a separate key
-- Ensure that the separate email counter matches
-- this OTP's counter, so we don't validate stale tokens.
local counter = redis.call("GET", KEYS[2])
if not counter or tonumber(counter) ~= tonumber(fields["count"]) then
	return 0
end

-- Record consumption of token
redis.call("HSET", KEYS[1], "consumedAt", ARGV[1])

return 1
