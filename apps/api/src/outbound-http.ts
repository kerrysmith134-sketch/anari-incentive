/**
 * 兼容导出：出站安全层已移入 @anari/connectors，供同步连接器与 API 共用。
 */
export {
  outboundJsonFetch,
  pinnedFetch,
  redactSample,
} from "@anari/connectors";
export type {
  OutboundAddress,
  OutboundBody,
  OutboundHttpDeps,
  OutboundHttpResponse,
  OutboundJsonFetchInput,
  OutboundJsonFetchResult,
  OutboundRequestFn,
  OutboundRequestOptions,
} from "@anari/connectors";
