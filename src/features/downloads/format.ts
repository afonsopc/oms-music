/**
 * Byte formatting for the downloads surfaces (FR-92/93). Same steps as the
 * Capacitor page so storage numbers read identically: 0 B / 812 KB /
 * 24.3 MB / 1.42 GB.
 */
export const formatBytes = (bytes: number): string => {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};
