# Muse MCP Desktop

**Muse + Master MCP en una sola app de escritorio (Linux y Windows).**
Abres la app, pones tu credencial de ngrok, copias un prompt y se lo das a Muse: Muse se conecta sola a tu equipo y te
guía con el resto. El Master MCP (archivos, búsqueda, git, terminal y navegador, con permisos que tú apruebas) vive
dentro de la app; no hace falta instalar ni configurar nada más.

> Proyecto independiente y de código abierto. **No está afiliado ni respaldado por Meta.** La app solo abre el sitio
> web público de Muse en su propia ventana; necesitas tu propia cuenta de Muse. «Muse» y su logotipo son marcas de Meta
> (ver `THIRD_PARTY.md`).

> ⚠️ **Windows: beta, sin probar.** Los instaladores de Windows se generan en GitHub Actions y el autor no ha podido
> probarlos en un equipo Windows real. En Windows no hay sandbox para la terminal: solo funciona con el permiso
> «Terminal del host». Si encuentras fallos, abre un issue. Linux está probado.

## Cómo se usa

1. Instala la app (AppImage o `.deb` en Linux; instalador `.exe` o `.zip` en Windows, desde *Releases*).
2. Abre la app. A la izquierda está Muse (inicia sesión como siempre); a la derecha, el panel **Master MCP**
   (se abre/cierra con `Ctrl+Mayús+M`).
3. En el panel, sigue los cuatro pasos de **Configurar con Muse**:
   1. Añade una **carpeta de trabajo** (lo único que Muse podrá ver).
   2. Pega tu **authtoken de ngrok** y pulsa **Guardar e iniciar**. Es gratis: crea una cuenta en <https://ngrok.com>
      y copia el token de *Your Authtoken*. El token se guarda cifrado en tu equipo.
   3. Pulsa **Copiar prompt para Muse** (o **Pegar el prompt en Muse**) y envíaselo a Muse.
   4. Muse se conecta a la URL pública; llegará una **solicitud pendiente** al panel. Tú eliges carpetas y permisos y
      pulsas **Aceptar**. Nada se aprueba solo.

> Nunca le des tu token de ngrok a Muse por el chat. Solo se escribe en el panel de la app.

## Seguridad

- El Master MCP escucha solo en `127.0.0.1`; la API de gestión usa un token aleatorio que solo conoce el proceso
  principal de la app (la página del panel y Muse nunca lo ven) y rechaza cualquier petición con cabecera `Origin`.
- Lo público es únicamente el endpoint MCP protegido con **OAuth 2.1 (registro dinámico + PKCE)**. Cada conexión pide
  aprobación manual, por carpeta y por permiso, y se puede revocar en cualquier momento.
- Permisos de riesgo elevado (terminal del host, sudo, SSH, Docker, sistema, dispositivos) vienen **apagados**.
- La terminal clasifica cada comando antes de ejecutarlo. Se permiten lecturas, ediciones y borrados normales dentro de
  carpetas de trabajo; se rechazan `chmod/chown` amplios, `curl | sh`, `git push`, y borrar `/`, tu carpeta personal,
  `~/.ssh`, `~/.config`, el sistema, etc. `sudo` y los gestores de paquetes se desbloquean con el permiso **Solicitar
  sudo**, y `dd`/`mkfs`/`fdisk` con **Sistema y discos** (ambos apagados por defecto y solo con «Terminal del host»). En Linux los
  comandos corren dentro de un sandbox (`bubblewrap`, instálalo con tu gestor de paquetes si falta).
- Una IA conectada puede actuar con tus permisos dentro de lo que apruebes: concede lo mínimo que necesites.
  El software se ofrece **sin garantía** (ver `LICENSE`).

## Desarrollo

```bash
npm install
npm start            # compila host/host.cjs y abre la app
npm test             # pruebas del clasificador y del host
node host/tests/e2e.mjs   # E2E OAuth + MCP con estado temporal (no toca nada real)
npm run dist         # empaqueta para tu sistema (electron-builder)
```

- `electron/`: proceso principal (ventana, panel, proceso hijo del Master MCP, IPC). `panel/`: interfaz del gestor.
- `host/src`: Master MCP (TypeScript). `npm run build:host` lo empaqueta en `host/host.cjs` con esbuild.
- `prompts/setup-prompt.md`: el prompt que se le da a Muse; edítalo para ajustar la configuración guiada.
- Variables útiles: `MUSE_URL` (otra URL en vez de muse.ai), `MUSE_MCP_DISPLAY` (abrir en el monitor cuyo nombre lo
  contenga), `MUSE_MCP_BROWSER` (navegador Chromium para las herramientas de navegador).

## English summary

Muse MCP Desktop is an Electron app that shows Meta's Muse web app next to a built-in Master MCP manager
(folders, permissions, ngrok tunnel, OAuth approvals). Add a workspace folder, paste your ngrok authtoken, copy the
generated setup prompt into Muse, and approve the connection request in the side panel. Unofficial and not affiliated
with Meta. Linux is tested; **Windows builds come from GitHub Actions and are beta/untested**. MIT licensed; the MCP
core derives from Tessarion MasterMCP Lite (MIT), see `THIRD_PARTY.md`.
