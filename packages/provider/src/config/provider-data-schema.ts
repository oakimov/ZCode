import { z } from "zod";
import { sparseShape } from "@zcode/shared/config-schema";

export const providerHttpApiTypeDataSchema = z.enum([
  "anthropic-messages",
  "openai-chat-completions",
  "openai-responses",
]);
export const providerApiTypeDataSchema = z.enum([
  ...providerHttpApiTypeDataSchema.options,
  "ai-sdk-module",
]);
export const providerGroupDataSchema = z.enum([
  "standard-personal",
  "zai-family",
  "bigmodel-family",
]);
export const zhipuAccountModeDataSchema = z.enum([
  "start-plan",
  "individual-coding-plan",
  "team-coding-plan",
  "off-peak",
  // 加速卡访问类别；与 zcodeProviderAccountAccessSchema.mode 同值，改动需同步两处。
  "highspeed",
]);
export const providerVisibilityDataSchema = z.enum(["visible", "hidden"]);
export const providerLogoDataSchema = z
  .object({ type: z.literal("builtin"), key: z.string().min(1) })
  .strict();

const nonBlankRequiredString = z.string().refine((value) => value.trim().length > 0, {
  message: "必填配置不能为空",
  params: { configIssueCode: "required-field-missing" },
});

/**
 * Absolute path (POSIX/Windows) or file: URL; reject relative paths and other schemes.
 * Pure string check — @zcode/provider must stay Node-free for UI/web consumers.
 */
export function isAbsoluteModulePathOrFileUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^file:/i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return url.protocol === "file:" && Boolean(url.pathname) && !url.search && !url.hash;
    } catch {
      return false;
    }
  }
  // POSIX absolute, Windows drive absolute, or UNC.
  return (
    trimmed.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith("\\\\") ||
    trimmed.startsWith("//")
  );
}

const absoluteModulePathSchema = z
  .string()
  .refine((value) => isAbsoluteModulePathOrFileUrl(value), {
    message: "module 必须是绝对路径或 file: URL",
    params: { configIssueCode: "module-path-invalid" },
  });

export const apiKeyAccessDataSchema = z
  .object({
    type: z.enum(["api-key", "zhipu-coding-plan-api-key"]),
    apiKey: z.string().nullable().optional(),
    apiKeyManagementUrl: z.string().url().nullable().optional(),
  })
  .strict();
export const completeApiKeyAccessDataSchema = apiKeyAccessDataSchema.extend({
  apiKey: nonBlankRequiredString,
});

export const completeZhipuAccountAccessDataSchema = z
  .object({
    type: z.literal("zhipu-account"),
    accountType: z.enum(["zai", "bigmodel"]),
    mode: zhipuAccountModeDataSchema,
    entitled: z.boolean(),
  })
  .strict();
export const zhipuAccountAccessDataSchema = z
  .object({
    ...sparseShape(completeZhipuAccountAccessDataSchema.shape),
    type: completeZhipuAccountAccessDataSchema.shape.type,
  })
  .strict();

export const noneAccessDataSchema = z.object({ type: z.literal("none") }).strict();
export const completeNoneAccessDataSchema = noneAccessDataSchema;

export const providerAccessDataSchema = z.discriminatedUnion("type", [
  apiKeyAccessDataSchema,
  zhipuAccountAccessDataSchema,
  noneAccessDataSchema,
]);
export const completeProviderAccessDataSchema = z.discriminatedUnion("type", [
  completeApiKeyAccessDataSchema,
  completeZhipuAccountAccessDataSchema,
  completeNoneAccessDataSchema,
]);

export const completeHttpProviderApiDataSchema = z
  .object({
    type: providerHttpApiTypeDataSchema,
    baseUrl: nonBlankRequiredString.pipe(z.string().url()),
    headers: z.record(z.string(), z.string()).readonly().nullable().optional(),
  })
  .strict();

export const completeModuleProviderApiDataSchema = z
  .object({
    type: z.literal("ai-sdk-module"),
    module: absoluteModulePathSchema,
    export: z.string().min(1).nullable().optional(),
    options: z.record(z.string(), z.unknown()).readonly().nullable().optional(),
  })
  .strict();

export const completeProviderApiDataSchema = z.discriminatedUnion("type", [
  completeHttpProviderApiDataSchema,
  completeModuleProviderApiDataSchema,
]);

export const httpProviderApiDataSchema = z
  .object({
    ...sparseShape(completeHttpProviderApiDataSchema.shape),
    type: providerHttpApiTypeDataSchema.nullable().optional(),
    baseUrl: z.string().url().nullable().optional(),
  })
  .strict();

export const moduleProviderApiDataSchema = z
  .object({
    ...sparseShape(completeModuleProviderApiDataSchema.shape),
    type: z.literal("ai-sdk-module").nullable().optional(),
    module: absoluteModulePathSchema.nullable().optional(),
  })
  .strict();

/** Sparse API shape for Built-in/overlay; admits HTTP or module fields without requiring completeness. */
export const providerApiDataSchema = z
  .object({
    type: providerApiTypeDataSchema.nullable().optional(),
    baseUrl: z.string().url().nullable().optional(),
    headers: z.record(z.string(), z.string()).readonly().nullable().optional(),
    module: absoluteModulePathSchema.nullable().optional(),
    export: z.string().min(1).nullable().optional(),
    options: z.record(z.string(), z.unknown()).readonly().nullable().optional(),
  })
  .strict();

// Personal 允许暂存编辑中的 endpoint / module 路径；完整 schema 仍拒绝，且只影响该 Provider 的准入。
export const personalProviderApiDataSchema = providerApiDataSchema.extend({
  baseUrl: z.string().nullable().optional(),
  module: z.string().nullable().optional(),
});

const modelIdsDataSchema = z.array(z.string().min(1)).readonly().nullable().optional();
export const providerConfigDataSchema = z
  .object({
    group: providerGroupDataSchema.nullable().optional(),
    logo: providerLogoDataSchema.nullable().optional(),
    access: providerAccessDataSchema.nullable().optional(),
    api: providerApiDataSchema.nullable().optional(),
    builtinModelIds: modelIdsDataSchema,
    personalModelIds: modelIdsDataSchema,
    modelOrder: modelIdsDataSchema,
    visibility: providerVisibilityDataSchema.nullable().optional(),
  })
  .strict();

function refineModuleAccessPair(
  config: {
    readonly access?: { readonly type?: string } | null;
    readonly api?: { readonly type?: string | null } | null;
  },
  ctx: z.RefinementCtx,
): void {
  const apiType = config.api?.type;
  const accessType = config.access?.type;
  if (apiType === "ai-sdk-module" && accessType !== "none") {
    ctx.addIssue({
      code: "custom",
      path: ["access", "type"],
      message: "ai-sdk-module 只接受 access.type: none",
      params: { configIssueCode: "module-access-mismatch" },
    });
  }
  if (accessType === "none" && apiType !== "ai-sdk-module") {
    ctx.addIssue({
      code: "custom",
      path: ["api", "type"],
      message: "access.type: none 只与 ai-sdk-module 合法",
      params: { configIssueCode: "none-access-api-mismatch" },
    });
  }
}

export const completeProviderConfigDataSchema = providerConfigDataSchema
  .extend({
    group: providerGroupDataSchema,
    access: completeProviderAccessDataSchema,
    api: completeProviderApiDataSchema,
  })
  .superRefine(refineModuleAccessPair);

export const providerTemplateNameMapDataSchema = z
  .object({
    "zh-CN": z.string().min(1).optional(),
    "en-US": z.string().min(1).optional(),
  })
  .strict();
export const providerTemplateDataSchema = z
  .object({
    templateId: z.string().min(1),
    templateNameMap: providerTemplateNameMapDataSchema,
    config: providerConfigDataSchema,
  })
  .strict();
