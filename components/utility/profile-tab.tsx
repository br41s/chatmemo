"use client"

import ImagePicker from "@/components/ui/image-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LimitDisplay } from "@/components/ui/limit-display"
import { TextareaAutosize } from "@/components/ui/textarea-autosize"
import {
  PROFILE_CONTEXT_MAX,
  PROFILE_DISPLAY_NAME_MAX,
  PROFILE_USERNAME_MAX,
  PROFILE_USERNAME_MIN
} from "@/db/limits"
import { ProfileFormValues } from "@/lib/profile-form"
import {
  IconCircleCheckFilled,
  IconCircleXFilled,
  IconLoader2
} from "@tabler/icons-react"
import { FC } from "react"

interface ProfileTabProps {
  values: ProfileFormValues
  onChange: <K extends keyof ProfileFormValues>(
    field: K,
    value: ProfileFormValues[K]
  ) => void
  /** The name already saved, so the form can tell "unchanged" from "taken". */
  savedUsername: string
  usernameAvailable: boolean
  loadingUsername: boolean
  onUsernameChange: (username: string) => void
  imageSrc: string
  onImageSrcChange: (src: string) => void
  imageFile: File | null
  onImageFileChange: (file: File | null) => void
}

/** Who you are, as the assistant sees you. */
export const ProfileTab: FC<ProfileTabProps> = ({
  values,
  onChange,
  savedUsername,
  usernameAvailable,
  loadingUsername,
  onUsernameChange,
  imageSrc,
  onImageSrcChange,
  imageFile,
  onImageFileChange
}) => {
  const usernameChanged = values.username !== savedUsername

  return (
    <>
      <div className="space-y-1">
        <div className="flex items-center space-x-2">
          <Label>Username</Label>

          <div className="text-xs">
            {usernameChanged ? (
              usernameAvailable ? (
                <div className="text-success">AVAILABLE</div>
              ) : (
                <div className="text-destructive">UNAVAILABLE</div>
              )
            ) : null}
          </div>
        </div>

        <div className="relative">
          <Input
            className="pr-10"
            placeholder="Username..."
            value={values.username}
            onChange={e => onUsernameChange(e.target.value)}
            minLength={PROFILE_USERNAME_MIN}
            maxLength={PROFILE_USERNAME_MAX}
          />

          {usernameChanged ? (
            <div className="absolute inset-y-0 right-0 flex items-center pr-3">
              {loadingUsername ? (
                <IconLoader2 className="animate-spin" />
              ) : usernameAvailable ? (
                <IconCircleCheckFilled className="text-success" />
              ) : (
                <IconCircleXFilled className="text-destructive" />
              )}
            </div>
          ) : null}
        </div>

        <LimitDisplay
          used={values.username.length}
          limit={PROFILE_USERNAME_MAX}
        />
      </div>

      <div className="space-y-1">
        <Label>Profile Image</Label>

        <ImagePicker
          src={imageSrc}
          image={imageFile}
          height={50}
          width={50}
          onSrcChange={onImageSrcChange}
          onImageChange={onImageFileChange}
        />
      </div>

      <div className="space-y-1">
        <Label>Chat Display Name</Label>

        <Input
          placeholder="Chat display name..."
          value={values.displayName}
          onChange={e => onChange("displayName", e.target.value)}
          maxLength={PROFILE_DISPLAY_NAME_MAX}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-sm">
          What would you like the AI to know about you to provide better
          responses?
        </Label>

        <TextareaAutosize
          value={values.profileInstructions}
          onValueChange={value => onChange("profileInstructions", value)}
          placeholder="Profile context... (optional)"
          minRows={6}
          maxRows={10}
        />

        <LimitDisplay
          used={values.profileInstructions.length}
          limit={PROFILE_CONTEXT_MAX}
        />
      </div>
    </>
  )
}
