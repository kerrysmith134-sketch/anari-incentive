const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";
const idempotencyKey = process.env.SCAN_KEY ?? `scan-${Date.now()}`;

const response = await fetch(`${baseUrl}/api/v1/agent-tasks/scan`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ idempotencyKey }),
});

const body = await response.json();
if (!response.ok) {
  console.error(`Agent scan failed (${response.status})`, body);
  process.exit(1);
}
console.log(
  JSON.stringify(
    body.data.map((task: { id: string; agentType: string; status: string; findings: unknown[] }) => ({
      id: task.id,
      agentType: task.agentType,
      status: task.status,
      findings: task.findings.length,
    })),
    null,
    2,
  ),
);
