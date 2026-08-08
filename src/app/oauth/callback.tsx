/**
 * OAuth return page for the WEB popup flow: the backend redirects the popup
 * to `<app origin>/oauth/callback?ticket=...` and maybeCompleteAuthSession()
 * hands that URL to the opener window (resolving its openAuthSessionAsync)
 * and closes the popup. Runs at MODULE scope: the popup must complete before
 * any auth guard gets a chance to navigate it away. A no-op on native, where
 * the system browser intercepts the omsmusic:// scheme instead and this
 * route never renders.
 */
import React from "react";
import { View } from "react-native";
import * as WebBrowser from "expo-web-browser";

WebBrowser.maybeCompleteAuthSession();

export default function OAuthReturn() {
  return <View />;
}
