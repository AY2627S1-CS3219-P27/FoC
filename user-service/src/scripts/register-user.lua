-- Validates a registration token and, on success, returns the email it is
-- bound to while atomically consuming the token (single-use).
--
-- Every rejected condition (unknown/expired, already consumed) returns `0`.
--
-- The existence check, the not-yet-consumed check and the consumption stamp
-- happen in one atomic unit, so a token can never be consumed without being
-- validated, nor replayed to register a second account.
--
-- KEYS[1] = registration token record key
-- ARGV[1] = consumedAt ISO string
local record = redis.call("HGETALL", KEYS[1])

-- Registration token doesn't exist in the DB
-- (never issued, or already evicted by its TTL)
if #record == 0 then
	return 0
end

-- HGETALL returns an alternating key, value list.
-- We store { key: value } in fields for easy lookup.
local fields = {}
for i = 1, #record, 2 do
	fields[record[i]] = record[i + 1]
end

-- Registration token may be consumed already (single-use)
-- Double-check this is not a stale token
if fields["consumedAt"] ~= nil then
	return 0
end

-- All checks passed: record consumption of the token
redis.call("HSET", KEYS[1], "consumedAt", ARGV[1])

-- Return the email bound to the registration token
return fields["email"]