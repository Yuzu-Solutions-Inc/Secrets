"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { processImage } from "@/lib/images";

export async function updateProfile(formData: FormData) {
  const locale = formData.get("locale") === "en" ? "en" : "fr";
  const parsed = z.object({
    displayName: z.string().trim().min(1).max(80),
  }).parse({ displayName: formData.get("displayName") });
  const user = await getUser();
  if (!user) throw new Error("unauthorized");
  const supabase = await createClient();
  const file = formData.get("avatar");
  let avatarPath: string | undefined;
  if (file instanceof File && file.size > 0) {
    if (file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      throw new Error("invalid_avatar");
    }
    const { buffer, contentType } = await processImage(file, "avatar");
    avatarPath = `avatars/${user.id}/avatar.webp`;
    const { error: uploadError } = await supabase.storage
      .from("game-assets")
      .upload(avatarPath, buffer, { upsert: true, contentType });
    if (uploadError) throw new Error(uploadError.message);
  }
  const update: Record<string, string> = {
    display_name: parsed.displayName,
    preferred_locale: locale,
    // Bump so the avatar <img> cache-buster (?v=updated_at) changes when the
    // file is replaced at its fixed storage path.
    updated_at: new Date().toISOString(),
  };
  if (avatarPath) update.avatar_path = avatarPath;
  const { error } = await supabase.from("profiles").update(update).eq("id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath(`/${locale}`, "layout");
}
