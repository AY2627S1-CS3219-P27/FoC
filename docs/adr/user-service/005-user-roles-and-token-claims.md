# User roles and token claims

## Decision

The user service shall model participant roles (Requester, Courier) as a
PostgreSQL enum array. This is distinct from the admin status of the account,
which is represented as a boolean flag on the account.

Access tokens carry both `roles` and `isAdmin` as distinct claims in its
payload:

- `roles`: string array of the same enum values.
- `isAdmin`: boolean.

## Rationale

### Separation of Admin / Participation roles

Regarding the separation of Admin and Courier/Participation roles, this is due
to the fact that Admin endpoints will never require requester/courier roles. The
reverse is also true - they are distinct authorization paths.

Keeping admin roles separate also prevents any possible exploitation to be done
on setting participation roles - the PATCH endpoint to update roles can only
ever possibly update participation roles by design. Admin roles sit elsewhere.

### Roles as an enum array column

Roles carry no extra metadata - we don't need a whole other table to join on.
Moreover, modelling it as an enum array (as opposed to boolean columns) allows
us to easily add new roles in the future. It just requires updating the role
list on user service.

### Roles in the token

Allows any service to statelessly know the authorization level of the user.

A consequence of this is that tokens may hold stale claims. We mitigate this by
forcing token-clearing on role changes, and also requiring an actual DB check on
sensitive endpoints (like admin)

