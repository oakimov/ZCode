import { readFile } from "node:fs/promises";
import { ZAI_PROVIDER_ID } from "@zcode/shared";
import {
  TID_LOGIN_MENU_ITEM,
  TID_LOGIN_REGION_SWITCH,
  TID_LOGIN_TRIGGER,
  TID_OAUTH_LOGIN_BUTTON,
} from "@zcode/shared/test-ids";
import { clearAppData, getE2EAppDataPaths, waitForTestIdByDom } from "#e2e/helpers/desktop-app";
import { dismissOccupationOnboarding } from "#e2e/helpers/occupation-onboarding";

const EXPIRED_SESSION_CREDENTIAL_KEYS = [
  "oauth:active_provider",
  `oauth:${ZAI_PROVIDER_ID}:access_token`,
  `oauth:${ZAI_PROVIDER_ID}:refresh_token`,
  `oauth:${ZAI_PROVIDER_ID}:user_info`,
  "zcodejwttoken",
] as const;

describe("ZCode JWT 过期后重新认证", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("冷启动清理过期登录态，保留工作区与主动登录入口", async () => {
    await waitForExpiredSessionCredentialsCleanup();
    const byId = (id: string) => $(`[data-testid="${id}"]`);
    await byId(TID_LOGIN_TRIGGER).waitForExist({ timeout: 30000 });
    expect(await byId(TID_OAUTH_LOGIN_BUTTON).isExisting()).toBe(false);
    expect(await $('[data-slot="alert-dialog-content"]').isExisting()).toBe(false);

    await dismissOccupationOnboarding();
    await byId(TID_LOGIN_TRIGGER).click();
    await byId(TID_LOGIN_MENU_ITEM).click();
    await waitForTestIdByDom(TID_OAUTH_LOGIN_BUTTON, { timeout: 20000 });
    await waitForTestIdByDom(TID_LOGIN_REGION_SWITCH, { timeout: 20000 });
  });
});

async function waitForExpiredSessionCredentialsCleanup() {
  try {
    await browser.waitUntil(
      async () => {
        const credentials = await readCredentials();
        return EXPIRED_SESSION_CREDENTIAL_KEYS.every((key) => !(key in credentials));
      },
      {
        timeout: 10000,
        timeoutMsg: "冷启动后认证凭据没有完成清理",
      },
    );
  } catch (error) {
    const credentials = await readCredentials().catch(() => null);
    const keys = credentials ? Object.keys(credentials).sort().join(", ") : "<missing>";
    throw new Error(`过期认证凭据没有被清理，当前凭据 key: ${keys}`, {
      cause: error,
    });
  }
}

async function readCredentials(): Promise<Record<string, string>> {
  const { credentialsFile } = getE2EAppDataPaths();
  return JSON.parse(await readFile(credentialsFile, "utf-8")) as Record<string, string>;
}
