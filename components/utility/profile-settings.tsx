import { ChatbotUIContext } from "@/context/context"
import { updateProfile } from "@/db/profile"
import { uploadProfileImage } from "@/db/storage/profile-images"
import { fetchOpenRouterModels } from "@/lib/models/fetch-models"
import { LLM_LIST_MAP } from "@/lib/models/llm/llm-list"
import {
  ProfileFormValues,
  profileFormValues,
  profileUpdate,
  providerProfileKey,
  validateUsername
} from "@/lib/profile-form"
import { supabase } from "@/lib/supabase/browser-client"
import { OpenRouterLLM } from "@/types"
import { IconLogout, IconUser } from "@tabler/icons-react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { FC, useContext, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { SIDEBAR_ICON_SIZE } from "../sidebar/sidebar-switcher"
import { Button } from "../ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from "../ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs"
import { ApiKeysTab } from "./api-keys-tab"
import { ProfileTab } from "./profile-tab"
import { ThemeSwitcher } from "./theme-switcher"

interface ProfileSettingsProps {}

const PROVIDERS = [
  "openai",
  "google",
  "azure",
  "anthropic",
  "mistral",
  "groq",
  "perplexity",
  "openrouter"
]

const USERNAME_CHECK_DELAY_MS = 500

/**
 * The settings sheet.
 *
 * This was 745 lines and twenty-three `useState` hooks, sixteen of them API
 * keys that differ only by which column they write to. The form is one value
 * object now, the two tabs are their own components, and the shape of the row a
 * save writes lives in lib/profile-form.ts where it can be tested.
 */
export const ProfileSettings: FC<ProfileSettingsProps> = ({}) => {
  const {
    profile,
    setProfile,
    envKeyMap,
    setAvailableHostedModels,
    setAvailableOpenRouterModels,
    availableOpenRouterModels
  } = useContext(ChatbotUIContext)

  const router = useRouter()

  const buttonRef = useRef<HTMLButtonElement>(null)

  const [isOpen, setIsOpen] = useState(false)
  const [values, setValues] = useState<ProfileFormValues>(() =>
    profileFormValues(profile)
  )
  const [usernameAvailable, setUsernameAvailable] = useState(true)
  const [loadingUsername, setLoadingUsername] = useState(false)
  const [profileImageSrc, setProfileImageSrc] = useState(
    profile?.image_url || ""
  )
  const [profileImageFile, setProfileImageFile] = useState<File | null>(null)

  // The profile arrives from context after the first render, so the form has to
  // pick it up rather than only reading it once.
  useEffect(() => {
    if (profile) {
      setValues(profileFormValues(profile))
      setProfileImageSrc(profile.image_url || "")
    }
  }, [profile])

  const set = <K extends keyof ProfileFormValues>(
    field: K,
    value: ProfileFormValues[K]
  ) => setValues(previous => ({ ...previous, [field]: value }))

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  const usernameTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleUsernameChange = (username: string) => {
    set("username", username)

    if (usernameTimer.current) clearTimeout(usernameTimer.current)
    usernameTimer.current = setTimeout(
      () => checkUsernameAvailability(username),
      USERNAME_CHECK_DELAY_MS
    )
  }

  const checkUsernameAvailability = async (username: string) => {
    if (!username) return

    // Unchanged is always fine. This used to be checked after the request, off
    // a `profile` captured on the first render by a `useCallback` with empty
    // dependencies — so once the profile loaded, typing your own name back in
    // reported it as taken.
    if (username === profile?.username) {
      setUsernameAvailable(true)
      return
    }

    const check = validateUsername(username)
    if (!check.valid) {
      setUsernameAvailable(false)
      if (check.reason) toast.error(check.reason)
      return
    }

    setLoadingUsername(true)
    try {
      const response = await fetch(`/api/username/available`, {
        method: "POST",
        body: JSON.stringify({ username })
      })
      const data = await response.json()

      setUsernameAvailable(data.isAvailable)
    } finally {
      setLoadingUsername(false)
    }
  }

  /** Bring each provider's models in or out of the picker after a save. */
  const syncAvailableModels = async (updated: typeof profile) => {
    if (!updated) return

    for (const provider of PROVIDERS) {
      if (envKeyMap[provider]) continue

      const models = LLM_LIST_MAP[provider]
      const hasApiKey = !!updated[providerProfileKey(provider)]

      if (provider === "openrouter") {
        if (hasApiKey && availableOpenRouterModels.length === 0) {
          const openrouterModels: OpenRouterLLM[] =
            await fetchOpenRouterModels()
          setAvailableOpenRouterModels(previous => [
            ...previous,
            ...openrouterModels.filter(
              model =>
                !previous.some(existing => existing.modelId === model.modelId)
            )
          ])
        } else {
          setAvailableOpenRouterModels([])
        }
        continue
      }

      if (!Array.isArray(models)) continue

      if (hasApiKey) {
        setAvailableHostedModels(previous => [
          ...previous,
          ...models.filter(
            model =>
              !previous.some(existing => existing.modelId === model.modelId)
          )
        ])
      } else {
        setAvailableHostedModels(previous =>
          previous.filter(model => !models.includes(model))
        )
      }
    }
  }

  const handleSave = async () => {
    if (!profile) return

    let imageUrl = profile.image_url
    let imagePath = ""

    if (profileImageFile) {
      const uploaded = await uploadProfileImage(profile, profileImageFile)
      imageUrl = uploaded.url ?? imageUrl
      imagePath = uploaded.path
    }

    const updatedProfile = await updateProfile(profile.id, {
      ...profile,
      ...profileUpdate(values, { url: imageUrl, path: imagePath })
    })

    setProfile(updatedProfile)
    toast.success("Profile updated!")

    await syncAvailableModels(updatedProfile)

    setIsOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      buttonRef.current?.click()
    }
  }

  if (!profile) return null

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        {profile.image_url ? (
          <Image
            className="mt-2 size-[34px] cursor-pointer rounded hover:opacity-50"
            src={profile.image_url + "?" + new Date().getTime()}
            height={34}
            width={34}
            alt={"Image"}
          />
        ) : (
          <Button size="icon" variant="ghost">
            <IconUser size={SIDEBAR_ICON_SIZE} />
          </Button>
        )}
      </SheetTrigger>

      <SheetContent
        className="flex flex-col justify-between"
        side="left"
        onKeyDown={handleKeyDown}
      >
        <div className="grow overflow-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center justify-between space-x-2">
              <div>User Settings</div>

              <Button
                tabIndex={-1}
                className="text-xs"
                size="sm"
                onClick={handleSignOut}
              >
                <IconLogout className="mr-1" size={20} />
                Logout
              </Button>
            </SheetTitle>
          </SheetHeader>

          <Tabs defaultValue="profile">
            <TabsList className="mt-4 grid w-full grid-cols-2">
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="keys">API Keys</TabsTrigger>
            </TabsList>

            <TabsContent className="mt-4 space-y-4" value="profile">
              <ProfileTab
                values={values}
                onChange={set}
                savedUsername={profile.username}
                usernameAvailable={usernameAvailable}
                loadingUsername={loadingUsername}
                onUsernameChange={handleUsernameChange}
                imageSrc={profileImageSrc}
                onImageSrcChange={setProfileImageSrc}
                imageFile={profileImageFile}
                onImageFileChange={setProfileImageFile}
              />
            </TabsContent>

            <TabsContent className="mt-4 space-y-4" value="keys">
              <ApiKeysTab
                values={values}
                onChange={set}
                envKeyMap={envKeyMap}
              />
            </TabsContent>
          </Tabs>
        </div>

        <div className="mt-6 flex items-center">
          <div className="flex items-center space-x-1">
            <ThemeSwitcher />
          </div>

          <div className="ml-auto space-x-2">
            <Button variant="ghost" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>

            <Button ref={buttonRef} onClick={handleSave}>
              Save
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
