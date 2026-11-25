/**
 * ANARI CRM provider 的定向测试。
 *
 * 断言对象是**目标 API 真实接受的 body**：
 *   - packages/contracts/src/index.ts  importCommercialOpportunitySchema /
 *     importCommercialAccountSchema（required 字段、stage 五值枚举、currency 3 位、
 *     estimatedAmount 为十进制字符串、ownerPersonId 为 uuid）
 *   - apps/api/src/modules/commercial/commercial.routes.ts  两个 import 端点
 *   - packages/connectors/src/sync-runner.ts  COMMERCIAL_OPPORTUNITY 分支的同一套校验
 *
 * fixture 的**信封形状**照抄 anari-ai-crm 的列表响应（{ deals|companies|contacts, total }），
 * 标识符与公司名是脱敏的；金额按 Prisma.Decimal 的 JSON 形态写成字符串
 * （`new Prisma.Decimal("1250000.00")` → "1250000"，尾随零被去掉，见 crm-deals.page1.json）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CRM_ACCOUNT_PATH,
  CRM_OPPORTUNITY_PATH,
  CRM_OPPORTUNITY_STAGES,
  CRM_SOURCE_SYSTEM,
  crmCompanyTarget,
  crmContactTarget,
  crmDealTarget,
  crmProvider,
  mapCrmStageToOpportunityStage,
  normalizeCrmDeal,
  type CrmOpportunityStage,
} from "../crm.js";

const root = process.cwd();

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(root, "fixtures", "connectors", name), "utf8"),
  ) as Record<string, unknown>;
}

function records(target: typeof crmDealTarget, name: string): Record<string, unknown>[] {
  return target.extract(readFixture(name)) as Record<string, unknown>[];
}

const wonDeal = records(crmDealTarget, "crm-deals.page1.json")[0]!;
const secondDeal = records(crmDealTarget, "crm-deals.page1.json")[1]!;
const thirdDeal = records(crmDealTarget, "crm-deals.page1.json")[2]!;
const edgeDeals = records(crmDealTarget, "crm-deals.edge-cases.json");
const companies = records(crmCompanyTarget, "crm-companies.page1.json");
const contacts = records(crmContactTarget, "crm-contacts.page1.json");

/** 单条写入；normalize 允许多写，这里断言“恰好一条”。 */
function oneWrite(value: unknown): { path: string; body: Record<string, unknown>; externalId: string } {
  expect(Array.isArray(value)).toBe(true);
  const writes = value as Array<{ path: string; body: Record<string, unknown>; externalId: string }>;
  expect(writes).toHaveLength(1);
  return writes[0]!;
}

describe("crmProvider 身份", () => {
  it("声明 ANARI_CRM 来源与两个 env 名", () => {
    expect(crmProvider.code).toBe("anari-crm");
    expect(crmProvider.sourceSystem).toBe("ANARI_CRM");
    expect(crmProvider.sourceSystem).toBe(CRM_SOURCE_SYSTEM);
    expect(crmProvider.baseUrlEnv).toBe("ANARI_CRM_BASE_URL");
    expect(crmProvider.tokenEnv).toBe("ANARI_CRM_TOKEN");
  });

  it("三个 target 都指向 CRM 真实的列表路由（GET，只读）", () => {
    expect(crmProvider.targets.map((target) => target.path)).toEqual([
      "/api/deals",
      "/api/companies",
      "/api/contacts",
    ]);
    for (const target of crmProvider.targets) {
      expect(target.method).toBe("GET");
    }
  });
});

describe("deal target 对齐 /api/deals", () => {
  it("offset 分页：pageParam=offset、limit=limit、pageSize 50（接口默认 50、上限 100）", () => {
    expect(crmDealTarget.pageParam).toBe("offset");
    expect(crmDealTarget.limitParam).toBe("limit");
    expect(crmDealTarget.pageSize).toBe(50);
  });

  it("从 { deals, total } 信封里取记录，而不是把响应当数组", () => {
    const payload = readFixture("crm-deals.page1.json");
    expect(payload.total).toBe(3);
    expect(records(crmDealTarget, "crm-deals.page1.json")).toHaveLength(3);
  });
});

describe("deal → /api/v1/commercial/import/opportunities", () => {
  it("映射出一条 body，字段名与契约逐个对齐", () => {
    const write = oneWrite(normalizeCrmDeal(wonDeal));
    expect(write.path).toBe(CRM_OPPORTUNITY_PATH);
    expect(write.externalId).toBe("cmq4td1a9000f4bxr2m8kq3vz");
    expect(write.body).toEqual({
      sourceSystem: "ANARI_CRM",
      externalAccountId: "cmq4te5b7000g4bxr3n2w8qyl",
      accountName: "Northwind Motors",
      externalOpportunityId: "cmq4td1a9000f4bxr2m8kq3vz",
      name: "Northwind Charging Station Phase 2",
      stage: "WON",
      estimatedAmount: "1250000",
      currency: "CNY",
    });
  });

  it("金额是 Decimal 字符串直通，不做 Number 往返", () => {
    const write = oneWrite(normalizeCrmDeal(wonDeal));
    // fixture 里是 "1250000"（Prisma.Decimal 的 JSON 形态，尾随零已被去掉）。
    expect(typeof write.body.estimatedAmount).toBe("string");
    expect(write.body.estimatedAmount).toBe("1250000");

    const decimalDeal = oneWrite(normalizeCrmDeal(secondDeal));
    expect(decimalDeal.body.estimatedAmount).toBe("187500.5");
    expect(typeof decimalDeal.body.estimatedAmount).toBe("string");
  });

  it("无金额时省略 estimatedAmount，而不是写 0", () => {
    const write = oneWrite(normalizeCrmDeal(thirdDeal));
    expect(write.body).not.toHaveProperty("estimatedAmount");
    expect(write.body.stage).toBe("PROSPECT");
  });

  it("owner 只写 UUID；CRM 的 cuid 用户 id 一律不写", () => {
    // 第一条 deal 的 owner.id 是 cuid（cmq…）
    expect(oneWrite(normalizeCrmDeal(wonDeal)).body).not.toHaveProperty(
      "ownerPersonId",
    );
    // 第二条是 UUID 形态 → 写
    expect(oneWrite(normalizeCrmDeal(secondDeal)).body.ownerPersonId).toBe(
      "9f1b2c3d-4e5f-4a6b-8c7d-1e2f3a4b5c6d",
    );
  });

  it("stage 有损映射后仍能落到 Negotiation→PROPOSAL", () => {
    const write = oneWrite(normalizeCrmDeal(secondDeal));
    expect(write.body.stage).toBe("PROPOSAL");
    expect(write.body.currency).toBe("USD");
  });

  it("每条 body 都满足目标契约：币种 3 位、金额十进制、stage 在枚举内、无额外字段", () => {
    const allowedKeys = [
      "sourceSystem",
      "externalAccountId",
      "accountName",
      "externalOpportunityId",
      "name",
      "stage",
      "estimatedAmount",
      "currency",
      "ownerPersonId",
    ];
    for (const deal of [wonDeal, secondDeal, thirdDeal, ...edgeDeals]) {
      for (const write of normalizeCrmDeal(deal)) {
        for (const key of Object.keys(write.body)) {
          expect(allowedKeys).toContain(key);
        }
        expect(write.body.sourceSystem).toBe("ANARI_CRM");
        expect(write.body.currency).toMatch(/^[A-Z]{3}$/);
        expect(write.body.externalAccountId).toBeTruthy();
        expect(write.body.accountName).toBeTruthy();
        expect(write.body.externalOpportunityId).toBeTruthy();
        expect(write.body.name).toBeTruthy();
        if ("stage" in write.body) {
          expect(CRM_OPPORTUNITY_STAGES).toContain(
            write.body.stage as CrmOpportunityStage,
          );
        }
        if ("estimatedAmount" in write.body) {
          expect(String(write.body.estimatedAmount)).toMatch(/^-?\d+(\.\d+)?$/);
        }
      }
    }
  });
});

describe("stage 映射（CRM 7 个默认阶段 → N-Perform 5 个枚举）", () => {
  const table: Array<[string, CrmOpportunityStage]> = [
    ["Lead", "PROSPECT"],
    ["Qualified", "QUALIFIED"],
    ["Proposal", "PROPOSAL"],
    ["Negotiation", "PROPOSAL"],
    ["Contract Review", "PROPOSAL"],
    ["Closed Won", "WON"],
    ["Closed Lost", "LOST"],
  ];

  it.each(table)("%s → %s", (name, expected) => {
    expect(mapCrmStageToOpportunityStage({ name, isWon: false, isLost: false })).toBe(
      expected,
    );
  });

  it("isWon / isLost 优先于阶段名（改名不改变输赢方向）", () => {
    expect(
      mapCrmStageToOpportunityStage({ name: "Proposal", isWon: true, isLost: false }),
    ).toBe("WON");
    expect(
      mapCrmStageToOpportunityStage({
        name: "Contract Review",
        isWon: false,
        isLost: true,
      }),
    ).toBe("LOST");
  });

  it("阶段名归一化：大小写、下划线、连字符、多余空格等价", () => {
    expect(mapCrmStageToOpportunityStage("closed_won")).toBe("WON");
    expect(mapCrmStageToOpportunityStage("Closed-Lost")).toBe("LOST");
    expect(mapCrmStageToOpportunityStage("  qualified  ")).toBe("QUALIFIED");
  });

  it("未知/自定义阶段 → undefined（省略 stage，不伪造 QUALIFIED）", () => {
    expect(mapCrmStageToOpportunityStage({ name: "Legal Hold" })).toBeUndefined();
    expect(mapCrmStageToOpportunityStage({ name: "法务审核" })).toBeUndefined();
    expect(mapCrmStageToOpportunityStage({ id: "stage-1" })).toBeUndefined();
    expect(mapCrmStageToOpportunityStage(null)).toBeUndefined();
    expect(mapCrmStageToOpportunityStage(undefined)).toBeUndefined();
    expect(mapCrmStageToOpportunityStage(42)).toBeUndefined();
  });

  it("未知阶段仍写 opportunity，只是不带 stage 字段", () => {
    const custom = edgeDeals.find((deal) => deal.name === "Custom Stage Deal")!;
    const write = oneWrite(normalizeCrmDeal(custom));
    expect(write.body).not.toHaveProperty("stage");
    expect(write.body.externalOpportunityId).toBe("cmq4u4d5e000t4bxr2f4h6ikb");
  });
});

describe("跳过无法被目标 API 接受的 deal", () => {
  it("缺 company 名称（company 投影漂移、只剩 companyId）→ 跳过", () => {
    const drifted = edgeDeals.find((deal) => deal.name === "Drifted Projection Deal")!;
    expect(drifted.companyId).toBe("cmq4u3c4d000s4bxr1e3g5hja");
    expect(normalizeCrmDeal(drifted)).toEqual([]);
  });

  it("缺币种 → 跳过（不猜币种，猜错币种等于错账）", () => {
    const missingCurrency = edgeDeals.find(
      (deal) => deal.name === "Missing Currency Deal",
    )!;
    expect(normalizeCrmDeal(missingCurrency)).toEqual([]);
  });

  it("金额是不可解析的字符串 → 仍写记录，但不写 estimatedAmount", () => {
    const malformed = edgeDeals.find((deal) => deal.name === "Malformed Amount Deal")!;
    const write = oneWrite(normalizeCrmDeal(malformed));
    expect(write.body).not.toHaveProperty("estimatedAmount");
    expect(write.body.stage).toBe("LOST");
  });

  it("金额被上游序列化成数字时转成十进制字符串（并确认 98765.43 不丢精度）", () => {
    const numeric = edgeDeals.find((deal) => deal.name === "Numeric Amount Deal")!;
    const write = oneWrite(normalizeCrmDeal(numeric));
    expect(write.body.estimatedAmount).toBe("98765.43");
    expect(write.body.currency).toBe("USD"); // "usd" → 大写
    expect(write.body.stage).toBe("WON"); // "closed_won" + isWon
    expect(write.body.ownerPersonId).toBe("9f1b2c3d-4e5f-4a6b-8c7d-1e2f3a4b5c6d");
  });

  it("非对象记录 → []", () => {
    expect(normalizeCrmDeal(null)).toEqual([]);
    expect(normalizeCrmDeal("deal")).toEqual([]);
    expect(normalizeCrmDeal([])).toEqual([]);
  });
});

describe("company target 对齐 /api/companies", () => {
  it("从 { companies, total, enriched, totalContacts } 信封里取记录", () => {
    const payload = readFixture("crm-companies.page1.json");
    expect(payload.total).toBe(3);
    expect(payload.enriched).toBe(1);
    expect(companies).toHaveLength(3);
    expect(crmCompanyTarget.path).toBe("/api/companies");
  });

  it("映射成 account body：只写契约字段，industry/domain 不塞进去", () => {
    const write = oneWrite(crmCompanyTarget.normalize(companies[0]));
    expect(write.path).toBe(CRM_ACCOUNT_PATH);
    expect(write.externalId).toBe("cmq4te5b7000g4bxr3n2w8qyl");
    expect(write.body).toEqual({
      sourceSystem: "ANARI_CRM",
      externalAccountId: "cmq4te5b7000g4bxr3n2w8qyl",
      name: "Northwind Motors",
      ownerPersonId: "9f1b2c3d-4e5f-4a6b-8c7d-1e2f3a4b5c6d",
    });
  });

  it("owner 是 cuid / 为 null 时不写 ownerPersonId", () => {
    expect(oneWrite(crmCompanyTarget.normalize(companies[1])).body).toEqual({
      sourceSystem: "ANARI_CRM",
      externalAccountId: "cmq4tm1p0000l4bxr3x5z7acs",
      name: "Globex Energy",
    });
    expect(oneWrite(crmCompanyTarget.normalize(companies[2])).body).toEqual({
      sourceSystem: "ANARI_CRM",
      externalAccountId: "cmq4tr5tc000p4bxr7b9d2egw",
      name: "Initech Charging",
    });
  });

  it("缺 id 或 name（含纯空白）→ 跳过", () => {
    expect(crmCompanyTarget.normalize({ id: "cmq4", name: "" })).toEqual([]);
    expect(crmCompanyTarget.normalize({ id: "cmq4", name: "   " })).toEqual([]);
    expect(crmCompanyTarget.normalize({ id: "", name: "Acme" })).toEqual([]);
  });
});

describe("contact target：只提取不写", () => {
  it("从 { contacts, total, withEmail, highEngagement } 信封里取记录", () => {
    expect(readFixture("crm-contacts.page1.json").total).toBe(2);
    expect(contacts).toHaveLength(2);
  });

  it("没有联系人导入端点 → normalize 恒为 []（不把联系人写成 account）", () => {
    // 目标端点只有 /import/accounts 与 /import/opportunities；把联系人当 account
    // 写会把一个人的名字变成一家公司，污染客户主数据。
    for (const contact of contacts) {
      expect(crmContactTarget.normalize(contact)).toEqual([]);
    }
  });
});

describe("信封形状漂移时抛错，而不是静默 0 条", () => {
  it("鉴权失败响应 { error } 不会被当成空页", () => {
    expect(() => crmDealTarget.extract({ error: "Unauthorized" })).toThrow(
      /\/api\/deals/,
    );
    expect(() => crmCompanyTarget.extract({ data: [] })).toThrow(/\/api\/companies/);
  });

  it("非对象响应直接抛错", () => {
    expect(() => crmDealTarget.extract(null)).toThrow(/expected a JSON object/);
    expect(() => crmDealTarget.extract([])).toThrow(/expected a JSON object/);
  });

  it("合法空页返回 []", () => {
    expect(crmDealTarget.extract({ deals: [], total: 0 })).toEqual([]);
  });
});
