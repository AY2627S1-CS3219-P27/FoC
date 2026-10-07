-- Validates a password reset token and, on success, atomically records its
-- consumption and returns the email it was issued for.
--
-- Every rejected condition returns `0` alike, so the caller cannot tell which
-- rule failed:
--   no record / evicted by TTL -> never issued, or past its 10-minute expiry
--   consumedAt present         -> already redeemed
--   generation mismatch        -> superseded by a newer token
-- The email bound at issuance is fixed inside the record and never read from
-- client input, so a token can only ever be redeemed against the account it
-- was issued for (by construction).
--
-- KEYS[1] = reset token record key
-- KEYS[2] = per-account generation counter key
-- ARGV[1] = consumedAt ISO string
local record = redis.call("HGETALL", KEYS[1])

-- Reset token doesn't exist in the allowlist.
if #record == 0 then
	return 0
end

-- HGETALL returns an alternating key, value list.
local fields = {}
for i = 1, #record, 2 do
	fields[record[i]] = record[i + 1]
end

-- Tokens are single-use.
if fields["consumedAt"] ~= nil then
	return 0
end

-- The counter holds the generation of the newest token; anything older does
-- not match and is implicitly revoked.
local counter = redis.call("GET", KEYS[2])
if not counter or tonumber(counter) ~= tonumber(fields["count"]) then
	return 0
end

-- All checks passed: records the consumption atomically.
redis.call("HSET", KEYS[1], "consumedAt", ARGV[1])

-- Return the email bound to the reset token, to resolve the account to update.
return fields["email"]