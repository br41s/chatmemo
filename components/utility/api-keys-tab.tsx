"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ProfileFormValues, SIMPLE_KEY_FIELDS } from "@/lib/profile-form"
import { cn } from "@/lib/utils"
import { VALID_ENV_KEYS } from "@/types/valid-keys"
import { FC } from "react"

interface ApiKeysTabProps {
  values: ProfileFormValues
  onChange: <K extends keyof ProfileFormValues>(
    field: K,
    value: ProfileFormValues[K]
  ) => void
  /** Which keys the deployment already supplies; those get a note, not a box. */
  envKeyMap: Record<string, VALID_ENV_KEYS>
}

/** One labelled password box, or a note saying the deployment provides it. */
const KeyField: FC<{
  label: string
  placeholder?: string
  adminNote: string
  provided: boolean
  value: string
  type?: string
  disabled?: boolean
  onChange: (value: string) => void
}> = ({
  label,
  placeholder,
  adminNote,
  provided,
  value,
  type = "password",
  disabled,
  onChange
}) => (
  <div className="space-y-1">
    {provided ? (
      <Label>{adminNote}</Label>
    ) : (
      <>
        <Label>{label}</Label>
        <Input
          placeholder={placeholder ?? label}
          type={type}
          disabled={disabled}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      </>
    )}
  </div>
)

/**
 * Where the provider keys live.
 *
 * Six of these were the same twelve lines with a different label and a
 * different state setter, so they are a list now. The OpenAI/Azure pair keeps
 * its own markup: it is a switch between two shapes, not another key.
 */
export const ApiKeysTab: FC<ApiKeysTabProps> = ({
  values,
  onChange,
  envKeyMap
}) => {
  const azure = values.useAzureOpenai

  return (
    <>
      <div className="mt-5 space-y-2">
        <Label className="flex items-center">
          {azure
            ? envKeyMap["azure"]
              ? ""
              : "Azure OpenAI API Key"
            : envKeyMap["openai"]
              ? ""
              : "OpenAI API Key"}

          <Button
            className={cn(
              "h-[18px] w-[150px] text-[11px]",
              (azure && !envKeyMap["azure"]) || (!azure && !envKeyMap["openai"])
                ? "ml-3"
                : "mb-3"
            )}
            onClick={() => onChange("useAzureOpenai", !azure)}
          >
            {azure ? "Switch To Standard OpenAI" : "Switch To Azure OpenAI"}
          </Button>
        </Label>

        {azure ? (
          <KeyField
            label="Azure OpenAI API Key"
            adminNote="Azure OpenAI API key set by admin."
            provided={!!envKeyMap["azure"]}
            value={values.azureOpenaiAPIKey}
            onChange={value => onChange("azureOpenaiAPIKey", value)}
          />
        ) : (
          <KeyField
            label="OpenAI API Key"
            adminNote="OpenAI API key set by admin."
            provided={!!envKeyMap["openai"]}
            value={values.openaiAPIKey}
            onChange={value => onChange("openaiAPIKey", value)}
          />
        )}
      </div>

      <div className="ml-8 space-y-3">
        {azure ? (
          <>
            <KeyField
              label="Azure Endpoint"
              placeholder="https://your-endpoint.openai.azure.com"
              adminNote="Azure endpoint set by admin."
              provided={!!envKeyMap["azure_openai_endpoint"]}
              type="text"
              value={values.azureOpenaiEndpoint}
              onChange={value => onChange("azureOpenaiEndpoint", value)}
            />

            <KeyField
              label="Azure GPT-3.5 Turbo Deployment Name"
              adminNote="Azure GPT-3.5 Turbo deployment name set by admin."
              provided={!!envKeyMap["azure_gpt_35_turbo_name"]}
              type="text"
              value={values.azureOpenai35TurboID}
              onChange={value => onChange("azureOpenai35TurboID", value)}
            />

            <KeyField
              label="Azure GPT-4.5 Turbo Deployment Name"
              adminNote="Azure GPT-4.5 Turbo deployment name set by admin."
              provided={!!envKeyMap["azure_gpt_45_turbo_name"]}
              type="text"
              value={values.azureOpenai45TurboID}
              onChange={value => onChange("azureOpenai45TurboID", value)}
            />

            <KeyField
              label="Azure GPT-4.5 Vision Deployment Name"
              adminNote="Azure GPT-4.5 Vision deployment name set by admin."
              provided={!!envKeyMap["azure_gpt_45_vision_name"]}
              type="text"
              value={values.azureOpenai45VisionID}
              onChange={value => onChange("azureOpenai45VisionID", value)}
            />

            <KeyField
              label="Azure Embeddings Deployment Name"
              adminNote="Azure Embeddings deployment name set by admin."
              provided={!!envKeyMap["azure_embeddings_name"]}
              type="text"
              value={values.azureEmbeddingsID}
              onChange={value => onChange("azureEmbeddingsID", value)}
            />
          </>
        ) : (
          <KeyField
            label="OpenAI Organization ID"
            placeholder="OpenAI Organization ID (optional)"
            adminNote="OpenAI Organization ID set by admin."
            provided={!!envKeyMap["openai_organization_id"]}
            disabled={!!process.env.NEXT_PUBLIC_OPENAI_ORGANIZATION_ID}
            value={values.openaiOrgID}
            onChange={value => onChange("openaiOrgID", value)}
          />
        )}
      </div>

      {SIMPLE_KEY_FIELDS.map(({ field, envKey, label }) => (
        <KeyField
          key={field}
          label={label}
          adminNote={`${label.replace(" API Key", "")} API key set by admin.`}
          provided={!!envKeyMap[envKey]}
          value={values[field] as string}
          onChange={value => onChange(field, value as never)}
        />
      ))}
    </>
  )
}
