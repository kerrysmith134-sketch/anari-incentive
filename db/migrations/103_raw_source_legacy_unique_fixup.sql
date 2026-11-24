-- 103：修正迁移 100 未真正删除旧三列唯一约束的缺陷。
--
-- PostgreSQL 会把超过 63 字节的约束名截断：
--   099 实际生成的约束名是
--   raw_source_records_tenant_id_source_system_external_record__key
-- 而 100 使用 IF EXISTS 删除的却是未截断的名字，于是旧的三列 UNIQUE
-- 在全新数据库上仍然存在，导致同一 external_record_id 的第二个版本
-- 插入时报 duplicate key，版本账本无法形成。
--
-- 历史迁移不可改写（checksum 门禁），因此用本迁移按列集合精确删除：
-- 只删除“恰好是 (tenant_id, source_system, external_record_id)”的唯一约束，
-- 保留四列版本唯一键并确保其存在。

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'raw_source_records'::regclass
       AND c.contype = 'u'
       AND (
         SELECT array_agg(a.attname ORDER BY k.ordinality)
           FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality)
           JOIN pg_attribute a
             ON a.attrelid = c.conrelid AND a.attnum = k.attnum
       ) = ARRAY['tenant_id','source_system','external_record_id']::name[]
  LOOP
    EXECUTE format(
      'ALTER TABLE raw_source_records DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid = 'raw_source_records'::regclass
       AND c.contype = 'u'
       AND (
         SELECT array_agg(a.attname ORDER BY k.ordinality)
           FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality)
           JOIN pg_attribute a
             ON a.attrelid = c.conrelid AND a.attnum = k.attnum
       ) = ARRAY['tenant_id','source_system','external_record_id','source_version']::name[]
  ) THEN
    ALTER TABLE raw_source_records
      ADD CONSTRAINT uq_raw_source_record_version
      UNIQUE (tenant_id, source_system, external_record_id, source_version);
  END IF;
END $$;
