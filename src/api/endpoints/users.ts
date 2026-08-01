/** Users REST (API.md section 3). */
import { request } from "../client";
import type { UserId } from "@/domain/ids";
import type { User } from "@/domain/user";

export const getUser = (id: UserId): Promise<User> =>
  request("GET", `/users/${encodeURIComponent(id)}`);

/**
 * PATCH /users/:id is multipart. share_listening writes go through here
 * (FR-98); picture is an optional image file part.
 */
export const updateUser = (
  id: UserId,
  fields: Partial<{
    name: string;
    handle: string;
    country_code: string;
    email_is_public: boolean;
    gender_is_public: boolean;
    gender: string;
    bio: string;
    library_public: boolean;
    library_name: string;
    library_description: string;
    share_listening: boolean;
  }>,
  picture?: { uri: string; name: string; type: string },
): Promise<User> => {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    formData.append(key, typeof value === "boolean" ? String(value) : value);
  }
  if (picture) {
    // React Native FormData file part.
    formData.append("picture", picture as unknown as Blob);
  }
  return request("PATCH", `/users/${encodeURIComponent(id)}`, { formData });
};

export const searchUsers = (q: string): Promise<{ id: UserId; handle: string; name: string }[]> =>
  request("GET", "/users/search", { params: { q }, auth: false });
