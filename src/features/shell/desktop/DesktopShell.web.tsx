/**
 * Desktop shell, web fork (plano-uma-so-app 4.1): at >= 900px of window the
 * (main) tree renders inside a real CSS grid -
 *
 *   "topbar    topbar    topbar"
 *   "sidebar   main      rightpanel"
 *   "player    player    player"
 *
 * with an 8px gap and every zone a rounded card, exactly the plan's zone
 * map. The topbar and the transport bar are grid ROWS, not overlays, so no
 * screen needs compensatory bottom padding and the sidebar, main pane and
 * right panel scroll independently without ever pushing the player off
 * screen (the OverlayHost.tsx:53 problem, solved by geometry).
 *
 * Below 900px this component renders the SAME children through the SAME
 * element chain with only style changes - the zones unmount, nothing else
 * moves. That structural stability is load-bearing: if the children were
 * re-parented at the breakpoint, React would remount the navigator and a
 * window resize would throw the user back to Home.
 *
 * react-native-web cannot express display:grid on a View, so the grid lives
 * on plain divs; everything INSIDE each zone is regular RN code. The main
 * pane measures itself and provides its width as the container width
 * (ui/shellLayout), which is what makes the main-sm..xl breakpoints
 * container-true. It also caps content at `contentMax` and centers it.
 */
import React, { useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { BREAKPOINTS, ContainerWidthProvider, useDesktopShell, useRightPanelWide } from "@/ui";
import { foregroundWash } from "@/ui/uiTheme";
import {
  readRightPanelOpen,
  readRightPanelTenant,
  readRightPanelWidth,
  readSidebarCollapsed,
  readSidebarWidth,
  writeRightPanelOpen,
  writeRightPanelTenant,
  writeRightPanelWidth,
  writeSidebarCollapsed,
  writeSidebarWidth,
} from "./layoutPrefs";
import {
  clampSidebarWidth,
  SIDEBAR_COLLAPSE_THRESHOLD,
  SIDEBAR_WIDTH_MIN,
  sidebarWidthCeiling,
} from "./layoutModel";
import { DesktopShortcuts } from "./DesktopShortcuts";
import { PanelResizer } from "./PanelResizer";
import { DesktopRightPanel } from "./RightPanel";
import { ShortcutsOverlay } from "./ShortcutsOverlay";
import {
  clampRightPanelWidth,
  RIGHT_PANEL_MIN_WIDTH,
  rightPanelWidthCeiling,
  type RightPanelTenant,
} from "./rightPanelModel";
import { DesktopSidebar } from "./Sidebar";
import { DesktopTopBar } from "./TopBar";
import { DesktopTransportBar } from "./TransportBar";

/**
 * Mirrors DesktopShell.tsx (the native pass-through) - a type-only import
 * from "./DesktopShell" would resolve back to THIS file on web, so the
 * shape is spelled twice on purpose.
 */
export interface DesktopShellProps {
  children: React.ReactNode;
}

const GAP = 8;
const TOPBAR_HEIGHT = 56;
const TRANSPORT_HEIGHT = 88;
const SIDEBAR_RAIL_WIDTH = 72;
const PANEL_RAIL_WIDTH = 32;

export const DesktopShell = ({ children }: DesktopShellProps) => {
  const desktop = useDesktopShell();
  const panelWide = useRightPanelWide();
  const { tokens, scheme } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const t = useT();

  // Remembered shape, hydrated synchronously so the first frame is already
  // right (4.5 persistence; kv is localStorage here).
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const [wantedSidebarWidth, setWantedSidebarWidth] = useState(readSidebarWidth);
  const [panelOpen, setPanelOpen] = useState(readRightPanelOpen);
  const [panelTenant, setPanelTenant] = useState(readRightPanelTenant);
  const [wantedPanelWidth, setWantedPanelWidth] = useState(readRightPanelWidth);
  const [mainWidth, setMainWidth] = useState(0);
  // Cmd/Ctrl+/ overlay (4.4). Session state on purpose: a shortcuts sheet
  // that survives reload would greet every launch.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const toggleSidebar = (): void => {
    setCollapsed((prev) => {
      writeSidebarCollapsed(!prev);
      return !prev;
    });
  };
  const setPanelOpenPersisted = (open: boolean): void => {
    setPanelOpen(open);
    writeRightPanelOpen(open);
  };
  const togglePanel = (): void => setPanelOpenPersisted(!panelOpen);

  /** Show a tenant: switches the ONE key, opening the panel if shut. */
  const selectTenant = (tenant: RightPanelTenant): void => {
    setPanelTenant(tenant);
    writeRightPanelTenant(tenant);
    if (!panelOpen) setPanelOpenPersisted(true);
  };
  /** Transport-bar toggles: same button closes what it opened. */
  const toggleTenant = (tenant: RightPanelTenant): void => {
    if (panelOpen && panelTenant === tenant) setPanelOpenPersisted(false);
    else selectTenant(tenant);
  };

  // Both remembered widths re-clamp against the LIVE window (the window they
  // were saved under is gone), preserving the plan's main >= 480 guarantee.
  // The sidebar settles first, conceding only the right column's FLOOR (its
  // rail when shut, its minimum when open); the panel then clamps against
  // the sidebar's settled width - never circular, always within bounds.
  const panelFloor = panelWide && panelOpen ? RIGHT_PANEL_MIN_WIDTH : PANEL_RAIL_WIDTH;
  const sidebarMax = Math.max(
    SIDEBAR_WIDTH_MIN,
    sidebarWidthCeiling(windowWidth, panelFloor, GAP),
  );
  const expandedSidebarWidth = Math.min(clampSidebarWidth(wantedSidebarWidth), sidebarMax);
  const sidebarWidth = collapsed ? SIDEBAR_RAIL_WIDTH : expandedSidebarWidth;
  const panelColumnWidth = clampRightPanelWidth(wantedPanelWidth, windowWidth, sidebarWidth, GAP);
  const panelWidth = panelWide && panelOpen ? panelColumnWidth : PANEL_RAIL_WIDTH;

  /** Live drag: the column tracks the pointer, floored at the usable minimum. */
  const resizeSidebar = (next: number): void => {
    setWantedSidebarWidth(clampSidebarWidth(next));
  };
  /** The settled value: below the threshold it snaps to the rail instead. */
  const commitSidebarWidth = (next: number): void => {
    if (next < SIDEBAR_COLLAPSE_THRESHOLD) {
      setCollapsed(true);
      writeSidebarCollapsed(true);
      return;
    }
    const width = clampSidebarWidth(next);
    setWantedSidebarWidth(width);
    writeSidebarWidth(width);
  };

  /** Every zone is a card: surface wash over the page background, radius 8. */
  const card: React.CSSProperties = {
    borderRadius: 8,
    backgroundColor: foregroundWash(scheme, 0.05),
    overflow: "hidden",
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  };

  const outer: React.CSSProperties = desktop
    ? {
        flex: "1 1 0%",
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr) ${panelWidth}px`,
        gridTemplateRows: `${TOPBAR_HEIGHT}px minmax(0, 1fr) ${TRANSPORT_HEIGHT}px`,
        gridTemplateAreas: `"topbar topbar topbar" "sidebar main rightpanel" "player player player"`,
        gap: GAP,
        padding: GAP,
        boxSizing: "border-box",
        backgroundColor: tokens.background,
      }
    : // Mobile shell: a transparent flex pass-through. Same element, same
      // children, zero visual contribution.
      { flex: "1 1 0%", minHeight: 0, display: "flex", flexDirection: "column" };

  const main: React.CSSProperties = desktop
    ? { ...card, gridArea: "main" }
    : { flex: "1 1 0%", minHeight: 0, display: "flex", flexDirection: "column" };

  // The plan's content-max: the main content stops growing at 1600px and
  // centers. Only meaningful on desktop; on mobile the cap can never bind,
  // but keeping the element mounted keeps the navigator alive across the
  // breakpoint.
  const contentMax: React.CSSProperties = desktop
    ? {
        flex: "1 1 0%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        width: "100%",
        maxWidth: BREAKPOINTS.contentMax,
        margin: "0 auto",
      }
    : { flex: "1 1 0%", minHeight: 0, display: "flex", flexDirection: "column" };

  return (
    <div style={outer}>
      {desktop ? (
        <DesktopShortcuts
          key="shortcuts"
          panelAvailable={panelWide}
          onToggleTenant={toggleTenant}
          onToggleSidebar={toggleSidebar}
          onToggleShortcutsOverlay={() => setShortcutsOpen((current) => !current)}
        />
      ) : null}
      {desktop ? (
        <ShortcutsOverlay
          key="shortcuts-overlay"
          visible={shortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
        />
      ) : null}
      {desktop ? (
        // overflow visible + zIndex, unlike the other cards: the search
        // typeahead hangs BELOW this row, and later grid siblings (main)
        // would otherwise paint over it.
        <div key="topbar" style={{ ...card, gridArea: "topbar", overflow: "visible", zIndex: 30 }}>
          <DesktopTopBar />
        </div>
      ) : null}
      {desktop ? (
        // Wrapper, not the card itself: the resizer must live in the grid
        // GAP (right: -8) and the card's overflow:hidden would clip it there.
        <div
          key="sidebar"
          style={{
            gridArea: "sidebar",
            position: "relative",
            display: "flex",
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <div style={{ ...card, flex: "1 1 0%" }}>
            <DesktopSidebar collapsed={collapsed} onToggleCollapsed={toggleSidebar} />
          </div>
          {collapsed ? null : (
            <PanelResizer
              side="left"
              width={expandedSidebarWidth}
              // The drag floor sits BELOW the usable minimum on purpose: the
              // stretch between rail and minimum is the dead zone a release
              // inside of snaps to the collapsed rail (commitSidebarWidth).
              min={SIDEBAR_RAIL_WIDTH}
              max={sidebarMax}
              gap={GAP}
              label={t("native.desktop.resizeSidebar")}
              onResize={resizeSidebar}
              onCommit={commitSidebarWidth}
            />
          )}
        </div>
      ) : null}
      <div key="main" style={main}>
        <div style={contentMax}>
          <View
            style={{ flex: 1 }}
            onLayout={(event) => setMainWidth(Math.round(event.nativeEvent.layout.width))}
          >
            <ContainerWidthProvider width={mainWidth > 0 ? mainWidth : windowWidth}>
              {children}
            </ContainerWidthProvider>
          </View>
        </div>
      </div>
      {desktop ? (
        // Wrapper, not the card itself: the resizer must live in the grid
        // GAP (left: -8) and the card's overflow:hidden would clip it there.
        <div
          key="rightpanel"
          style={{
            gridArea: "rightpanel",
            position: "relative",
            display: "flex",
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <div style={{ ...card, flex: "1 1 0%" }}>
            <DesktopRightPanel
              wide={panelWide}
              open={panelWide && panelOpen}
              tenant={panelTenant}
              width={panelWidth}
              onSelectTenant={selectTenant}
              onClose={() => setPanelOpenPersisted(false)}
            />
          </div>
          {panelWide && panelOpen ? (
            <PanelResizer
              width={panelColumnWidth}
              min={RIGHT_PANEL_MIN_WIDTH}
              max={Math.max(
                RIGHT_PANEL_MIN_WIDTH,
                rightPanelWidthCeiling(windowWidth, sidebarWidth, GAP),
              )}
              gap={GAP}
              label={t("native.desktop.resizePanel")}
              onResize={setWantedPanelWidth}
              onCommit={(width) => {
                setWantedPanelWidth(width);
                writeRightPanelWidth(width);
              }}
            />
          ) : null}
        </div>
      ) : null}
      {desktop ? (
        <div key="player" style={{ ...card, gridArea: "player" }}>
          <DesktopTransportBar
            panelAvailable={panelWide}
            panelOpen={panelOpen}
            activeTenant={panelTenant}
            onToggleTenant={toggleTenant}
            onTogglePanel={togglePanel}
          />
        </div>
      ) : null}
    </div>
  );
};
