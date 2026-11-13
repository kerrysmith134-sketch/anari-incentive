/**
 * 认证与身份域路由（注册/密码登录/飞书登录/设密/我的订阅/身份）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { PlatformStore } from "../../platform-store.js";
import { ConflictError } from "../../store.js";
import { ForbiddenError } from "@anari/auth";
import {
  passwordLoginSchema,
  publicSignupSchema,
  setPasswordSchema,
} from "@anari/contracts";
import { randomUUID } from "node:crypto";
import { SessionJwt } from "@anari/auth";
import { seatsRemainingFor, syncFeishuDirectory } from "../../feishu-sync.js";
import { hashPassword, verifyPassword } from "../../password.js";
import {
  data,
  errorBody,
  parse,
  tenantOf,
  isPlatformAdmin,
  requireTenantAdmin,
} from "../../http-helpers.js";

export function registerAuthRoutes(deps: {
  platformStore: PlatformStore;
  countEvent: (event: string) => void;
  sessionSecretOption?: string;
  publicSignup?: boolean;
  feishu?: {
    appId: string;
    appSecret: string;
    sessionSecret: string;
    tenantId: string;
    consoleBaseUrl?: string;
    fetchImpl?: typeof fetch;
  };
}): FastifyPluginAsync {
  const { platformStore, countEvent, sessionSecretOption, feishu, publicSignup } = deps;
  return async (app: FastifyInstance) => {
  const slugify = (input: string): string =>
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "tenant";

  const signupAttempts = new Map<string, { count: number; resetAt: number }>();
  const publicSignupLimiter = {
    check(ip: string): boolean {
      const nowMs = Date.now();
      const entry = signupAttempts.get(ip);
      if (!entry || entry.resetAt <= nowMs) {
        signupAttempts.set(ip, { count: 1, resetAt: nowMs + 60 * 60 * 1000 });
        return true;
      }
      entry.count += 1;
      return entry.count <= 10;
    },
  };

  app.post("/api/v1/public/signup", async (request, reply) => {
    if (publicSignup === false) {
      return reply.status(404).send({
        ...errorBody("NOT_FOUND", "self-service signup is disabled"),
        meta: { correlation_id: request.id },
      });
    }
    if (!publicSignupLimiter.check(request.ip)) {
      return reply.status(429).send({
        ...errorBody("RATE_LIMITED", "too many signup attempts"),
        meta: { correlation_id: request.id },
      });
    }
    const body = parse(publicSignupSchema, request.body);
    // Signing up with an address that already has an account must never touch
    // that account: otherwise anyone could reset a stranger's password.
    const existingUser =
      (await platformStore.findUserByAuthSubject(body.adminEmail)) ??
      (await platformStore.getUserPasswordHashByEmail(body.adminEmail)
        ? { id: "existing" }
        : null);
    if (existingUser) {
      throw new ConflictError(
        "EMAIL_ALREADY_REGISTERED: this email already has an account; sign in and create a workspace from there",
      );
    }
    const tenant = await platformStore.createTenant({
      name: body.companyName,
      slug: body.slug ?? slugify(body.companyName),
    });
    const user = await platformStore.createUser({
      authSubject: body.adminEmail,
      displayName: body.adminDisplayName,
      email: body.adminEmail,
    });
    if (body.password) {
      await platformStore.setUserPassword(user.id, hashPassword(body.password));
    }
    await platformStore.addMembership({
      tenantId: tenant.id,
      userId: user.id,
      roleCodes: ["admin"],
    });
    const person = await platformStore.createPerson({
      tenantId: tenant.id,
      employeeCode: "ADMIN-001",
      displayName: body.adminDisplayName,
      userId: user.id,
    });
    let subscription = null;
    if (body.planCode) {
      const plans = await platformStore.listSubscriptionPlans(true);
      const plan = plans.find((candidate) => candidate.code === body.planCode);
      if (plan) {
        const startedAt = new Date();
        const periodEnd = new Date(
          startedAt.getTime() + plan.trialDays * 24 * 60 * 60 * 1000,
        );
        subscription = await platformStore.setTenantSubscription({
          tenantId: tenant.id,
          planCode: plan.code,
          status: plan.trialDays > 0 ? "TRIALING" : "ACTIVE",
          seats: plan.seatLimit > 0 ? plan.seatLimit : 1,
          currentPeriodStart: startedAt.toISOString(),
          currentPeriodEnd: periodEnd.toISOString(),
          trialEndsAt:
            plan.trialDays > 0 ? periodEnd.toISOString() : undefined,
        });
      }
    }
    countEvent("tenant_signed_up");
    return reply.status(201).send(
      data(
        {
          tenantId: tenant.id,
          slug: tenant.slug,
          userId: user.id,
          personId: person.id,
          subscription,
          nextSteps:
            "Sign in with your identity provider using the admin email as the auth subject, then complete onboarding in the console.",
        },
        request,
      ),
    );
  });

  // -------------------------------------------------------------------------
  // Feishu OAuth sign-in (browser flow; one-time state, human-readable errors)
  // -------------------------------------------------------------------------
  const feishuStates = new Map<
    string,
    { expiresAt: number; postLoginPath: string }
  >();

  const feishuRedirectBase = (request: FastifyRequest): string =>
    feishu?.consoleBaseUrl ??
    `${request.protocol}://${request.headers.host ?? "localhost:3000"}`;

  const sessionSecret = sessionSecretOption ?? feishu?.sessionSecret;
  const loginAttempts = new Map<string, { count: number; resetAt: number }>();
  app.post("/api/v1/auth/password/login", async (request, reply) => {
    if (!sessionSecret) {
      return reply.status(501).send({
        ...errorBody(
          "PASSWORD_LOGIN_NOT_CONFIGURED",
          "账号登录未启用：需要配置 SESSION_SECRET（服务端环境变量）",
        ),
        meta: { correlation_id: request.id },
      });
    }
    const body = parse(passwordLoginSchema, request.body);
    const key = request.ip;
    const nowMs = Date.now();
    const entry = loginAttempts.get(key);
    if (entry && entry.resetAt > nowMs && entry.count > 10) {
      return reply.status(429).send({
        ...errorBody("RATE_LIMITED", "尝试次数过多，请稍后再试"),
        meta: { correlation_id: request.id },
      });
    }
    // Only failed credentials count towards the limit. Counting every attempt
    // locked out offices behind one NAT after eleven successful sign-ins.
    const recordFailure = () => {
      const current = loginAttempts.get(key);
      const stamp = Date.now();
      const stillCounting = Boolean(current && current.resetAt > stamp);
      loginAttempts.set(key, {
        count: (stillCounting ? current!.count : 0) + 1,
        resetAt: stillCounting ? current!.resetAt : stamp + 900_000,
      });
    };
    const credential = await platformStore.getUserPasswordHashByEmail(
      body.email,
    );
    const stored = credential?.passwordHash;
    if (!credential || !stored || !verifyPassword(body.password, stored)) {
      recordFailure();
      // Uniform response: never reveal whether the account exists.
      return reply.status(401).send({
        ...errorBody("INVALID_CREDENTIALS", "邮箱或密码不正确"),
        meta: { correlation_id: request.id },
      });
    }
    loginAttempts.delete(key);
    const memberships = await platformStore.listMembershipsByUser(
      credential.userId,
    );
    const membership = body.tenantId
      ? memberships.find((candidate) => candidate.tenantId === body.tenantId)
      : memberships[0];
    if (!membership) {
      return reply.status(403).send({
        ...errorBody("NO_TENANT_MEMBERSHIP", "该账号尚未加入任何企业工作区，请联系管理员"),
        meta: { correlation_id: request.id },
      });
    }
    const jwt = new SessionJwt(sessionSecret);
    let personId: string | undefined;
    let roles = membership.roleCodes;
    try {
      const identity = await platformStore.resolveIdentity({
        tenantId: membership.tenantId,
        userId: credential.userId,
      });
      personId = identity.personId;
      roles = identity.roles.length > 0 ? identity.roles : roles;
    } catch {
      personId = undefined;
    }
    const token = await jwt.sign({
      tenantId: membership.tenantId,
      userId: credential.userId,
      personId,
      roles,
    });
    countEvent("password_login_completed");
    return data(
      {
        token,
        tenantId: membership.tenantId,
        userId: credential.userId,
        personId: personId ?? null,
        roles,
      },
      request,
    );
  });

  app.post("/api/v1/platform/users/set-password", async (request) => {
    if (!sessionSecret) {
      throw new ConflictError(
        "PASSWORD_LOGIN_NOT_CONFIGURED: set SESSION_SECRET to enable password login",
      );
    }
    const body = parse(setPasswordSchema, request.body);
    if (!isPlatformAdmin(request)) {
      // A tenant admin may only reset users who belong to their own tenant.
      requireTenantAdmin(request, tenantOf(request));
      const memberships = await platformStore.listMembershipsByUser(
        body.userId,
      );
      if (
        !memberships.some(
          (membership) => membership.tenantId === tenantOf(request),
        )
      ) {
        throw new ForbiddenError(
          "cannot set a password for a user outside this tenant",
        );
      }
    }
    await platformStore.setUserPassword(body.userId, hashPassword(body.password));
    countEvent("password_set");
    return data({ ok: true }, request);
  });

  app.get("/api/v1/auth/feishu/authorize", async (request, reply) => {
    if (!feishu) {
      return reply.status(501).send({
        ...errorBody(
          "FEISHU_NOT_CONFIGURED",
          "Feishu sign-in is not configured on this deployment (FEISHU_APP_ID/FEISHU_APP_SECRET/FEISHU_SESSION_SECRET). Contact the operator or sign in with a token.",
        ),
        meta: { correlation_id: request.id },
      });
    }
    const query = request.query as { postLoginPath?: string };
    const postLoginPath =
      query.postLoginPath?.startsWith("/console") ? query.postLoginPath : "/console";
    const state = randomUUID();
    // One-time state with a 300s TTL (replay/binding protection).
    feishuStates.set(state, {
      expiresAt: Date.now() + 300_000,
      postLoginPath,
    });
    for (const [key, entry] of feishuStates) {
      if (entry.expiresAt <= Date.now()) feishuStates.delete(key);
    }
    const redirectUri = `${feishuRedirectBase(request)}/api/v1/auth/feishu/callback`;
    const authorizeUrl = new URL(
      "https://open.feishu.cn/open-apis/authen/v1/authorize",
    );
    authorizeUrl.searchParams.set("client_id", feishu.appId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("state", state);
    return reply.redirect(authorizeUrl.toString());
  });

  app.get("/api/v1/auth/feishu/callback", async (request, reply) => {
    const feishuLoginError = (reason: string) => {
      const base = feishuRedirectBase(request);
      return reply.redirect(
        `${base}/console/login?error=${encodeURIComponent(reason)}`,
      );
    };
    if (!feishu) return feishuLoginError("Feishu sign-in is not configured");
    const query = request.query as {
      code?: string;
      state?: string;
      error?: string;
    };
    if (query.error) return feishuLoginError(`Feishu rejected the sign-in: ${query.error}`);
    if (!query.code || !query.state) {
      return feishuLoginError("The callback is missing code/state");
    }
    const stateEntry = feishuStates.get(query.state);
    feishuStates.delete(query.state);
    if (!stateEntry || stateEntry.expiresAt <= Date.now()) {
      return feishuLoginError(
        "The login state is invalid or expired; please start the sign-in again",
      );
    }
    const fetchImpl = feishu.fetchImpl ?? fetch;
    const redirectUri = `${feishuRedirectBase(request)}/api/v1/auth/feishu/callback`;
    try {
      // OAuth v2: flat client_id/secret, flat access_token response.
      const tokenResponse = await fetchImpl(
        "https://open.feishu.cn/open-apis/authen/v2/oauth/token",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            grant_type: "authorization_code",
            client_id: feishu.appId,
            client_secret: feishu.appSecret,
            code: query.code,
            redirect_uri: redirectUri,
          }),
        },
      );
      const tokenPayload = (await tokenResponse.json()) as {
        code?: number;
        msg?: string;
        data?: { access_token?: string };
      };
      const accessToken = tokenPayload.data?.access_token;
      if (!accessToken) {
        return feishuLoginError(
          `Could not exchange the Feishu code (${tokenPayload.code ?? tokenResponse.status}: ${tokenPayload.msg ?? "no access token"})`,
        );
      }
      // user_info MUST use the user token (tenant token returns the app itself).
      const userResponse = await fetchImpl(
        "https://open.feishu.cn/open-apis/authen/v1/user_info",
        { headers: { authorization: `Bearer ${accessToken}` } },
      );
      const userPayload = (await userResponse.json()) as {
        code?: number;
        msg?: string;
        data?: {
          open_id?: string;
          union_id?: string;
          name?: string;
          email?: string;
        };
      };
      const profile = userPayload.data;
      if (userPayload.code !== 0 || !profile?.open_id) {
        return feishuLoginError(
          `Could not read the Feishu profile (${userPayload.code ?? userResponse.status}: ${userPayload.msg ?? "no open_id"})`,
        );
      }

      // Resolve or provision the identity. First sign-in creates a basic
      // employee account only; elevated roles are always granted by an admin.
      const authSubject = `feishu:${profile.open_id}`;
      const tenantId = feishu.tenantId;
      const users = await platformStore.listUsers();
      let user = users.find((candidate) => candidate.authSubject === authSubject);
      if (!user) {
        user = await platformStore.createUser({
          authSubject,
          displayName: profile.name ?? profile.open_id,
          email: profile.email,
        });
        await platformStore.addMembership({
          tenantId,
          userId: user.id,
          roleCodes: ["employee"],
        });
      }
      const memberships = await platformStore.listMemberships(tenantId);
      const roles = memberships
        .filter((membership) => membership.userId === user.id)
        .flatMap((membership) => membership.roleCodes);
      let personId: string | undefined;
      try {
        const identity = await platformStore.resolveIdentity({
          tenantId,
          userId: user.id,
        });
        personId = identity.personId;
      } catch {
        personId = undefined;
      }
      if (!personId) {
        // 自动建号受订阅席位硬约束（与目录同步同一口径）。
        const seatsRemaining = await seatsRemainingFor(platformStore, tenantId);
        if (seatsRemaining !== null && seatsRemaining <= 0) {
          return feishuLoginError(
            "订阅席位已满：请联系管理员扩容或在平台管理中调整席位后再试",
          );
        }
        const person = await platformStore.createPerson({
          tenantId,
          employeeCode: `FS-${profile.open_id.replace(/-/g, "").slice(-8)}`,
          displayName: profile.name ?? profile.open_id,
          userId: user.id,
        });
        personId = person.id;
      }

      const jwt = new SessionJwt(feishu.sessionSecret);
      const token = await jwt.sign({ tenantId, userId: user.id, personId, roles });
      countEvent("feishu_login_completed");
      // 登录即同步：把本人的部门/汇报线落到组织树（best-effort，不阻塞登录）。
      // feishu-integration skill：组织事实只进目录字段，不碰角色/权限。
      if (process.env.FEISHU_LOGIN_SYNC !== "0") {
        void syncFeishuDirectory(platformStore, {
          tenantId,
          appId: feishu.appId,
          appSecret: feishu.appSecret,
          dryRun: false,
          allowCreate: true,
        }).catch((syncError: unknown) => {
          request.log.warn(
            { err: syncError },
            "post-login feishu directory sync failed",
          );
        });
      }
      const base = feishuRedirectBase(request);
      return reply.redirect(
        `${base}/console/login#feishu-token=${token}&postLoginPath=${encodeURIComponent(stateEntry.postLoginPath)}`,
      );
    } catch (error) {
      request.log.warn(
        { err: error },
        "feishu oauth callback failed",
      );
      return feishuLoginError(
        error instanceof Error
          ? `Sign-in failed: ${error.message}`
          : "Sign-in failed for an unknown reason",
      );
    }
  });
  app.get("/api/v1/me/subscription", async (request, reply) => {
    const subscription = await platformStore.getTenantSubscription(
      tenantOf(request),
    );
    if (!subscription) {
      return reply.status(404).send({
        ...errorBody("NOT_FOUND", "no subscription for this tenant"),
        meta: { correlation_id: request.id },
      });
    }
    return data(subscription, request);
  });

  app.get("/api/v1/me/invoices", async (request) => {
    return data(await platformStore.listInvoices(tenantOf(request)), request);
  });
  app.get("/api/v1/platform/identity", async (request) => {
    const context = request.authContext;
    if (!context) {
      throw new ForbiddenError("authentication is required");
    }
    const identity = await platformStore.resolveIdentity({
      tenantId: context.tenantId,
      userId: context.userId,
      personId: context.personId,
    });
    // Session tokens and the dev authenticator carry authoritative roles. When
    // membership lookup returns none, fall back to the authenticated roles so
    // the console does not treat a signed-in operator as role-less.
    const roles =
      identity.roles.length > 0 ? identity.roles : context.roles;
    return data(
      {
        ...identity,
        roles,
        // 前端会话只需 token；tenantId 由服务端回填，禁止客户端自报。
        tenantId: context.tenantId,
      },
      request,
    );
  });
  };
}
