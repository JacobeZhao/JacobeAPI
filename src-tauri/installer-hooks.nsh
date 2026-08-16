!include "FileFunc.nsh"
!include "LogicLib.nsh"

Var JacobeCurrentDir
Var JacobeLegacyDir
Var JacobeLegacyMigrated

!macro JACOBE_ABORT_INSTALL MESSAGE
  IfSilent +2
  MessageBox MB_OK|MB_ICONSTOP "${MESSAGE}"
  SetErrorLevel 2
  Abort
!macroend

!macro NSIS_HOOK_PREINSTALL
  StrCpy $JacobeLegacyMigrated "0"

  ReadRegStr $JacobeCurrentDir HKCU "Software\jacobe\JacobeAPI" ""
  ${If} $JacobeCurrentDir == ""
    ReadRegStr $JacobeCurrentDir HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JacobeAPI" "InstallLocation"
  ${EndIf}

  ReadRegStr $JacobeLegacyDir HKCU "Software\jacobe\Jacobe Skills" ""
  ${If} $JacobeLegacyDir == ""
    ReadRegStr $JacobeLegacyDir HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jacobe Skills" "InstallLocation"
  ${EndIf}

  ${If} $JacobeCurrentDir != ""
  ${AndIf} $JacobeLegacyDir != ""
  ${AndIf} $JacobeCurrentDir != $JacobeLegacyDir
    !insertmacro JACOBE_ABORT_INSTALL "JacobeAPI and the legacy Jacobe Skills installation point to different folders. Uninstall one of them before continuing. No files were changed."
  ${EndIf}

  ${If} $JacobeLegacyDir != ""
    ${IfNot} ${FileExists} "$JacobeLegacyDir\uninstall.exe"
      !insertmacro JACOBE_ABORT_INSTALL "The legacy Jacobe Skills installation is incomplete because uninstall.exe is missing. Repair or remove it before installing JacobeAPI."
    ${EndIf}
    ${IfNot} ${FileExists} "$JacobeLegacyDir\jacobe-skills.exe"
      !insertmacro JACOBE_ABORT_INSTALL "The legacy Jacobe Skills installation is incomplete because jacobe-skills.exe is missing. Repair or remove it before installing JacobeAPI."
    ${EndIf}

    StrCpy $INSTDIR $JacobeLegacyDir
    SetOutPath "$INSTDIR"
    StrCpy $JacobeLegacyMigrated "1"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $JacobeLegacyMigrated == "1"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jacobe Skills"
    DeleteRegKey HKCU "Software\jacobe\Jacobe Skills"
    Delete "$DESKTOP\Jacobe Skills.lnk"
    Delete "$SMPROGRAMS\Jacobe Skills.lnk"
    Delete "$SMPROGRAMS\Jacobe Skills\Jacobe Skills.lnk"
    RMDir "$SMPROGRAMS\Jacobe Skills"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${GetOptions} $CMDLINE "/UPDATE" $0
  ${If} ${Errors}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Jacobe Skills"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Jacobe Skills"
  ${EndIf}

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jacobe Skills"
  DeleteRegKey HKCU "Software\jacobe\Jacobe Skills"
  Delete "$DESKTOP\Jacobe Skills.lnk"
  Delete "$SMPROGRAMS\Jacobe Skills.lnk"
  Delete "$SMPROGRAMS\Jacobe Skills\Jacobe Skills.lnk"
  RMDir "$SMPROGRAMS\Jacobe Skills"
!macroend
