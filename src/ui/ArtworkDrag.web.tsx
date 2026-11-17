/**
 * Web: no hold-the-cover drag (gesture-handler is native-only here). The
 * grips from Reordenar in the ⋯ menu stay the way to sort on the web.
 */
import type React from "react";
import type { ArtworkDragProps } from "./ArtworkDrag";

export const ArtworkDrag = ({ children }: ArtworkDragProps): React.ReactElement => children;
