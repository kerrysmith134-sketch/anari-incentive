-- Password credential for account login ( alongside Feishu SSO ).
BEGIN;

ALTER TABLE users ADD COLUMN password_hash text;

COMMIT;
