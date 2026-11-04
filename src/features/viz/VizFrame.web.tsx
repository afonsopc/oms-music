/**
 * O motor visual na web e no computador: um iframe para /viz/ (mesma
 * origem), carregado só quando isto monta. Ver viz/README.md.
 */
import React, { useCallback, useEffect, useRef } from "react";
import { View } from "react-native";
import type { FromViz, ToViz } from "../../../viz/protocol";
import type { VizFrameProps } from "./VizFrame.types";
import { useVizDriver } from "./useVizDriver";

export const VizFrame = (props: VizFrameProps) => {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const send = useCallback((msg: ToViz) => {
    ref.current?.contentWindow?.postMessage(msg, window.location.origin);
  }, []);
  const { onMessage, ready } = useVizDriver(send, props);
  const handlerRef = useRef(onMessage);
  useEffect(() => {
    handlerRef.current = onMessage;
  });
  useEffect(() => {
    const listener = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return;
      const data = e.data as (FromViz & { __viz?: boolean }) | null;
      if (data && data.__viz) handlerRef.current(data);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  return (
    <View pointerEvents={props.mode === "full" ? "auto" : "none"} style={[{ overflow: "hidden" }, props.style]}>
      <iframe
        ref={ref}
        src="/viz/"
        title="visuais"
        aria-hidden={props.mode !== "full"}
        tabIndex={props.mode === "full" ? 0 : -1}
        style={{ border: 0, width: "100%", height: "100%", display: "block", opacity: ready ? 1 : 0, transition: "opacity .6s ease", background: "transparent" }}
      />
    </View>
  );
};
