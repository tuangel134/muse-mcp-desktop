#!/usr/bin/env bash
# Instala Muse MCP Desktop como app de usuario en Linux (sin sudo): copia la app a ~/.local/opt, crea el lanzador
# ~/.local/bin/muse-mcp-desktop y la entrada del menú. Usa el Electron del sistema (electron, electron43, electron42…).
# Para desinstalar: scripts/install-linux.sh --uninstall
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREFIX="${MUSE_MCP_PREFIX:-$HOME/.local/opt/muse-mcp-desktop}"
BIN="$HOME/.local/bin/muse-mcp-desktop"
DESKTOP="$HOME/.local/share/applications/muse-mcp-desktop.desktop"
ICON="$HOME/.local/share/icons/hicolor/512x512/apps/muse-mcp-desktop.png"

if [ "${1:-}" = "--uninstall" ]; then
    rm -rf "$PREFIX"; rm -f "$BIN" "$DESKTOP" "$ICON"
    command -v update-desktop-database >/dev/null && update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
    echo "Desinstalada. Tus datos siguen en ~/.config/muse-mcp-desktop (bórralos a mano si quieres)."
    exit 0
fi

ELECTRON=""
for c in electron electron45 electron44 electron43 electron42 electron41 electron40; do
    if command -v "$c" >/dev/null 2>&1; then ELECTRON="$(command -v "$c")"; break; fi
done
[ -n "$ELECTRON" ] || { echo "No encuentro Electron. Instálalo (p. ej. 'sudo pacman -S electron') o usa el AppImage de Releases." >&2; exit 1; }

[ -f "$SRC/host/host.cjs" ] || (cd "$SRC" && node scripts/build-host.mjs)
[ -d "$SRC/node_modules/@ngrok" ] || { echo "Falta node_modules/@ngrok: ejecuta 'npm install --ignore-scripts' en $SRC" >&2; exit 1; }

rm -rf "$PREFIX"
mkdir -p "$PREFIX/host" "$PREFIX/node_modules"
cp -r "$SRC/electron" "$SRC/panel" "$SRC/prompts" "$PREFIX/"
cp "$SRC/host/host.cjs" "$PREFIX/host/"
cp "$SRC/package.json" "$SRC/LICENSE" "$SRC/LICENSE-TESSARION-MasterMCP-Lite" "$SRC/THIRD_PARTY.md" "$PREFIX/"
cp -r "$SRC/node_modules/@ngrok" "$PREFIX/node_modules/"

mkdir -p "$(dirname "$BIN")" "$(dirname "$DESKTOP")" "$(dirname "$ICON")"
cp "$SRC/build/icon.png" "$ICON"
cat > "$BIN" <<LAUNCH
#!/usr/bin/env bash
exec "$ELECTRON" "$PREFIX" --ozone-platform-hint=auto "\$@"
LAUNCH
chmod +x "$BIN"
cat > "$DESKTOP" <<ENTRY
[Desktop Entry]
Type=Application
Version=1.0
Name=Muse MCP Desktop
GenericName=Muse con Master MCP
Comment=Muse y el gestor de Master MCP en una sola app
Exec=$BIN %U
Icon=muse-mcp-desktop
Terminal=false
Categories=Network;
Keywords=Muse;Meta;IA;MCP;Master MCP;
StartupWMClass=muse-mcp-desktop
StartupNotify=true
ENTRY
command -v update-desktop-database >/dev/null && update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
echo "Instalada en $PREFIX. Ábrela desde el menú («Muse MCP Desktop») o con: muse-mcp-desktop"
