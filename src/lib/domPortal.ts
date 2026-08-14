/**
 * Portal para o document.body - fork nativo: devolve o no tal e qual (nao
 * ha DOM). A web (domPortal.web.ts) usa o createPortal do react-dom. Existe
 * porque o `position: fixed` do react-native-web dentro de um card do grid
 * NAO escapa o stacking context do pai: o overlay do cinema renderizava
 * atras da topbar e dos resizers (screenshot do dono 2026-08-14), e a unica
 * saida robusta e montar no body.
 */
import type React from "react";

export const domPortal = (node: React.ReactNode): React.ReactNode => node;
