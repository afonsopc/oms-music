/**
 * Meaningful User-Agent: the server parses it into the session's device name
 * shown on the devices screen. Format: "oms-music/<ver> (<model>; <os> <osVer>)".
 */
import Constants from "expo-constants";
import * as Device from "expo-device";

let cached: string | null = null;

export const buildUserAgent = (): string => {
  if (cached) return cached;
  const version = Constants.expoConfig?.version ?? "1.0.0";
  const model = Device.modelName ?? "unknown device";
  const os = Device.osName ?? "unknown os";
  const osVersion = Device.osVersion ?? "";
  cached = `oms-music/${version} (${model}; ${os} ${osVersion}`.trimEnd() + ")";
  return cached;
};
