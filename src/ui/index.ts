/**
 * WP4 UI kit public surface. Feature packages import from "@/ui".
 */
export { ActionBar, type ActionBarMenuItem, type ActionBarProps } from "./ActionBar";
export {
  BREAKPOINTS,
  collectionGridColumns,
  heroMinHeight,
  heroTitleType,
  isDesktopShellWidth,
  isRightPanelWidth,
  mainBucket,
  MOBILE_SONG_TABLE_DURATION_WIDTH,
  MOBILE_SONG_TABLE_WIDE,
  songTableColumnGate,
  songTableDurationWidth,
  topTileGridColumns,
  type HeroTitleType,
  type MainBucket,
  type SongTableColumnGate,
} from "./breakpoints";
export {
  COLLECTION_VIEW_MODES,
  DEFAULT_COLLECTION_VIEW_MODE,
  DEFAULT_LIBRARY_VIEW_MODE,
  isCollectionViewMode,
  isLibraryViewMode,
  LIBRARY_VIEW_MODES,
  type CollectionViewMode,
  type LibraryViewMode,
} from "./viewModes";
export {
  ContainerWidthProvider,
  useContainerWidth,
  useDesktopShell,
  useRightPanelWide,
  type ContainerWidthProviderProps,
} from "./shellLayout";
export { AlbumCard, type AlbumCardProps } from "./AlbumCard";
export { ArtistCard, type ArtistCardProps } from "./ArtistCard";
export {
  ArtworkImage,
  artworkSourceUri,
  type ArtworkImageProps,
  type ArtworkShape,
} from "./ArtworkImage";
export { GhostIconButton, PlayFab, type GhostIconButtonProps, type PlayFabProps } from "./buttons";
export {
  getDownloadStatusReader,
  setDownloadStatusReader,
  useDownloadStatusVersion,
  type DownloadStatusReader,
} from "./downloadStatus";
export { EmptyState, type EmptyStateProps } from "./EmptyState";
export { ErrorState, type ErrorStateProps } from "./ErrorState";
export { FilterPills, type FilterPill, type FilterPillsProps } from "./FilterPills";
export { Hero, type HeroKind, type HeroOwner, type HeroProps } from "./Hero";
export { Icon, iconForHint, iconUri, type IconName, type IconProps } from "./icons";
export { InitialsAvatar, type InitialsAvatarProps } from "./InitialsAvatar";
export { LikedArtwork, type LikedArtworkProps } from "./LikedArtwork";
export { MiniPlayerPill, type MiniPlayerPillProps } from "./MiniPlayerPill";
export {
  MixTile,
  MixTileArtwork,
  mixStampText,
  stampFontSize,
  type MixTileArtworkProps,
  type MixTileProps,
} from "./MixTile";
export { PlayingBars, type PlayingBarsProps } from "./PlayingBars";
export { Popover, type PopoverProps } from "./Popover";
export {
  popoverPlacement,
  POPOVER_MARGIN,
  type PopoverAnchor,
  type PopoverPlacement,
} from "./popoverPosition";
export { Rail, type RailProps } from "./Rail";
export {
  DEFAULT_SONG_COLUMNS,
  SONG_ROW_HEIGHT,
  SONG_ROW_HEIGHT_COMPACT,
  songRowHeight,
  SongRow,
  type SongRowColumn,
  type SongRowProps,
} from "./SongRow";
export { SongMenu, type SongMenuProps } from "./SongMenu";
export {
  SongTable,
  SongTableHeader,
  type SongTableHeaderProps,
  type SongTableProps,
} from "./SongTable";
export { StickyTitle, type StickyTitleProps } from "./StickyTitle";
export { Tile, TILE_WIDTH, type TileProps } from "./Tile";
export { StoryPager, type StoryCard } from "./StoryPager";
export { TopTileGrid, type TopTileGridProps, type TopTileItem } from "./TopTileGrid";
export { BottomSheet, type BottomSheetProps } from "./sheets/BottomSheet";
export {
  AddToPlaylistDialog,
  type AddToPlaylistDialogProps,
  type AddToPlaylistRow,
} from "./dialogs/AddToPlaylistDialog";
export { ConfirmDialog, type ConfirmDialogProps } from "./dialogs/ConfirmDialog";
export { SongCreditsDialog, type SongCreditsDialogProps } from "./dialogs/SongCreditsDialog";
export {
  CircleSkeleton,
  HeroSkeleton,
  Skeleton,
  SongRowSkeleton,
  SongTableSkeleton,
  TileSkeleton,
  type SkeletonProps,
} from "./skeletons";
export {
  backgroundVeil,
  foregroundWash,
  gradientBackground,
  heavyShadow,
  linearGradient,
  modalScrim,
  photoScrim,
  softShadow,
} from "./uiTheme";
