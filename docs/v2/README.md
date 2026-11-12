# N-Perform V2 重构与升级任务包

**基线代码**：`anari-incentive-main.zip`，仓库内文件时间戳为 2026-11-10；ZIP 内版本标识/提交线索：`7bd8061db872cbe8b7d0c08da6f125b694deaa5a`。  
**产品基线**：仓库内 `docs/PRD_V4.1_#U8bc4#U5ba1#U4fee#U8ba2#U7248.md`，上游 PRD V4.0、架构技术设计 V1.0、数据库/API 契约 V1.0。  
**本交付性质**：基于静态源码检查形成的工程整改蓝图和任务包，不是已实施的代码补丁，也不代表本轮构建、测试、数据库迁移或安全渗透已通过。

## 文件清单

- `N_Perform_V2_Engineering_Blueprint.docx`：正式工程升级蓝图，供负责人评审和任务拆解。
- `V2_ENGINEERING_BLUEPRINT.md`：可在 Git 中持续维护的同内容 Markdown 版。
- `CODE_REVIEW_FINDINGS.md`：源码证据、文件位置、风险与整改方向。
- `FILE_REFACTOR_MAP.md`：从当前大文件到目标领域模块的拆分映射。
- `AI_SCORING_REDESIGN.md`：证据覆盖、证据可信度、贡献评估、绩效评价分层设计。
- `AGENT_RUNTIME_V2.md`：主动式 Agent Runtime 的执行、恢复、权限和验收要求。
- `SECURITY_HARDENING.md`：多租户、操作者身份、账本、任务执行安全门槛。
- `FRONTEND_WORKSPACE_V2.md`：前端角色工作空间和页面拆分方案。
- `TEST_ACCEPTANCE_MATRIX.md`：领域不变量、AI、Agent、安全、E2E 验收矩阵。
- `PRD_DECISIONS_TO_FREEZE.md`：进入开发前必须关闭的 PRD/架构决策。
- `TASK_BACKLOG.csv`：可以导入项目管理工具的任务清单，包含优先级、依赖、文件位置和验收标准。

## 执行原则

1. 先冻结规则与边界，再重构结构；不以重写技术栈代替架构治理。
2. 保留已有领域能力和迁移历史，不进行一次性推倒重来。
3. 每次拆分保持 API 行为兼容，并由回归测试证明等价。
4. AI 建议、人工决定、确定性计算、账本写入必须是不同的权限和状态边界。
5. 真实业务先做影子周期；未达到验收条件，不开启具有实际付款/薪酬效力的正式结算。
6. P0 的安全、金额、身份和证据语义问题先于 UI 美化和新增功能。

## 本轮未做的验证

本轮形成的是静态代码审查和重构方案。没有宣称 npm 构建、Vitest、Playwright、PostgreSQL 迁移、RLS 穿透、负载测试或第三方安全测试已通过。执行团队必须按验收矩阵逐项运行并保存 CI 产物。
