# Storing profile pictures in FoC

## Decision

FoC shall store profile pictures as URLs in the database. The database field for
URLs shall be defined to be `varchar(2083)`

## Rationale

### Storing profile pictures as URLs

This allows us to use not be coupled to storing on the DB - using URLs allows us
to use theoretically any kind of blob storage that is accessible.

Additionally, it allows us to manage costing of image storage through the
storage provider.

### Using varchar(2083)

The lowest common denominator for URL length is 2083, supported by IE.

Anything further beyond that value is unreasonable. While 2083 is still a very
long value, PostgreSQL documents that there is no
[performance impact from using longer varchars](https://www.postgresql.org/docs/8.3/datatype-character.html),
unlike DBMSes like MySQL. As such, it does not cost us much to cater to edge
cases such as this.
