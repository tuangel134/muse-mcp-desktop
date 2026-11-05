/**
 * Borrados permitidos: `rm`, `rmdir`, `unlink` y `find … -delete` se aceptan cuando el objetivo NO es (ni contiene)
 * una parte importante del sistema o de la carpeta personal. Todo lo demás sigue clasificándose como peligroso.
 * Solo Linux/macOS: en Windows nunca se rebaja el riesgo de un borrado.
 */
import { homedir } from 'node:os';
import { isAbsolute, basename, dirname, join, normalize } from 'node:path';

export const DELETE_REASONS: ReadonlySet<string> = new Set([
	'deletes files recursively', 'deletes files', 'removes files or directories', 'deletes files with find'
]);

interface Lists { home: string; exactOrParent: string[]; whole: string[]; system: string[] }

function lists(): Lists {
	const home = process.env['HOME'] || homedir();
	const j = (...p: string[]): string => join(home, ...p);
	const extra = (process.env['MUSE_MCP_PROTECTED'] || '').split(':').filter(Boolean);
	return {
		home,
		// El objetivo no puede ser esta ruta ni algo que la contenga.
		exactOrParent: ['/', '/home', '/tmp', '/var/tmp', home, ...['.config', '.local', '.local/share', '.local/bin', '.cache', 'Documents', 'Documentos', 'Downloads', 'Descargas', 'Desktop', 'Escritorio', 'Pictures', 'Imágenes', 'Music', 'Música', 'Videos', 'Vídeos'].map((d) => j(d))],
		// El objetivo no puede ser esta ruta, algo que la contenga, ni nada dentro de ella.
		whole: [...['.ssh', '.gnupg', '.password-store', '.config/systemd'].map((d) => j(d)), ...extra],
		system: ['/usr', '/etc', '/boot', '/var', '/bin', '/sbin', '/lib', '/lib64', '/opt', '/root', '/srv', '/mnt', '/media', '/sys', '/proc', '/dev', '/run', '/snap', '/System', '/Library', '/Applications', '/private']
	};
}

const under = (a: string, b: string): boolean => b === a || b.startsWith(a === '/' ? '/' : a + '/'); // b está dentro de a (o es a)

function targetIsProtected(target: string): boolean {
	const { home, exactOrParent, whole, system } = lists();
	let t = target;
	// Rutas armadas con variables o sustituciones no se pueden verificar: se tratan como protegidas.
	if (/[`]|\$\(/.test(t) || /\$\{?[A-Za-z_]/.test(t.replace(/^\$HOME/, '').replace(/^\$\{HOME\}/, ''))) return true;
	if (t === '~' || t.startsWith('~/')) t = home + t.slice(1);
	else if (t.startsWith('$HOME')) t = home + t.slice(5);
	else if (t.startsWith('${HOME}')) t = home + t.slice(7);
	else if (t.startsWith('~')) return true;
	if (!isAbsolute(t)) {
		// Relativa: no se conoce el directorio actual; se bloquea lo que vacía o sale de él.
		if (/(^|\/)\.\.(\/|$)/.test(t)) return true;
		const b = basename(t);
		return b === '.' || /^[*?.[\]!^-]+$/.test(b) || t.endsWith('/');
	}
	if (/^[*?.[\]!^-]+$/.test(basename(t))) t = dirname(t); // «dir/*» vacía dir
	t = normalize(t).replace(/\/+$/, '') || '/';
	if (exactOrParent.some((p) => under(t, p))) return true;
	if (whole.some((p) => under(t, p) || under(p, t))) return true;
	if (system.some((p) => under(p, t) || under(t, p))) return true;
	return false;
}

function words(segment: string): string[] {
	const out: string[] = [];
	let cur = '', q: string | null = null, has = false;
	for (const ch of segment) {
		if (q) { if (ch === q) q = null; else cur += ch; continue; }
		if (ch === "'" || ch === '"') { q = ch; has = true; continue; }
		if (/\s/.test(ch)) { if (cur || has) out.push(cur); cur = ''; has = false; continue; }
		cur += ch;
	}
	if (cur || has) out.push(cur);
	return out;
}

/** true si el segmento es un borrado cuyos objetivos son todos seguros (verificables y no protegidos). */
export function deletionIsSafe(segment: string): boolean {
	if (process.platform === 'win32') return false;
	if (/[|<>]|&&|;|\$\(|`/.test(segment)) return false;
	const w = words(segment);
	let i = 0;
	while (i < w.length && /^(nohup|time|command|env|nice)$/.test(w[i]!)) i++;
	const cmd = w[i];
	const rest = w.slice(i + 1);
	if (cmd === 'rm' || cmd === 'rmdir' || cmd === 'unlink') {
		if (rest.includes('--no-preserve-root')) return false;
		const targets = rest.filter((x) => !x.startsWith('-') || x === '-');
		return targets.length > 0 && targets.every((t) => !targetIsProtected(t));
	}
	if (cmd === 'find') {
		const roots: string[] = [];
		for (const x of rest) { if (x.startsWith('-') || x === '(' || x === '!') break; roots.push(x); }
		return roots.length > 0 && roots.every((t) => !targetIsProtected(t));
	}
	return false;
}
