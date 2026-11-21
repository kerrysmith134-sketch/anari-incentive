-- 098：integration_webhook_endpoints 策略带平台旁路（NP-009 收口）。
--
-- routing key 解析是跨租户入口：resolveWebhookRoutingKey 在事务本地
-- platform_admin 提权事务中读取（与 Outbox claimBatchAtomic 同模式）；
-- 097 的原始策略只认 app.tenant_id，提权读不到 → 回调恒 404。
-- 本迁移将策略替换为 tenant_or_platform_isolation 同款。

DROP POLICY IF EXISTS integration_webhook_endpoints_isolation ON integration_webhook_endpoints;
CREATE POLICY tenant_or_platform_isolation ON integration_webhook_endpoints
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );
