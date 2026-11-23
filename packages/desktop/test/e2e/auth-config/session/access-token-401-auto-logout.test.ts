import { readE2ECredentialValue } from "#e2e/helpers/desktop-app";
import { readFile } from "node:fs/promises";
import {
  TID_OAUTH_LOGIN_BUTTON,
  TID_LOGIN_MENU_ITEM,
  TID_LOGIN_TRIGGER,
  TID_WORKSPACE_HEADER,
} from "@zcode/shared/test-ids";
import { clearAppData, getE2EAppDataPaths } from "#e2e/helpers/desktop-app";
import { dismissOccupationOnboarding } from "#e2e/helpers/occupation-onboarding";

const responseStatus = process.env.ZCODE_E2E_AUTH_EXPIRY_HTTP_STATUS === "200" ? 200 : 401;
const emptyRejection = process.env.ZCODE_E2E_AUTH_EXPIRY_RESPONSE_KIND === "empty";
const provider = process.env.ZCODE_E2E_AUTH_EXPIRY_PROVIDER === "zai" ? "zai" : "bigmodel";
const preserveSession = process.env.ZCODE_E2E_AUTH_VALIDATION_HEADER === "1";

describe("用户资料 access token 登录过期", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it(`AUTH-06: ${preserveSession ? "ZAI 有效身份遇到业务异常仍保留登录" : `${provider} HTTP ${responseStatus} ${emptyRejection ? "空正文" : "业务401"} 后清理登录态并保留工作区`}`, async () => {
    const baseUrl = process.env.ZCODE_E2E_ACCESS_TOKEN_401_URL;
    if (!baseUrl) throw new Error("缺少隔离 userinfo HTTP fixture");

    if (preserveSession) {
      await browser.waitUntil(
        async () => {
          const status = (await (await fetch(`${baseUrl}/__e2e/status`)).json()) as {
            ordinaryBusinessRequestCount: number;
            rawIdentityRequestCount: number;
            rejectedIdentityHeaderCount: number;
          };
          return (
            status.rejectedIdentityHeaderCount > 0 ||
            (status.ordinaryBusinessRequestCount > 0 && status.rawIdentityRequestCount > 0)
          );
        },
        { timeout: 30_000, timeoutMsg: "Host 没有完成异常业务请求与裸 token 身份核验" },
      );
      await dismissOccupationOnboarding();
      // 等待启动进入工作区，避免只观察首次核验、漏掉后续 PAT 资料读取造成的误退出。
      await browser
        .$(`[data-testid="${TID_WORKSPACE_HEADER}"]`)
        .waitForDisplayed({ timeout: 10_000 });
      const status = (await (await fetch(`${baseUrl}/__e2e/status`)).json()) as {
        rejectedIdentityHeaderCount: number;
      };
      expect(status.rejectedIdentityHeaderCount).toBe(0);
      const credentials = await readCredentials();
      expect(await readE2ECredentialValue("oauth:active_provider")).toBe("zai");
      for (const key of ["oauth:zai:access_token", "oauth:zai:user_info", "zcodejwttoken"])
        expect(credentials[key]).toBeDefined();
      expect(await readE2ECredentialValue("bot:e2e:credential")).toBe("e2e-independent-bot-token");
      expect(await expiredAlertCount()).toBe(0);
      return;
    }

    await browser.waitUntil(
      async () => {
        const response = await fetch(`${baseUrl}/__e2e/status`);
        const status = (await response.json()) as { businessRequestCount: number };
        return status.businessRequestCount > 0;
      },
      { timeout: 30_000, timeoutMsg: "Host 没有使用业务 access token 请求 userinfo" },
    );
    expect(await readE2ECredentialValue("oauth:active_provider")).toBe(provider);
    expect(await expiredAlertCount()).toBe(0);

    const relaunch = await browser.electron.mock("app", "relaunch");
    await relaunch.mockResolvedValue(undefined);
    const quit = await browser.electron.mock("app", "quit");
    await quit.mockResolvedValue(undefined);

    await fetch(
      `${baseUrl}/__e2e/reject?status=${responseStatus}&empty=${emptyRejection ? "1" : "0"}`,
      { method: "POST" },
    );
    const fixtureStatus = (await (await fetch(`${baseUrl}/__e2e/status`)).json()) as {
      rejectionStatus: number;
      rejected: boolean;
    };
    expect(fixtureStatus.rejectionStatus).toBe(responseStatus);
    expect(fixtureStatus.rejected).toBe(true);
    await browser.waitUntil(
      async () => {
        const credentials = await readCredentials();
        return [
          "oauth:active_provider",
          `oauth:${provider}:access_token`,
          `oauth:${provider}:refresh_token`,
          `oauth:${provider}:user_info`,
          "zcodejwttoken",
        ].every((key) => !(key in credentials));
      },
      { timeout: 10_000, timeoutMsg: "失效后没有完成 OAuth 清理" },
    );
    expect(await readE2ECredentialValue("bot:e2e:credential")).toBe("e2e-independent-bot-token");

    expect(await $(`[data-testid="${TID_OAUTH_LOGIN_BUTTON}"]`).isExisting()).toBe(false);
    expect(await expiredAlertCount()).toBe(0);
    await dismissOccupationOnboarding();
    await $(`[data-testid="${TID_LOGIN_TRIGGER}"]`).click();
    await $(`[data-testid="${TID_LOGIN_MENU_ITEM}"]`).waitForDisplayed({ timeout: 30000 });
    await relaunch.update();
    await quit.update();
    expect(relaunch.mock.calls).toHaveLength(0);
    expect(quit.mock.calls).toHaveLength(0);
  });
});

async function readCredentials(): Promise<Record<string, string>> {
  return JSON.parse(await readFile(getE2EAppDataPaths().credentialsFile, "utf8"));
}

async function expiredAlertCount(): Promise<number> {
  return browser.execute(
    () =>
      Array.from(document.querySelectorAll('[data-slot="alert-dialog-title"]')).filter((element) =>
        /登录已过期|Your session has expired/u.test(element.textContent ?? ""),
      ).length,
  );
}
