/**
 * O motor da Montagem na web e no computador: um iframe para /montage/
 * (mesma origem), por baixo da cena do visualizador. Ver montage/README.md.
 */
import React, { useCallback, useEffect, useRef } from "react";
import { View } from "react-native";
import type { FromMontage, ToMontage } from "../../../montage/protocol";
import type { MontageFrameProps } from "./MontageFrame.types";
import { useMontageDriver } from "./useMontageDriver";

export const MontageFrame = ({ spec, onMessage, style }: MontageFrameProps) => {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const send = useCallback((msg: ToMontage) => {
    ref.current?.contentWindow?.postMessage({ __toMontage: true, ...msg }, window.location.origin);
  }, []);
  const { onMessage: handle, ready } = useMontageDriver(send, spec, onMessage);
  const handlerRef = useRef(handle);
  useEffect(() => {
    handlerRef.current = handle;
  });
  useEffect(() => {
    const listener = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return;
      const data = e.data as (FromMontage & { __montage?: boolean }) | null;
      if (data && data.__montage) handlerRef.current(data);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  return (
    <View pointerEvents="none" style={[{ overflow: "hidden", backgroundColor: "#000" }, style]}>
      <iframe
        ref={ref}
        src="/montage/"
        title="montagem"
        aria-hidden
        tabIndex={-1}
        style={{ border: 0, width: "100%", height: "100%", display: "block", opacity: ready ? 1 : 0, transition: "opacity .6s ease", background: "#000" }}
      />
    </View>
  );
};
