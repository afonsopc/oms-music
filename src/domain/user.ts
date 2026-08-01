import type { SessionId, UserId } from "./ids";

export interface User {
  id: UserId;
  handle: string;
  name: string;
  bio: string | null;
  country_code: string | null;
  email_is_public: boolean;
  gender_is_public: boolean;
  library_public: boolean;
  library_name: string | null;
  library_description: string | null;
  // conditional (self/admin):
  group?: string;
  email?: string;
  gender?: string | null;
  allowed_to_use_spotify?: boolean;
  share_listening?: boolean;
}

export interface Session {
  id: SessionId;
  created_at: string;
  updated_at: string;
  ip_address: string;
  user_agent: string;
  name: string;
  description: string | null;
  device_type: string;
  last_used_at: string;
  user_id: UserId;
  user?: User;
  token?: string; // token view only (POST /sessions response)
}

/** GET /relationships row. Friends = kind "friend" + status "accepted". */
export interface Relationship {
  id: number;
  created_at: string;
  updated_at: string;
  kind: string;
  status: string;
  requester_id: UserId;
  accepter_id: UserId;
  requester?: { id: UserId; handle: string; name: string };
  accepter?: { id: UserId; handle: string; name: string };
}
