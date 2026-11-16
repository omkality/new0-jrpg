declare const __ASSET_REVISION__: string;
declare const __CLIENT_REVISION__: string;
export const ASSET_REVISION = __ASSET_REVISION__;
export const CLIENT_REVISION = __CLIENT_REVISION__;
// Content hash is injected by Vite, so replaced public GLBs cannot remain stale for a day.
export const assetUrl = (path: string) => `${path}?v=${__ASSET_REVISION__}`;
