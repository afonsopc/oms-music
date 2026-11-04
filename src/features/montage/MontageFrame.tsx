/**
 * O motor da Montagem no iOS e no Android: um WebView para o /montage/ de
 * produção. Só toca clipes que já estão na biblioteca (vídeo sem som).
 */
import React, { useCallback, useRef } from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { FromMontage, ToMontage } from "../../../montage/protocol";
import type { MontageFrameProps } from "./MontageFrame.types";
import { useMontageDriver } from "./useMontageDriver";

const MONTAGE_URL = "https://music.omelhorsite.pt/montage/";

export const MontageFrame = ({ spec, onMessage, style }: MontageFrameProps) => {
  const ref = useRef<WebView>(null);
  const send = useCallback((msg: ToMontage) => {
    ref.current?.injectJavaScript(`window.__montage && window.__montage(${JSON.stringify(msg)});true;`);
  }, []);
  const { onMessage: handle, ready } = useMontageDriver(send, spec, onMessage);
  return (
    <View pointerEvents="none" style={[{ overflow: "hidden", backgroundColor: "#000" }, style]}>
      <WebView
        ref={ref}
        source={{ uri: MONTAGE_URL }}
        originWhitelist={["https://music.omelhorsite.pt"]}
        style={{ flex: 1, backgroundColor: "#000", opacity: ready ? 1 : 0 }}
        containerStyle={{ backgroundColor: "#000" }}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        setSupportMultipleWindows={false}
        onMessage={(e: WebViewMessageEvent) => {
          try {
            handle(JSON.parse(e.nativeEvent.data) as FromMontage);
          } catch {
            // mensagem que não é do motor
          }
        }}
      />
    </View>
  );
};
