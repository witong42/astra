import metadata from "../package.json";

export const APP_VERSION = metadata.version;
export const APP_BUILD = metadata.astraBuild;
export const APP_RELEASE = `Astra ${APP_VERSION} · build ${APP_BUILD}`;
