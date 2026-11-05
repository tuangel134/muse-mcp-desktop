/**
 * Permisos de Master MCP que desbloquean comandos críticos concretos:
 *  - «Solicitar sudo» (forja:sudo): sudo/doas/su y gestores de paquetes del sistema.
 *  - «Sistema» (forja:system-write): dd, mkfs, fdisk, parted y escritura directa a discos.
 * Solo se retiran esos hallazgos. Cualquier otro riesgo del mismo comando (rm sobre rutas protegidas, curl | sh,
 * git push --force…) se conserva y sigue exigiendo confirmación, que en Master MCP equivale a rechazo.
 */
import { RiskClass, maxRisk, type Classification, type CommandFinding } from './command-classifier.ts';

export interface PrivilegeUnlocks {
	readonly sudo: boolean;
	readonly disk: boolean;
}

const SUDO_ARG_OPTS = new Set(['-u', '-g', '-h', '-p', '-C', '-r', '-t', '-T', '-D', '-U', '--user', '--group', '--host', '--prompt', '--role', '--type', '--chdir']);

/**
 * Quita el prefijo sudo/doas (y sus opciones) de cada segmento del comando para clasificar lo que de verdad se ejecuta.
 * Sin esto, el riesgo «sudo» tapa al del propio comando (p. ej. `sudo rm -rf /usr/x` o `sudo git push --force`).
 */
export function stripSudo(command: string): string {
	return command.split(/(;|&&|\|\||\||&|\n)/).map((part, i) => {
		if (i % 2 === 1) return part;
		const lead = /^\s*/.exec(part)![0];
		const tokens = part.trim().split(/\s+/).filter(Boolean);
		if (tokens[0] !== 'sudo' && tokens[0] !== 'doas') return part;
		let k = 1;
		while (k < tokens.length && tokens[k]!.startsWith('-')) k += SUDO_ARG_OPTS.has(tokens[k]!) ? 2 : 1;
		return lead + tokens.slice(k).join(' ');
	}).join('');
}

const SUDO_REASONS = new Set(['runs with elevated privileges', 'pipes into a privileged command', 'changes system packages']);
const DISK_REASONS = new Set(['writes directly to a disk device', 'writes to a block device']);

export function unlockPrivileged(classification: Classification, unlocks: PrivilegeUnlocks): Classification {
	if (!unlocks.sudo && !unlocks.disk) return classification;
	const kept: CommandFinding[] = classification.findings.filter((f) =>
		!((unlocks.sudo && SUDO_REASONS.has(f.reason)) || (unlocks.disk && DISK_REASONS.has(f.reason))));
	if (kept.length === classification.findings.length) return classification;
	// Sin hallazgos restantes, el comando es una modificación normal (lo que sudo/dd hagan ya está autorizado por el permiso).
	const risk = kept.reduce<RiskClass>((worst, f) => maxRisk(worst, f.risk), RiskClass.Modify);
	const worst = kept.filter((f) => f.risk === risk);
	return {
		...classification,
		risk,
		findings: kept,
		summary: worst.map((f) => f.reason).join('; ') || 'runs a command authorised by the connector permissions'
	};
}
