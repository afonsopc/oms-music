/**
 * O react-dom vem como peer do react-native-web mas sem @types (que nao
 * instalamos: regra de zero dependencias novas). O unico simbolo que a app
 * consome e o createPortal do lib/domPortal.web.ts - declara-se so esse.
 */
declare module "react-dom" {
  import type React from "react";
  export function createPortal(
    children: React.ReactNode,
    container: Element | DocumentFragment,
  ): React.ReactPortal;
}
