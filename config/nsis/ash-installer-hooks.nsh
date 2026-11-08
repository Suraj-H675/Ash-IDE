; Ash IDE standalone Windows installer integration.
; Derived from stablyai/orca commit 55697aec, config/nsis/orca-installer-hooks.nsh.
; Copyright (c) 2026 Lovecast Inc.; MIT License (repository LICENSE).
; Keeps only the additive Open With registration scheme.
; Keep default document handlers and all other applications' installations unchanged.
; Uninstall preserves Ash user data, local runtime sessions, Orca daemons, and
; provider-global hook configuration. Reset Ash Data is a separate workflow.

!include "${__FILEDIR__}\ash-user-path-cleanup.nsh"

!define ASH_MARKDOWN_PROGID "AshIDE.Markdown"
!define ASH_TABULAR_PROGID "AshIDE.Tabular"

!macro ASH_REGISTER_DOCUMENT_OPEN_WITH EXT PROGID
  WriteRegNone SHELL_CONTEXT "Software\Classes\${EXT}\OpenWithProgids" "${PROGID}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" "${EXT}" ""
!macroend

!macro ASH_UNREGISTER_DOCUMENT_OPEN_WITH EXT PROGID
  DeleteRegValue SHELL_CONTEXT "Software\Classes\${EXT}\OpenWithProgids" "${PROGID}"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" "${EXT}"
!macroend

!macro ASH_REGISTER_DOCUMENT_PROGID PROGID NAME
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}" "" "${NAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\shell\open" "" "Open with ${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\shell\open\command" "" '"$appExe" "%1"'
!macroend

!macro customInstall
  !insertmacro ASH_REGISTER_DOCUMENT_PROGID "${ASH_MARKDOWN_PROGID}" "Markdown Document"
  !insertmacro ASH_REGISTER_DOCUMENT_PROGID "${ASH_TABULAR_PROGID}" "Tabular Document"
  !insertmacro ASH_REGISTER_DOCUMENT_OPEN_WITH ".md" "${ASH_MARKDOWN_PROGID}"
  !insertmacro ASH_REGISTER_DOCUMENT_OPEN_WITH ".markdown" "${ASH_MARKDOWN_PROGID}"
  !insertmacro ASH_REGISTER_DOCUMENT_OPEN_WITH ".mdx" "${ASH_MARKDOWN_PROGID}"
  !insertmacro ASH_REGISTER_DOCUMENT_OPEN_WITH ".csv" "${ASH_TABULAR_PROGID}"
  !insertmacro ASH_REGISTER_DOCUMENT_OPEN_WITH ".tsv" "${ASH_TABULAR_PROGID}"
  System::Call "shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)"
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; Remove only the exact CLI directory belonging to this Ash installation.
    ; Never kill host/agent processes, or delete app data or provider configs.
    !insertmacro ASH_REMOVE_USER_PATH_ENTRY "$INSTDIR\resources\bin"
  ${endIf}
  ; Old-version uninstallation is also called during an update: the new Ash
  ; installation will immediately recreate the additive associations.
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${ASH_MARKDOWN_PROGID}"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${ASH_TABULAR_PROGID}"
  !insertmacro ASH_UNREGISTER_DOCUMENT_OPEN_WITH ".md" "${ASH_MARKDOWN_PROGID}"
  !insertmacro ASH_UNREGISTER_DOCUMENT_OPEN_WITH ".markdown" "${ASH_MARKDOWN_PROGID}"
  !insertmacro ASH_UNREGISTER_DOCUMENT_OPEN_WITH ".mdx" "${ASH_MARKDOWN_PROGID}"
  !insertmacro ASH_UNREGISTER_DOCUMENT_OPEN_WITH ".csv" "${ASH_TABULAR_PROGID}"
  !insertmacro ASH_UNREGISTER_DOCUMENT_OPEN_WITH ".tsv" "${ASH_TABULAR_PROGID}"
  System::Call "shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)"
!macroend
