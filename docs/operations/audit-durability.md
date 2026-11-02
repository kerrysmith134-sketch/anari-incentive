# Audit durability runbook (MON-07)

The application writes an append-only, hash-chained audit trail. The repository **cannot provision WORM storage by itself**; this runbook defines the deployment controls required to make the chain durable and externally verifiable.

## Required controls

1. **Primary database backups** — continuous WAL archiving plus daily snapshots, encrypted at rest, in a separate account/project from the application.
2. **WORM copy** — stream audit rows to object storage with Object Lock in compliance mode (or an equivalent immutable archive). Retain at least the legal/audit period and protect the bucket policy from deletion by the application role.
3. **Dual copies** — keep a second immutable copy in a different region or provider. Never let the application role delete either copy.
4. **External anchoring** — at least daily, call:
   ```
   GET /api/v1/audit-events/anchor
   ```
   The response includes the sequence window, `rootHash`, first/last event hash and event count. Submit `rootHash` to an independent timestamp authority (TSA) or a separate append-only ledger, and store the receipt with the WORM object. This proves the chain existed at that time even if the database is later compromised.
5. **Restore drills** — quarterly restore of a snapshot into an isolated environment, then run `GET /api/v1/audit-events/verify` and compare the anchor root with the restored range.
6. **Access separation** — database backup, object-lock retention and TSA credentials are held by different roles from the application runtime. Break-glass access is logged and reviewed.

## Configuration readiness

The API exposes `GET /api/v1/audit-events/durability`, which reports whether the deployment has set:

- `AUDIT_WORM_URI` — immutable/WORM archive location;
- `AUDIT_MIRROR_URI` — second immutable copy;
- `AUDIT_TSA_URL` — timestamp authority endpoint;
- `AUDIT_RESTORE_DRILL_AT` — ISO timestamp of the latest restore drill (must be within 90 days).

The endpoint reports configuration presence only; it does not prove the bucket policy, mirror or TSA receipt exists. A `ready: false` result is a release blocker for a claim of MON-07 completion.

## Verification evidence to keep

- Anchor response JSON (or its hash) and TSA receipt per day.
- Object-lock retention settings and bucket policy export.
- Restore-drill record: snapshot id, restore time, verify result, anchor comparison.
- Access-review record for backup/WORM/TSA roles.

## Failure handling

- `verify=false` or a root mismatch: stop settlement/lock operations for the affected tenant, preserve the current database and WORM copies, and open a security incident. Do not "repair" hashes in place.
- Missing anchor for a day: backfill from the WORM copy and re-anchor; record the gap in the incident log.
- WORM bucket unavailable: continue writes to the primary database, queue export, and alert; the hash chain remains locally verifiable but external proof is delayed.

## Scope note

This runbook is an operational requirement, not evidence that a particular deployment has enabled WORM. Record the deployment's actual bucket/TSA configuration in the environment's evidence pack before claiming MON-07 complete.
