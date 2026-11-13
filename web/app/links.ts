const repository = 'https://github.com/xmili233/polaris';
export const links = {
  repository,
  guide: `${repository}/blob/main/docs/app-guide.md`,
  boundaries: `${repository}/blob/main/SECURITY.md#execution-and-data-boundaries`,
  license: `${repository}/blob/main/LICENSE`,
  // Release assets keep version-free names, so these always resolve to the newest published release.
  download: {
    arm64: `${repository}/releases/latest/download/Polaris-macOS-arm64.dmg`,
    x64: `${repository}/releases/latest/download/Polaris-macOS-x64.dmg`,
  },
};
