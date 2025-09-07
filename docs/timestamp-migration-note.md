# DB Timestamp Format Note

This project stores run timestamps and the `next_wake_at` field as ISO-formatted UTC timestamps.

Important details:

- The executor writes `next_wake_at` using JavaScript's `new Date().toISOString()` which includes fractional seconds (milliseconds), e.g. `2025-09-06T07:29:55.334Z`.
- Many SQLite helpers and earlier code used `strftime('%Y-%m-%dT%H:%M:%SZ','now')`, which produces a timestamp without fractional seconds (e.g. `2025-09-06T07:29:55Z`).

Why this matters
- Comparing ISO timestamps as strings requires both sides to use the same format. If one side includes milliseconds and the other does not, lexicographic comparisons can behave unexpectedly in edge cases.

What we changed
- `findReadyRuns` now accepts an optional `nowIso` parameter (defaulting to `new Date().toISOString()`), and uses a parameterized SQL comparison `next_wake_at <= ?`. This ensures comparisons use a JS-produced ISO timestamp with millisecond precision for consistency.

Migration guidance
- No migration is strictly required for existing rows, but be aware that older rows written with SQLite's `strftime(...)` will lack milliseconds. Those rows remain comparable as long as callers use JS `nowIso()` for comparisons (the comparison will still work lexicographically in most cases). If you want consistent formatting for all rows, you can run an update to normalize `next_wake_at` values to include a ".000Z" fractional part when missing.

Example normalization SQL (run carefully):

```sql
UPDATE runs
SET next_wake_at = substr(next_wake_at, 1, 19) || '.000Z'
WHERE next_wake_at IS NOT NULL AND instr(next_wake_at, '.') = 0;
```

This will append `.000Z` to timestamps missing the fractional seconds portion.

Operational note
- Prefer JS-side generation of 'now' for all scheduling logic. The DB remains authoritative for scheduled wake times, but code reading and comparing `next_wake_at` should always use the JS `nowIso()` helper.

***
