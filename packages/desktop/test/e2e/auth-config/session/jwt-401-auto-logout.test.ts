import { readE2ECredentialValue } from "#e2e/helpers/desktop-app";
import { readFile } from "node:fs/promises";
import {
  TID_LOGIN_MENU_ITEM,
  TID_LOGIN_TRIGGER,
  TID_OAUTH_LOGIN_BUTTON,
} from "@zcode/shared/test-ids";
import { clearAppData, getE2EAppDataPaths } from "#e2e/helpers/desktop-app";
import { dismissOccupationOnboarding } from "#e2e/helpers/occupation-onboarding";

const OAUTH_CREDENTIAL_KEYS = [
  "oauth:active_provider",
  "oauth:zai:access_token",
  "oauth:zai:user_info",
  "zcodejwttoken",
] as const;

describe("ZCode JWT 401 自动退出", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("运行中共享 JWT 收到普通 401 后清理凭据并保留工作区", async function () {
    this.timeout(120_000);

    const baseUrl = process.env.ZCODE_E2E_ACCESS_TOKEN_401_URL;
    if (!baseUrl) throw new Error("缺少隔离共享 JWT HTTP fixture");
    // 旧用例 mock main net.fetch，不能证明 Host transport。先确认真实 Host 使用共享 JWT。
    await browser.waitUntil(
      async () => {
        const status = (await (await fetch(`${baseUrl}/__e2e/status`)).json()) as {
          businessRequestCount: number;
        };
        return status.businessRequestCount > 0;
      },
      { timeout: 30000, timeoutMsg: "Host 没有使用共享 JWT 请求余额接口" },
    );
    const relaunchMock = await browser.electron.mock("app", "relaunch");
    await relaunchMock.mockResolvedValue(undefined);
    const quitMock = await browser.electron.mock("app", "quit");
    await quitMock.mockResolvedValue(undefined);

    await fetch(`${baseUrl}/__e2e/reject?status=401`, { method: "POST" });

    await waitForOAuthCredentialsCleanup();
    expect(await $(`[data-testid="${TID_OAUTH_LOGIN_BUTTON}"]`).isExisting()).toBe(false);
    expect(await $('[data-slot="alert-dialog-content"]').isExisting()).toBe(false);
    await dismissOccupationOnboarding();
    await $(`[data-testid="${TID_LOGIN_TRIGGER}"]`).click();
    await $(`[data-testid="${TID_LOGIN_MENU_ITEM}"]`).waitForDisplayed({ timeout: 30000 });
    await relaunchMock.update();
    await quitMock.update();
    expect(relaunchMock.mock.calls).toHaveLength(0);
    expect(quitMock.mock.calls).toHaveLength(0);
    expect(await readE2ECredentialValue("bot:e2e:credential")).toBe("e2e-independent-bot-token");
  });
});

async function waitForOAuthCredentialsCleanup(): Promise<void> {
  await browser.waitUntil(
    async () => {
      try {
        const credentials = JSON.parse(
          await readFile(getE2EAppDataPaths().credentialsFile, "utf-8"),
        ) as Record<string, string>;
        return OAUTH_CREDENTIAL_KEYS.every((key) => !(key in credentials));
      } catch {
        return false;
      }
    },
    {
      timeout: 10000,
      timeoutMsg: "401 后 OAuth/JWT 凭据没有清理",
    },
  );
}
