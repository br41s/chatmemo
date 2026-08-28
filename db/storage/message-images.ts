import { supabase } from "@/lib/supabase/browser-client"

export const uploadMessageImage = async (path: string, image: File) => {
  const bucket = "message_images"

  const imageSizeLimit = 6000000 // 6MB

  if (image.size > imageSizeLimit) {
    throw new Error(`Image must be less than ${imageSizeLimit / 1000000}MB`)
  }

  const { error } = await supabase.storage.from(bucket).upload(path, image, {
    upsert: true
  })

  if (error) {
    throw new Error("Error uploading image")
  }

  return path
}
