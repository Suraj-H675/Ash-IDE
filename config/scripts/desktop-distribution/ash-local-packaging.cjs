const RELEASE_FLAGS = [
  'ASH_MAC_RELEASE',
  'ASH_WIN_RELEASE',
  'ORCA_MAC_RELEASE',
  'ORCA_WIN_RELEASE',
  'ORCA_MAC_HOURLY',
  'ORCA_MAC_DAILY',
  'ORCA_MAC_ADHOC',
  'ORCA_WIN_HOURLY',
  'ORCA_WIN_DAILY',
  'ORCA_WIN_ADHOC',
  'ORCA_COMPUTER_MACOS_SIGN_IDENTITY',
  'ORCA_WIN_UNINSTALLER_EXPORT_PATH',
  'ORCA_WIN_UNINSTALLER_SIGNED_PATH'
]
const SIGNING_INPUTS = [
  'CSC_LINK',
  'CSC_NAME',
  'CSC_KEYCHAIN',
  'CSC_INSTALLER_LINK',
  'WIN_CSC_LINK',
  'WIN_CSC_NAME'
]

function assertAshLocalPackaging(env, platform) {
  if (RELEASE_FLAGS.some((name) => env[name])) {
    throw new Error(
      'Signed release packaging is unavailable until Ash has an approved signing identity.'
    )
  }
  if ((platform === 'darwin' || platform === 'win32') && SIGNING_INPUTS.some((name) => env[name])) {
    throw new Error(
      'Local Ash packaging requires a build environment without release signing inputs.'
    )
  }
}

module.exports = { assertAshLocalPackaging }
