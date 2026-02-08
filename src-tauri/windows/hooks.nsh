!macro NSIS_HOOK_POSTINSTALL
  ; Overwrite shortcuts to use icon.ico instead of exe icon (avoids Windows icon cache issues)
  CreateShortCut "$SMPROGRAMS\${MAINBINARYNAME}\${MAINBINARYNAME}.lnk" \
                 "$INSTDIR\${MAINBINARYNAME}.exe" \
                 "" \
                 "$INSTDIR\icon.ico" \
                 0

  CreateShortCut "$DESKTOP\${MAINBINARYNAME}.lnk" \
                 "$INSTDIR\${MAINBINARYNAME}.exe" \
                 "" \
                 "$INSTDIR\icon.ico" \
                 0
!macroend
