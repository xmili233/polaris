// Validates a release before anything is built. Pure: reads only the values passed in.
export const releaseArchitectures = ['arm64', 'x64'];
export const assetName = arch => `Polaris-macOS-${arch}.dmg`;

export function releasePlan({ env, args, version }) {
  const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  const problems = [];
  const tag = option('--tag');
  if (tag !== undefined && tag !== `v${version}`) problems.push(`Tag ${tag} does not match desktop/package.json version ${version}; expected v${version}.`);
  const arches = args.includes('--arch') ? args.flatMap((value, index) => args[index - 1] === '--arch' ? [value] : []) : releaseArchitectures;
  for (const arch of arches) if (!releaseArchitectures.includes(arch)) problems.push(`Unsupported architecture: ${arch}.`);
  const identity = env.POLARIS_SIGN_IDENTITY ?? '';
  if (!identity.startsWith('Developer ID Application:')) problems.push('POLARIS_SIGN_IDENTITY must name a "Developer ID Application" certificate.');
  // Local dry runs may skip Apple's notary service; the release workflow never passes this flag.
  const notarize = !args.includes('--no-notarize');
  let notary = [];
  if (notarize) {
    if (env.POLARIS_NOTARY_PROFILE) notary = ['--keychain-profile', env.POLARIS_NOTARY_PROFILE];
    else if (env.POLARIS_NOTARY_KEY && env.POLARIS_NOTARY_KEY_ID && env.POLARIS_NOTARY_ISSUER)
      notary = ['--key', env.POLARIS_NOTARY_KEY, '--key-id', env.POLARIS_NOTARY_KEY_ID, '--issuer', env.POLARIS_NOTARY_ISSUER];
    // An app-specific password needs no App Store Connect access and can be revoked on its own.
    else if (env.POLARIS_NOTARY_APPLE_ID && env.POLARIS_NOTARY_TEAM_ID && env.POLARIS_NOTARY_PASSWORD)
      notary = ['--apple-id', env.POLARIS_NOTARY_APPLE_ID, '--team-id', env.POLARIS_NOTARY_TEAM_ID, '--password', env.POLARIS_NOTARY_PASSWORD];
    else problems.push('Notarization needs POLARIS_NOTARY_PROFILE, an App Store Connect API key (POLARIS_NOTARY_KEY, POLARIS_NOTARY_KEY_ID, POLARIS_NOTARY_ISSUER), or an app-specific password (POLARIS_NOTARY_APPLE_ID, POLARIS_NOTARY_TEAM_ID, POLARIS_NOTARY_PASSWORD).');
  }
  if (problems.length) throw new Error(`Release cannot start:\n- ${problems.join('\n- ')}`);
  return { version, identity, arches: [...new Set(arches)], notarize, notary, assets: [...new Set(arches)].map(assetName) };
}
