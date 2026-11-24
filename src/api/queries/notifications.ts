/** The library notifications of the account, newest first. */
import { useQuery } from "@tanstack/react-query";
import { oms } from "../oms";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import { parseMusicNotification, type MusicNotification } from "@/social/musicNotifications";

const PAGE = 100;

export const listMusicNotifications = async (): Promise<MusicNotification[]> => {
  const page = await oms().content.notifications.list({ pageSize: PAGE, order: "created_at:desc" });
  return page.items
    .map(parseMusicNotification)
    .filter((n): n is MusicNotification => n !== null);
};

export const useMusicNotifications = () => {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: keys.musicNotifications,
    queryFn: guardedQueryFn(keys.musicNotifications, listMusicNotifications),
    enabled: authReady,
  });
};
