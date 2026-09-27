# Updater runbook

Calcool updates via the Tauri v2 updater plugin, manual-only: the user clicks
"Check for updates" in Settings, reviews the release notes, then clicks
Install. Nothing checks, downloads, or installs on its own.

## Moving parts

- Endpoint: `https://github.com/ShreyanshVaibhaw/Calcool/releases/latest/download/latest.json`
  (see `plugins.updater.endpoints` in `src-tauri/tauri.conf.json`).
- Public key: `plugins.updater.pubkey` in the same file (minisign format).
  The updater verifies every artifact against it before installing.
- UI: `src/useAppUpdater.ts` + the settings update row. Install failures and
  signature failures land on the `error` phase and stay there; install never
  retries by itself.

## Outcomes matrix (manual check)

| Situation | UX |
|---|---|
| Newer signed release | `available` phase, release notes shown, Install button |
| Already current | "Calcool is up to date." |
| Offline / DNS / timeout / 5xx | "Couldn't reach the update server. Check your connection and retry." |
| Bad/missing signature | "The update signature could not be verified. Nothing was installed." |
| Stale `latest.json` (older version) | Treated as current (plugin compares versions) |
| Anything else | Raw plugin error via "Could not check for updates. …" |

## Key rotation

1. Generate a new keypair: `npx tauri signer generate -w <keyfile>`.
   The private key stays on the release machine (or CI secret) — never commit it.
2. Replace `plugins.updater.pubkey` in `tauri.conf.json` with the new public key.
3. Sign release artifacts with the new private key when publishing.
4. Rotation window: clients on the old build verify with the old key, so the
   release that carries the new pubkey must itself be signed with the OLD key;
   only the release after that can switch to the new signing key.

## Testing a release without surprising users

1. Build a test version with a bumped `version` in `tauri.conf.json`.
2. Publish a **draft** GitHub release with `latest.json` + signed artifacts.
3. Point a local `tauri.conf.json` copy at the draft download URL, run the
   installed app, and walk the matrix above (pull the network cable for the
   offline row, corrupt one byte of an artifact for the signature row).
4. Verify no private key material is in the repo:
   `grep -rin -E "private[_ -]?key|secret|password" src-tauri/tauri.conf.json src-tauri/src src-tauri/capabilities`
