/**
 * DATA-05 活动监控用语检测（治理域，NPV2-011）：
 * 结构化字段阻断 + 自由文本短语检测双保险。
 */
const ACTIVITY_METRIC_KEYS = new Set(
  [
    "keystrokes",
    "keystrokeCount",
    "mouseMovements",
    "mouseClicks",
    "screenTime",
    "screenTimeMinutes",
    "idleTime",
    "activeWindow",
    "appUsage",
    "websiteUsage",
    "browsingHistory",
    "clipboard",
    "screenshot",
    "webcam",
    "microphone",
    "gps",
    "locationHistory",
    "activityVolume",
    "activityCount",
    "productivityScore",
  ].map((key) => key.replace(/[^a-z0-9]/gi, "").toLowerCase()),
);

function normalizeMetricKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

const ACTIVITY_MONITORING_PHRASES = [
  "keystroke logging",
  "keystroke logger",
  "keystroke monitoring",
  "mouse tracking",
  "mouse movement tracking",
  "screen recording software",
  "screen capture monitoring",
  "screen monitoring",
  "webcam monitoring",
  "camera monitoring",
  "webcam surveillance",
  "app usage tracking",
  "application usage monitoring",
  "website usage tracking",
  "browsing history tracking",
  "clipboard monitoring",
  "location tracking",
  "location history tracking",
  "gps tracking",
  "productivity monitoring",
  "employee monitoring software",
  "键盘记录",
  "键盘监控",
  "鼠标追踪",
  "屏幕监控",
  "摄像头监控",
  "剪贴板监控",
  "定位追踪",
  "位置追踪",
  "员工监控软件",
] as const;

export function findActivityMetricKeys(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (ACTIVITY_METRIC_KEYS.has(normalizeMetricKey(key))) {
        found.add(key);
      }
      visit(child);
    }
  };
  visit(value);
  return [...found];
}

export function findActivityMonitoringText(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (node: unknown) => {
    if (typeof node === "string") {
      const text = node.toLowerCase();
      for (const phrase of ACTIVITY_MONITORING_PHRASES) {
        if (text.includes(phrase)) found.add(phrase);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return [...found];
}
