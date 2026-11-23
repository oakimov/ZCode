import {
  DISABLED_RENDERER_ACTION_TRACE_CONFIG,
  type RendererActionTraceConfigV1,
} from "@zcode/shared";
import { TID_LOGIN_TRIGGER, TID_OAUTH_LOGIN_BUTTON } from "@zcode/shared/test-ids";
import { clearAppData, readE2ECredentialValue } from "#e2e/helpers/desktop-app";
import { dismissOccupationOnboarding } from "#e2e/helpers/occupation-onboarding";

const byId = (id: string) => $(`[data-testid="${id}"]`);

async function expectNoMarketingTraffic(origin: string) {
  const response = await fetch(`${origin}/__e2e/marketing/state`);
  expect(response.ok).toBe(true);
  const ledger = (await response.json()) as { requestDetails: Array<{ path: string }> };
  expect(
    ledger.requestDetails.filter(({ path }) => path.startsWith("/api/v1/marketing/touch")),
  ).toEqual([]);
}

describe("公开 fork 的匿名工作区", () => {
  after(async () => {
    await clearAppData();
  });

  it("冷启动与重新联网均不请求营销投放或展示登录窗口", async () => {
    const origin = process.env.ZCODE_CODING_PLAN_UPGRADE_MOCK_BASE_URL;
    if (!origin) throw new Error("Missing isolated marketing fixture");

    // 首次启动仍可显示职业引导，通过用户可用的 Escape 入口进入工作区。
    const onboarding = byId("onboarding-page");
    await browser.waitUntil(
      async () => (await onboarding.isExisting()) || (await byId(TID_LOGIN_TRIGGER).isExisting()),
      { timeout: 30000 },
    );
    expect(await byId(TID_OAUTH_LOGIN_BUTTON).isExisting()).toBe(false);
    if (await onboarding.isExisting()) await dismissOccupationOnboarding();
    await byId(TID_LOGIN_TRIGGER).waitForExist({ timeout: 30000 });
    expect(await readE2ECredentialValue("oauth:active_provider")).toBeUndefined();
    expect(await byId(TID_OAUTH_LOGIN_BUTTON).isExisting()).toBe(false);
    await expectNoMarketingTraffic(origin);
    // 未初始化的 ARMS SDK 不应留下 Browser 注入，OTLP 查询契约仍返回关闭态。
    const telemetry = await browser.execute(async () => {
      const desktop = window as Window & {
        zcode?: { getRendererActionTraceConfig?: () => Promise<RendererActionTraceConfigV1> };
      };
      return {
        armsBridge: "ArmsEventBridge" in desktop,
        traceConfig: await desktop.zcode?.getRendererActionTraceConfig?.(),
      };
    });
    expect(telemetry).toEqual({
      armsBridge: false,
      traceConfig: DISABLED_RENDERER_ACTION_TRACE_CONFIG,
    });
    const reset = await fetch(`${origin}/__e2e/marketing/reset`, {
      method: "POST",
      body: JSON.stringify({ popup: true, banner: true }),
    });
    expect(reset.ok).toBe(true);
    await browser.execute(() => window.dispatchEvent(new Event("online")));

    // 负向断言覆盖 online 引起的异步后台请求，不能只在事件发出时读取空账本。
    const observationStarted = Date.now();
    await browser.waitUntil(
      async () => {
        await expectNoMarketingTraffic(origin);
        expect(await byId("cloud-content-dialog").isExisting()).toBe(false);
        expect(await byId("marketing-banner").isExisting()).toBe(false);
        expect(await byId(TID_OAUTH_LOGIN_BUTTON).isExisting()).toBe(false);
        return Date.now() - observationStarted >= 1000;
      },
      { timeout: 5000 },
    );
    const reports = await fetch(`${origin}/__e2e/marketing/telemetry`);
    expect(reports.ok).toBe(true);
    expect(await reports.json()).toEqual([]);
  });
});
