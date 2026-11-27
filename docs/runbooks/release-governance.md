# 发布治理与供应链门禁（CI 供应链 / 发布）

> 适用范围：本仓库 GitHub 侧的 CI 供应链门禁、tag 发布路径、镜像签名与 SBOM 留存。
> 相关文件：
> - [`.github/workflows/security.yml`](../../.github/workflows/security.yml)（供应链门禁）
> - [`.github/workflows/release.yml`](../../.github/workflows/release.yml)（发布路径）
> - [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)（既有类型/测试/DB 门禁）
> - [`package.json`](../../package.json)（`npm run audit`）
>
> 部署步骤与运行时安全校验见 [`../operations/production-deployment.md`](../operations/production-deployment.md)，
> 密钥与威胁模型见 [`../security/key-management.md`](../security/key-management.md)、[`../security/threat-model.md`](../security/threat-model.md)。

## 1. 门禁分工（谁在哪里把关）

| 门禁 | 位置 | 触发 | 阻断条件 |
| --- | --- | --- | --- |
| 类型检查 `tsc --noEmit`（含 web） | `ci.yml` → `test` job | push / PR | 类型错误 |
| 单元测试 `npm test` | `ci.yml` → `test` job | push / PR | 任一测试失败 |
| 迁移不可变 / RLS 审计 | `ci.yml` → `test` job | push / PR | 历史迁移被改写、宽策略 |
| PG 集成 / 升级路径 | `ci.yml` → `test` job | push / PR | `test:pg` / `test:pg-upgrade` 失败 |
| 依赖漏洞审计 | `security.yml` → `dependency-audit` | push / PR / 每周一 03:17 UTC / 手动 | `npm audit --audit-level=high` 非零 |
| 锁文件完整性 | `security.yml` → `dependency-audit` | 同上 | lock 缺 integrity、workspace 缺失、`npm ci` 改写 lock |
| 门禁存在性断言 | `security.yml` → `ci-gate-coverage` | 同上 | `ci.yml` 不再运行 `npm run typecheck` / `npm test` |
| 镜像构建 + 漏洞扫描 | `security.yml` → `container-scan` | 同上 | Trivy 在 HIGH/CRITICAL（有修复版本）上非零 |
| 发布：SBOM + keyless 签名 | `release.yml` → `release` | push tag `v*.*.*` | 依赖审计失败、构建/签名/SBOM 失败 |

两个刻意的设计选择：

1. **不重复跑测试。** `security.yml` 不重跑 `npm test` / `npm run typecheck`：它们已在 `ci.yml` 里，重复执行只会翻倍消耗 runner 时间。
   为防止"测试门禁被静默删除而供应链 workflow 依旧绿"，`ci-gate-coverage` 用 grep 断言这两条命令仍存在于 `ci.yml`。
   若将来把测试迁到别处，请同步修改该断言（这是唯一的耦合点）。
2. **HIGH/CRITICAL 才阻断。** 依赖审计按 `--audit-level=high`（moderate 只记录不阻断）；镜像扫描 `severity=HIGH,CRITICAL` + `ignore-unfixed=true`
   —— "有修复版本才 fail"，避免上游尚未发补丁的 CVE 把所有 PR 长期卡红。两者的取舍都在 §8 有复审节奏。

## 2. 分支保护建议（main）

在 GitHub → Settings → Rules / Branches 为 `main` 建立规则集（免费功能，不需要 GHAS 或付费计划）：

| 规则 | 建议值 | 理由 |
| --- | --- | --- |
| Require a pull request before merging | ✅ 必须 | 禁止直推 main |
| Required approvals | 1（涉及资金/结算/迁移时 2） | 与 `AGENTS.md` 的金额路径要求一致 |
| Dismiss stale approvals when new commits are pushed | ✅ | 防止批准后被追加提交绕过 |
| Require review from Code Owners | 有 `CODEOWNERS` 时开启 | 当前仓库无该文件，属后续增强 |
| Require status checks to pass | ✅ `test`、`e2e`、`Dependency audit + lockfile integrity`、`Docker build + Trivy image scan`、`Typecheck/test gates still owned by ci.yml` | 这就是"门禁真的会挡人"的地方 |
| Require branches to be up to date before merging | ✅（合并队列可用时改用 Merge Queue） | 避免"各自绿、合起来红" |
| Require conversation resolution | ✅ | 未解决的 review 意见不得合并 |
| Require linear history | 建议 ✅ | 便于 `git bisect` 与回滚 |
| Require signed commits | 可选 | 有 GPG/SSH 签名习惯时开启 |
| Do not allow bypassing the above settings | ✅（含 administrators） | 否则规则只是装饰 |
| Block force pushes / Block deletions | ✅ | main 历史不可重写 |

Tag 保护：对 `v*` 建立 tag ruleset，仅 release manager（或 GitHub Actions bot）可创建 tag，
禁止更新/删除已有 tag。**已发布的 tag 视为不可变**：修复就发新 tag，不要移动旧 tag，
否则签名身份（`.../release.yml@refs/tags/vX.Y.Z`）与镜像 digest 的对应关系就被破坏。

> 注意：`release.yml` 目前不需要任何 environment/secret。若之后要加人工审批闸门，
> 建议加 `environment: release`（required reviewers），而不是引入新的 secret。

## 3. 镜像签名验证

发布产物：`ghcr.io/<owner>/<repo>:<version>`（另有 `:sha-<12 位 sha>`），
cosign keyless 签名凭证来自 GitHub OIDC（Fulcio 证书 + Rekor 透明日志），**没有长期私钥**。

### 3.1 验证镜像签名

```bash
IMAGE=ghcr.io/OWNER/REPO
TAG=v1.2.3            # 与 git tag 完全一致（含 v 前缀）
REPO=OWNER/REPO

cosign verify "$IMAGE:${TAG#v}" \
  --certificate-identity "https://github.com/${REPO}/.github/workflows/release.yml@refs/tags/${TAG}" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
```

- `--certificate-identity` 必须**精确匹配**签名时的工作流身份：换 tag、换分支、换 workflow 文件都会导致身份不同而验证失败（这是预期行为）。
- 也可用 `--certificate-identity-regexp "^https://github.com/${REPO}/.github/workflows/release.yml@refs/tags/v"` 放宽到"任意 tag 的 release.yml"，
  但**部署到生产时应使用精确身份**，并把 digest 固定进部署清单。

### 3.2 按 digest 部署（不要用可变 tag）

```bash
cosign verify "$IMAGE@sha256:<digest>" ...          # 同上参数
# 部署时固定 digest：
kubectl set image deploy/api api="$IMAGE@sha256:<digest>"
```

digest 记录在每次发布 artifact 的 `sbom/release-manifest.json` 里（字段 `digest`、`commit`、`tag`）。

### 3.3 验证镜像 SBOM attestation

```bash
cosign verify-attestation --type spdxjson "$IMAGE@sha256:<digest>" \
  --certificate-identity "https://github.com/${REPO}/.github/workflows/release.yml@refs/tags/${TAG}" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  | jq -r '.payload' | base64 -d | jq '.predicate.packages | length'
```

### 3.4 验证 SBOM 文件签名

```bash
gh run download <run-id> -n release-v1.2.3 -D evidence/
cd evidence
cosign verify-blob --bundle sbom/image.spdx.json.sigstore.json sbom/image.spdx.json \
  --certificate-identity "https://github.com/${REPO}/.github/workflows/release.yml@refs/tags/v1.2.3" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
sha256sum --check sbom/SHA256SUMS
```

## 4. SBOM 与证据留存

| 产物 | 生成方式 | 位置 | 留存 |
| --- | --- | --- | --- |
| `sbom/app-runtime.cdx.json` | `npm sbom --sbom-format=cyclonedx --omit=dev` | Actions artifact `release-<tag>` | 90 天（`retention-days: 90`） |
| `sbom/image.spdx.json` | `syft <image>@<digest> -o spdx-json` | 同上 | 90 天 |
| `*.sigstore.json` | `cosign sign-blob --bundle` | 同上 | 90 天 |
| `sbom/SHA256SUMS` | `sha256sum` | 同上 | 90 天 |
| `sbom/release-manifest.json` | 工作流生成（tag/commit/digest/各文件 sha256/签名身份） | 同上 | 90 天 |
| 镜像 attestation | `cosign attest --type spdxjson` | GHCR（随镜像，永久） | 与镜像同生命周期 |

- 合规或审计需要更长留存时，把 artifact 复制到对象存储/WORM 桶（与 [`audit-durability.md`](../operations/audit-durability.md) 的证据保留策略一致），
  并在发布记录里写明 bucket 前缀；artifact 默认 90 天到期**不会自动迁移**。
- `release-manifest.json` 是"哪次 CI、哪个 commit、哪个 digest、哪些 SBOM"的唯一索引，回滚和事故复盘先看它。
- Actions artifact 不是不可变存储，别把它当作唯一副本；镜像 attestation（随 digest）才是长期锚点。

## 5. 依赖升级策略

### 5.1 时限

| 级别 | 处置时限 | 动作 |
| --- | --- | --- |
| critical（有可用修复） | 72 小时内（已被利用则当天） | 立即 patch/minor 升级；必要时用 `overrides` 顶住 |
| high | 7 天 | 常规升级 PR，走完整门禁 |
| moderate | 下个迭代（≤ 30 天） | 与相关框架升级一起做 |
| low / 无修复 | 记录，季度复审 | 不阻断；在 §9 登记 |

### 5.2 流程

1. 每周一 03:17 UTC 的定时扫描 + Dependabot/Renovate 的周长会自动产出新发现；`npm run audit` 是本地同一口径。
2. **patch / minor**：合并成一个小批次 PR（一次 5–10 个），只跑定向测试 + 全量一次，不做"边改边全跑"。
3. **major**：单独 PR、单独 review，必须包含 `npm test`、`npm run typecheck`、`npm run test:pg`、`npm run test:pg-upgrade`；
   涉及 Zod / Fastify / vitest 这类契约与工具链依赖时，同时刷新 `docs/generated/request-contracts.json` 与 `db/migrations/manifest.json`。
4. **禁止**在 main 上直接 `npm audit fix --force`：它会强制跨 major 升级并可能改写 lockfile 之外的行为。
5. **lockfile**：安全升级可以提交"只动 lockfile"的 PR（`npm update <pkg> --package-lock-only`），但必须附上 audit 前后输出。
   除安全升级外，按 `AGENTS.md` 约定不改 lockfile。
6. **overrides 政策**：仅当上游尚未发版时使用；必须写清 advisory 编号、加入日期、复审日期，并在上游发版后移除。
7. **新依赖准入**：许可证（MIT/Apache-2.0/BSD）、近 12 个月有维护、无 `postinstall` 网络脚本、版本精确锁定；不引入付费依赖。
8. **基础镜像**：`node:22-alpine` 是浮动 tag，每月至少重建一次以吃进新的系统包；
   Trivy 报了 HIGH/CRITICAL 且修复版本已进入上游镜像时，7 天内重建。若修复需要改 Dockerfile（如升级 npm），
   按 §9 的补救方案走，**不要在 CI 里用 `--skip-dirs` 静默隐藏**。

### 5.3 GitHub Actions 版本

- GitHub 官方动作（`actions/*`）跟随主版本（与 `ci.yml` 一致：`checkout@v4`、`setup-node@v4`、`upload-artifact@v4`）。
- 第三方动作（docker / trivy / cosign / anchore）固定到**精确 tag**：`docker/setup-buildx-action@v4.4.1`、
  `aquasecurity/trivy-action@v0.36.0`、`sigstore/cosign-installer@v4.1.4`、`anchore/sbom-action/download-syft@v0.24.4`。
  原因：`cosign-installer` 不提供移动主版本 tag，浮动引用会直接解析失败；精确 tag 也缩小了被投毒替换的窗口。
- 季度复审一次版本；后续可升级为按 commit SHA 固定（Renovate/Dependabot 支持），这是比 tag 更强的供应链姿态。

## 6. 本地自检（与 CI 同口径）

```bash
npm run audit                                   # = npm audit --audit-level=high
npx tsc --noEmit                                # 与 ci.yml 的 typecheck 同口径（web 另跑 workspace typecheck）
npm test

docker build -t anari-incentive:local .         # Dockerfile 构建
trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --no-progress anari-incentive:local

# workflow 语法自检（本仓库未内置）。
#   - 推荐：brew install actionlint  或从 https://github.com/rhysd/actionlint/releases 下载二进制
#   - 注意 `npx actionlint` 不存在（actionlint 不是 npm 包）
actionlint .github/workflows/security.yml .github/workflows/release.yml

# 兜底：YAML 可解析性（仓库已有 yaml 依赖）
node --input-type=module -e '
import { readFileSync } from "node:fs";
import YAML from "yaml";
for (const f of [".github/workflows/security.yml", ".github/workflows/release.yml"]) {
  const d = YAML.parse(readFileSync(f, "utf8"));
  console.log(f, Object.keys(d.on), Object.keys(d.jobs));
}
'
```

`npm run audit` 在本地/CI 都是**退出码 1 = 阻断**。当前退出码见 §9。

## 7. 发布与回滚流程

**发布**：`git tag -s v1.2.3 && git push origin v1.2.3`（tag 推送后自动构建、生成 SBOM、签名、上传证据）。

**验证**：`release.yml` 的 job summary 里有 `digest`；artifact `release-v1.2.3` 里有 manifest 与签名。
发布单里登记 `tag / commit / digest / artifact run id`。

**回滚**：把部署清单里的 digest 指回上一个已验证的 `sha-<commit>` 或上一个 tag 的 digest；
不要"删 tag 重发同名 tag"（破坏签名身份与不可变承诺）。已在生产用过的 digest 必须留在 registry。

**应急**：若签名身份密钥（Fulcio 证书）或 GHCR 凭据被怀疑滥用，
可按 digest 拉取 `cosign verify` 失败证据，禁用对应 workflow、轮换 `GITHUB_TOKEN` 权限范围，
并把受影响的 digest 列入禁止部署清单；历史证据（artifact + Rekor 条目）保留不动。

## 8. 复审节奏

| 项 | 频率 | 负责人 |
| --- | --- | --- |
| 依赖漏洞（audit + 镜像扫描） | 每周（定时 workflow 自动）+ 每次 PR | 平台/后端 owner |
| 动作版本（Actions） | 每季度 | 平台 owner |
| 阈值策略（`ignore-unfixed`、moderate 是否升级为阻断） | 每季度 | 平台 + 安全 |
| 分支保护 / tag 规则是否仍生效 | 每季度（或组织权限调整后） | 仓库管理员 |
| SBOM 留存是否满足审计要求 | 每次审计前 | 合规/财务治理 |

## 9. 当前基线（2026-11-27 实测，未修完前本门禁会是红的）

> 本节是"诚实基线"：`security.yml` 的 `dependency-audit` 与 `container-scan` 在本仓库当前状态下**会失败**。
> 门禁本身按设计工作；下面是需要 owner 决策的既有问题，不是 workflow 语法问题。

### 9.1 `npm audit --audit-level=high` → 退出码 1（10 个漏洞：6 moderate / 2 high / 2 critical）

| 漏洞 | 位置 | 修复 | 备注 |
| --- | --- | --- | --- |
| `tinypool` critical（GHSA-5gmw-xhrv-c9v3、GHSA-85c8-ppgw-ccpr，原型污染 → RCE） | `vitest@2.x` 传递依赖 | `vitest@5.1.2`（major） | 只影响测试环境，但会阻断 `npm test` 链路 |
| `zod` < 4.6.6 high（GHSA-mrhx-c7xc-m3w5，超长集合校验内存耗尽） | `apps/api` / `packages/contracts` 直接依赖 `zod@3.25.76` | `zod@4.6.7`（major） | **生产依赖**；升级需同步校验 request contracts 与 `docs/openapi.yaml` |
| `vite` / `esbuild` / `@vitest/mocker` / `glob` / `minimatch` moderate | vitest、`@fastify/static` 传递依赖 | `npm audit fix`（部分）/ vitest 5 | 非阻断 |

仅生产依赖口径当前为 4 个（3 moderate + 1 high，即 zod）。修复路径建议：
`zod` 与 `vitest` 两个 major 各开一个独立 PR（见 §5.2），完成后本门禁自然转绿；期间不要用 `--audit-level=moderate` 之外的方式绕过。

### 9.2 Trivy 镜像扫描 → 退出码 1（10 个 HIGH，全部来自基础镜像内的 npm CLI 自带依赖）

本地实测（`node:22-alpine` 构建的镜像，`--ignore-unfixed`，Trivy 0.74.0）：

| CVE | 包（npm CLI 自带） | 修复版本 |
| --- | --- | --- |
| CVE-2026-102276 | `brace-expansion` | 5.0.10 / 3.0.7 / 2.1.5 / 1.1.19 |
| CVE-2026-69192 | `ip-address` | 10.3.1 |
| CVE-2026-9496 | `pacote` | 21.5.1 |
| CVE-2026-33671 | `picomatch` | 4.0.4 / 3.0.2 / 2.3.2 |
| CVE-2026-48815 | `sigstore` | 4.1.1 |

- **应用自身依赖与 OS 包当前无 HIGH/CRITICAL**：这 10 条全部落在 `Target: Node.js` 的 npm CLI 自带 `node_modules` 里
  （镜像 `CMD ["npm", "run", "start"]` 会执行 npm，所以不是纯噪音）。
- 补救方案 A（推荐，需改 Dockerfile，超出本次 CI 改动范围）：最终阶段加
  `RUN npm install -g npm@latest` 或升级基础镜像到 `node:24-alpine`，重建后复扫。
- 补救方案 B（需安全评审同意才可用）：在 `trivy-action` 加 `skip-dirs: usr/local/lib/node_modules/npm`，
  把基础镜像自带的 CLI 依赖移出评分范围，同时保留应用依赖与 OS 包扫描。
  **默认不这样做**，因为等于把可达组件移出门禁。
- 在上述任一方案落地前，`container-scan` 会对所有 PR 报红；请把它作为已知阻塞项排期，而不是关闭该 job。

## 10. 已知限制

- 本地验证只到"YAML 可解析 + actionlint(v1.7.12) 无告警 + 命令在同版本工具链上手跑"；
  真实 runner 行为需要首次 push 后确认（本机没有 GitHub runner）。
- `origin` 是 Gitee 镜像，**不执行**这些 workflow；门禁只对 `github` remote 生效。
- 未接入 GitHub Code Scanning（SARIF 上传）与 `CODEOWNERS`：前者对私有仓库需要 GHAS（付费），
  后者需要新增文件（超出本次改动范围）——两者都列入 §8 季度复审。
- 未做 SLSA provenance 的独立 attestation 存储：`buildx --provenance=mode=max` 的证明随镜像推送到 GHCR，
  未额外签名 provenance（如有需要，再加 `cosign attest --type slsaprovenance`）。
