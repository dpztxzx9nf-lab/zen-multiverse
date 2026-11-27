; After the 0.2.34 rename to Xenia, a previous install may still sit in
; %LOCALAPPDATA%\Zen Multiverse with a Start Menu or Desktop shortcut of that
; name. Remove only that leftover app folder and those shortcuts.
; Saves and updater logs live under io.thinkcore.zenmultiverse and must stay.

!macro NSIS_HOOK_POSTINSTALL
  StrCpy $R9 "$LOCALAPPDATA\Zen Multiverse"
  ${If} ${FileExists} "$R9\zen-multiverse.exe"
    ${If} $INSTDIR != $R9
      RMDir /r "$R9"
    ${EndIf}
  ${EndIf}
  Delete "$SMPROGRAMS\Zen Multiverse.lnk"
  Delete "$APPDATA\Microsoft\Windows\Start Menu\Programs\Zen Multiverse.lnk"
  Delete "$DESKTOP\Zen Multiverse.lnk"
!macroend
