# 2026 制度验收报告

生成时间：2026-11-09T13:18:01.417Z

| 编号 | 制度 | 场景 | 结果 | 实际值 |
| --- | --- | --- | --- | --- |
| M-001 | 017/018 月度绩效 | 任务闭环率：权重 2/3/1，三条中两条有效 | PASS | requiredWeight=6, qualifiedWeight=3, rate=50 |
| PERF-01 | 017/018 月度绩效 | 销售月度：M-001 95 / M-002 88 / M-003 +4 | PASS | finalScore=95.3, kp=0.953 |
| PERF-02 | 017/018 月度绩效 | 产品经理月度：考试 N/A，按 70/85 与 15/85 归一 | PASS | rawScore=86.2353, kp=0.8624, renormalized=true |
| PERF-03 | 017/018 月度绩效 | 基层月度绩效工资：30000 × 20% × Kp 0.953 | PASS | standard=6000, kp=0.953, payable=5718 |
| PERF-04 | 017/018 月度绩效 | 经理级月度绩效工资：40000 × 30% × Kp 0.8624 | PASS | standard=12000, kp=0.8624, payable=10348.24 |
| PERF-05 | 016 职能季度奖金 | 固定工资 12000，季度 S=118 → Kq 1.18 | PASS | base=1200, kq=1.18, amount=1416, eligible=true |
| PERF-06 | 016 职能季度奖金 | 季度 S=100 → 无奖金资格 | PASS | kq=1, amount=0, eligible=false |
| PERF-07 | 017 年度计分卡 | 108/112/96/120 加权 110.4，封顶 105 | PASS | companyScore=105, kp=1.05, profitTargetMet=true, poolRate=8 |
| PERF-08 | 016 年度利润分享 | P_y=1000 万、目标 800 万、8% 池；岗位价值点分配 | PASS | pool=800000, approved=800000, first=567741.94, second=232258.06, totalPoints=46500 |
| INC-01 | 016 DBCP | 毛利 200 万，费用/分摊/5% 管理计提后 DBCP 147 万 | PASS | provision=100000, dbcp=1470000 |
| INC-02 | 016 业务中心提成 | DBCP 147 万 / 净回款 500 万 = 29.4% → 3% 档 | PASS | margin=29.4, rate=3, commission=150000 |
| INC-03 | 016 执行总监补差 | DBCP 147 万 × 2% × K 0.92 − 营销 2 万 | PASS | k=0.92, gross=27048, supplement=7048 |
| INC-04 | 016 内部份额 | B=15 万、M=2 万、G=7048，剩余池按 60/40 | PASS | remaining=122952, first=73771.2, second=49180.8 |
| INC-05 | 016 悬赏 | 基础 2 万，延期 5 日 0.75，轻微缺陷 0.95，个人 80% | PASS | time=0.75, quality=0.95, amount=11400 |
| TECH-01 | 008 产品技术中心 | 发明专利授权 | PASS | amount=5000 |
| TECH-02 | 008 产品技术中心 | 客户定制项目费 20 万 × 30% | PASS | amount=60000 |
| TECH-03 | 008 产品技术中心 | 年度降本 300 万 × 1%，上限 1 万 | PASS | amount=10000 |
| TECH-04 | 008 产品技术中心 | 季度池：业务提成 15 万 × 19%，负责人 +0.1 | PASS | pool=28500, head=16108.7, pm=12391.3 |
| OVERSEAS-01 | 003 海外销售 | 开发明星 8 个达标新客户（首单/回款已核实），坏账损失 3000 扣 50% | PASS | gross=10000, deduction=1500, net=8500 |
| OVERSEAS-02 | 003 海外销售 | KA 首签且年度成交 1200 万 | PASS | gross=50000 |
| EQUITY-01 | 011 股权激励 | L1 / A 轮 / B 绩效 / A 轮加入 → 2.5% | PASS | base=2.5, grant=2.5, cap=10, within=true |
| EQUITY-02 | 011 股权激励 | L3 / B 轮 / A 绩效 / B 轮加入 → 0.184% | PASS | grant=0.184 |
| EQUITY-03 | 011 股权激励 | L3 Refresh：初始 0.2% × 20% × 1.15 | PASS | grant=0.046 |
| EQUITY-04 | 011 股权激励 | 10000 单位，30 个月归属 62.5% | PASS | percent=62.5, units=6250 |
| EQUITY-05 | 011 股权激励 | 24 个月双触发加速至 75% | PASS | percent=75, units=7500 |
| EQUITY-06 | 011 股权激励 | 被动离职回购：10 元 × 80% × 10000 | PASS | fair=8, price=80000, notice=30 |
| EQUITY-07 | 011 股权激励 | 未递延纳税：行权价 1、公允 5、1000 单位 | PASS | base=4000, tax=800 |
| EQUITY-08 | 011 股权激励 | 递延纳税：转让价 10、行权价 1、1000 单位 | PASS | base=9000, tax=1800 |
| EQUITY-09 | 011 股权激励 | Cap Table：累计 5.1%，池剩余 94.9% | PASS | total=5.1, remaining=94.9 |
| STAR-01 | 016 月明星 | 排名第一、总分 110、价值观 20、连续 3 个月 | PASS | awarded=true, amount=1000 |

合计 30 条，通过 30 条，失败 0 条。
