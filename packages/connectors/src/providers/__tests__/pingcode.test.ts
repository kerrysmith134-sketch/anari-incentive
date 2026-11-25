import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pingcodeProvider } from "../pingcode.js";
import type { CanonicalWrite } from "../types.js";

const root = process.cwd();
const target = pingcodeProvider.targets[0]!;

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(root, "fixtures", "connectors", name), "utf8"),
  ) as Record<string, unknown>;
}

function writesFor(sample: unknown): CanonicalWrite[] {
  return target.extract(sample).flatMap((record) => {
    const result = target.normalize(record);
    return Array.isArray(result) ? result : [result];
  });
}

function writeByExternalId(
  writes: CanonicalWrite[],
  externalId: string,
): CanonicalWrite {
  const found = writes.find((write) => write.externalId === externalId);
  if (!found) throw new Error(`write ${externalId} not found`);
  return found;
}

function bodyOf(write: CanonicalWrite): Record<string, unknown> {
  return write.body;
}

describe("PingCode provider contract", () => {
  it("declares the official base URL / token env and v2 work-item list target", () => {
    expect(pingcodeProvider.code).toBe("pingcode");
    expect(pingcodeProvider.sourceSystem).toBe("PINGCODE");
    expect(pingcodeProvider.baseUrlEnv).toBe("PINGCODE_BASE_URL");
    expect(pingcodeProvider.tokenEnv).toBe("PINGCODE_ACCESS_TOKEN");
    expect(pingcodeProvider.targets).toHaveLength(1);

    expect(target.method).toBe("GET");
    expect(target.path).toBe("/v2/pjm/workitems");
    // 官方分页：page_index 从 0 开始；page_size 默认 30、最大 100。
    expect(target.pageParam).toBe("page_index");
    expect(target.limitParam).toBe("page_size");
    expect(target.pageSize).toBe(100);
    expect(target.cursorParam).toBeUndefined();
  });

  it("extracts the values array and tolerates malformed pages", () => {
    const sample = readFixture("pingcode-work-items.sample.json");
    expect(target.extract(sample)).toHaveLength(6);
    expect(target.extract({ values: "not-an-array" })).toEqual([]);
    expect(target.extract({})).toEqual([]);
    expect(target.extract(null)).toEqual([]);
  });

  it("maps a story to the canonical work-item import endpoint", () => {
    const writes = writesFor(readFixture("pingcode-work-items.sample.json"));
    expect(writes).toHaveLength(3);

    const story = writeByExternalId(writes, "5edca524cad2fa1125cb0630");
    expect(story.path).toBe("/api/v1/work-items/import");
    const body = bodyOf(story);
    expect(body.sourceSystem).toBe("PINGCODE");
    expect(body.externalId).toBe("5edca524cad2fa1125cb0630");
    // projectId 只取 project.id，不用 human-readable identifier。
    expect(body.projectId).toBe("5eb623f6a70571487ea47000");
    expect(body.title).toBe("充电桩固件回归");
    expect(body.type).toBe("STORY");
    expect(body.status).toBe("OPEN");
    // 32 位十六进制人员 id 不是 UUID：不能写 assigneePersonId，也不生成贡献。
    expect(body.assigneePersonId).toBeUndefined();
    expect(body.contributions).toBeUndefined();
    expect(body.completedAt).toBeUndefined();
    expect(body.events).toBeUndefined();

    // 规范表没有 sprint 列；原始快照保留 sprint 与秒级时间戳供追溯。
    const payload = body.payload as Record<string, unknown>;
    expect((payload.sprint as Record<string, unknown>).name).toBe("Sprint 1");
    expect(payload.created_at).toBe(1583290300);
    expect(payload.updated_at).toBe(1583290300);
  });

  it("maps task/bug status and derives a completion event from completed_at", () => {
    const writes = writesFor(readFixture("pingcode-work-items.sample.json"));

    const task = bodyOf(
      writeByExternalId(writes, "5edca524cad2fa1125cb0631"),
    );
    expect(task.type).toBe("TASK");
    expect(task.status).toBe("IN_PROGRESS");
    expect(task.events).toBeUndefined();

    const bug = bodyOf(writeByExternalId(writes, "5edca524cad2fa1125cb0632"));
    expect(bug.type).toBe("BUG");
    expect(bug.status).toBe("DONE");
    expect(bug.completedAt).toBe("2020-03-04T03:03:19.000Z");
    expect(bug.events).toEqual([
      { toStatus: "DONE", occurredAt: "2020-03-04T03:03:19.000Z" },
    ]);
  });

  it("skips unknown types and records missing required fields", () => {
    const writes = writesFor(readFixture("pingcode-work-items.sample.json"));
    const ids = writes.map((write) => write.externalId);
    expect(ids).toEqual([
      "5edca524cad2fa1125cb0630",
      "5edca524cad2fa1125cb0631",
      "5edca524cad2fa1125cb0632",
    ]);
    // 未知 type.group=custom → 跳过，不硬塞 OTHER。
    expect(ids).not.toContain("5edca524cad2fa1125cb0633");
    // title 全空白 → 跳过。
    expect(ids).not.toContain("5edca524cad2fa1125cb0634");
    // 缺 project 引用 → 跳过。
    expect(ids).not.toContain("5edca524cad2fa1125cb0635");
  });

  it("skips an unrecognized state type instead of inventing a status", () => {
    const sample = readFixture("pingcode-work-items.sample.json");
    const values = sample.values as Array<Record<string, unknown>>;
    const record = {
      ...values[0]!,
      state: { id: "state-x", name: "未知状态", type: "archived" },
    };
    expect(target.normalize(record)).toEqual([]);
  });

  it("passes through UUID people and derives UUID-only contributions", () => {
    const writes = writesFor(
      readFixture("pingcode-work-items.uuid.sample.json"),
    );
    expect(writes).toHaveLength(1);
    const write = writes[0]!;
    const body = bodyOf(write);

    // 子任务没有独立枚举，按 TASK 计入。
    expect(body.type).toBe("TASK");
    expect(body.status).toBe("DONE");
    expect(body.assigneePersonId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(body.completedAt).toBe("2020-03-04T03:03:20.000Z");
    expect(body.events).toEqual([
      { toStatus: "DONE", occurredAt: "2020-03-04T03:03:20.000Z" },
    ]);
    // 负责人记 ASSIGNEE；participants 中仅 type=user 的 UUID 记 PARTICIPANT；
    // user_group 与他人的重复引用被跳过。
    expect(body.contributions).toEqual([
      {
        personId: "11111111-1111-4111-8111-111111111111",
        role: "ASSIGNEE",
      },
      {
        personId: "22222222-2222-4222-8222-222222222222",
        role: "PARTICIPANT",
      },
    ]);
  });
});
