import type { StyleProp, ViewStyle } from "react-native";
import type { FromMontage, MontageSpec } from "../../../montage/protocol";

export interface MontageFrameProps {
  spec: MontageSpec | null;
  onMessage?: (msg: FromMontage) => void;
  style?: StyleProp<ViewStyle>;
}
