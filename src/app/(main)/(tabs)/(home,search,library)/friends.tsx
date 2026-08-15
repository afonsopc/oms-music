/**
 * Friends panel as its own page.
 *
 * It used to be the fourth page of the (player) pager, which put a social
 * screen behind three swipes of a now playing sheet where nobody would look
 * for it, and made the sheet longer to cross. The Home strip remains the
 * glanceable version; this is the full list.
 *
 * `standalone` tells the body it is a page, not the right panel tenant, so
 * it applies the desktop shell's standard top padding itself.
 */
import React from "react";
import FriendsBody from "@/features/friends";

export default function FriendsPage() {
  return <FriendsBody standalone />;
}
