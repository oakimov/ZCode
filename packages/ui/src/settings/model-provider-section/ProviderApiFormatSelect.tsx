import type { ProviderApiType } from "@zcode/provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  TID_MODEL_PROVIDER_API_FORMAT_ITEM,
  TID_MODEL_PROVIDER_API_FORMAT_TRIGGER,
  testId,
} from "@zcode/shared/test-ids";

export type ProviderConnectionApiFormat = Exclude<ProviderApiType, "ai-sdk-module">;

export const PROVIDER_CONNECTION_API_FORMATS: readonly ProviderConnectionApiFormat[] = [
  "anthropic-messages",
  "openai-chat-completions",
  "openai-responses",
];

const PROVIDER_CONNECTION_API_FORMAT_PATHS: Record<ProviderConnectionApiFormat, string> = {
  "anthropic-messages": "/v1/messages",
  "openai-chat-completions": "/chat/completions",
  "openai-responses": "/responses",
};

const PROVIDER_CONNECTION_API_FORMAT_TITLE_IDS: Record<ProviderConnectionApiFormat, string> = {
  "anthropic-messages": "settings.modelProvider.apiFormat.title.anthropicMessages",
  "openai-chat-completions": "settings.modelProvider.apiFormat.title.chatCompletions",
  "openai-responses": "settings.modelProvider.apiFormat.title.responses",
};

export function resolveProviderConnectionApiFormatOptions(): ProviderConnectionApiFormat[] {
  return [...PROVIDER_CONNECTION_API_FORMATS];
}

export function resolveProviderConnectionApiFormatDisplayLabel(
  intl: { formatMessage: (descriptor: { id: string }) => string },
  format: ProviderApiType,
): string {
  if (format === "ai-sdk-module") {
    return intl.formatMessage({ id: "settings.modelProvider.apiFormat.title.aiSdkModule" });
  }
  const title = intl.formatMessage({
    id: PROVIDER_CONNECTION_API_FORMAT_TITLE_IDS[format],
  });
  return `${title} (${PROVIDER_CONNECTION_API_FORMAT_PATHS[format]})`;
}

export function ProviderApiFormatSelect({
  apiFormatOptions = PROVIDER_CONNECTION_API_FORMATS,
  triggerId,
  value,
  onChange,
}: {
  apiFormatOptions?: readonly ProviderConnectionApiFormat[];
  triggerId?: string;
  value: ProviderConnectionApiFormat;
  onChange: (value: ProviderConnectionApiFormat) => void;
}) {
  const { intl } = useZCodeIntl();

  return (
    <Select
      value={value}
      onValueChange={(nextValue) => onChange(nextValue as ProviderConnectionApiFormat)}
    >
      <SelectTrigger
        id={triggerId}
        data-testid={TID_MODEL_PROVIDER_API_FORMAT_TRIGGER}
        size="lg"
        className="w-full justify-between"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        {apiFormatOptions.map((format) => (
          <SelectItem
            key={format}
            value={format}
            data-testid={testId(TID_MODEL_PROVIDER_API_FORMAT_ITEM, format)}
          >
            {resolveProviderConnectionApiFormatDisplayLabel(intl, format)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
