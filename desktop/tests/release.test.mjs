import test from 'node:test';
import assert from 'node:assert/strict';
import { assetName, releasePlan } from '../scripts/release-config.mjs';

const identity = 'Developer ID Application: Example (TEAM123456)';
const keys = { POLARIS_NOTARY_KEY: '/tmp/AuthKey.p8', POLARIS_NOTARY_KEY_ID: 'KEY', POLARIS_NOTARY_ISSUER: 'ISSUER' };

test('a release builds both architectures with version-free asset names', () => {
  const plan = releasePlan({ env: { POLARIS_SIGN_IDENTITY: identity, ...keys }, args: ['--tag', 'v0.1.0'], version: '0.1.0' });
  assert.deepEqual(plan.arches, ['arm64', 'x64']);
  assert.deepEqual(plan.assets, ['Polaris-macOS-arm64.dmg', 'Polaris-macOS-x64.dmg']);
  assert.deepEqual(plan.notary, ['--key', '/tmp/AuthKey.p8', '--key-id', 'KEY', '--issuer', 'ISSUER']);
  assert.equal(assetName('x64'), 'Polaris-macOS-x64.dmg');
});

test('a keychain profile can replace the API key, and one architecture can be chosen', () => {
  const plan = releasePlan({ env: { POLARIS_SIGN_IDENTITY: identity, POLARIS_NOTARY_PROFILE: 'polaris' }, args: ['--arch', 'arm64'], version: '0.1.0' });
  assert.deepEqual(plan.arches, ['arm64']);
  assert.deepEqual(plan.notary, ['--keychain-profile', 'polaris']);
});

test('an app-specific password notarizes without App Store Connect access', () => {
  const plan = releasePlan({ env: { POLARIS_SIGN_IDENTITY: identity, POLARIS_NOTARY_APPLE_ID: 'dev@example.com', POLARIS_NOTARY_TEAM_ID: 'TEAM123456', POLARIS_NOTARY_PASSWORD: 'abcd-efgh-ijkl-mnop' }, args: [], version: '0.1.0' });
  assert.deepEqual(plan.notary, ['--apple-id', 'dev@example.com', '--team-id', 'TEAM123456', '--password', 'abcd-efgh-ijkl-mnop']);
});

test('a release refuses a mismatched tag, ad-hoc signing, missing notary credentials and unknown architectures', () => {
  assert.throws(() => releasePlan({ env: { POLARIS_SIGN_IDENTITY: identity, ...keys }, args: ['--tag', 'v0.2.0'], version: '0.1.0' }), /does not match/);
  assert.throws(() => releasePlan({ env: { POLARIS_SIGN_IDENTITY: '-', ...keys }, args: [], version: '0.1.0' }), /Developer ID Application/);
  assert.throws(() => releasePlan({ env: { POLARIS_SIGN_IDENTITY: identity, POLARIS_NOTARY_KEY: '/tmp/k.p8' }, args: [], version: '0.1.0' }), /Notarization needs/);
  assert.throws(() => releasePlan({ env: { POLARIS_SIGN_IDENTITY: identity, ...keys }, args: ['--arch', 'ppc'], version: '0.1.0' }), /Unsupported architecture/);
  // A local dry run may skip notarization, but never signing.
  const dry = releasePlan({ env: { POLARIS_SIGN_IDENTITY: identity }, args: ['--no-notarize'], version: '0.1.0' });
  assert.equal(dry.notarize, false);
});
