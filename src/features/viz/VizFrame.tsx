/**
 * O motor visual no iOS e no Android: um WebView para o /viz/ de produção
 * (WebGL no WKWebView/Chrome, na GPU). Sem rede não há cena: fica o fundo
 * de sempre por baixo. Ver viz/README.md.
 */
import React, { useCallback, useRef } from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { FromViz, ToViz } from "../../../viz/protocol";
import type { VizFrameProps } from "./VizFrame.types";
import { useVizDriver } from "./useVizDriver";

const VIZ_URL = "https://music.omelhorsite.pt/viz/";

export const VizFrame = (props: VizFrameProps) => {
  const ref = useRef<WebView>(null);
  const send = useCallback((msg: ToViz) => {
    ref.current?.injectJavaScript(`window.__viz && window.__viz(${JSON.stringify(msg)});true;`);
  }, []);
  const { onMessage, ready } = useVizDriver(send, props);
  return (
    <View pointerEvents={props.mode === "full" ? "auto" : "none"} style={[{ overflow: "hidden", backgroundColor: "transparent" }, props.style]}>
      <WebView
        ref={ref}
        source={{ uri: VIZ_URL }}
        originWhitelist={["https://music.omelhorsite.pt"]}
        style={{ flex: 1, backgroundColor: "transparent", opacity: ready ? 1 : 0 }}
        containerStyle={{ backgroundColor: "transparent" }}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction
        setSupportMultipleWindows={false}
        onMessage={(e: WebViewMessageEvent) => {
          try {
            onMessage(JSON.parse(e.nativeEvent.data) as FromViz);
          } catch {
            // mensagem que não é do motor
          }
        }}
      />
    </View>
  );
};
