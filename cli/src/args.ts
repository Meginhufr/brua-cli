// The command line, parsed: a command, its positional arguments and its flags. Flags are --name value,
// --name=value, --name alone (true), --no-name (false), and a flag given twice keeps both values.

export interface Parsed {
  command: string | undefined;
  positionals: string[];
  flags: Map<string, string[]>;
}

export function parseArgs(argv: string[]): Parsed {
  const parsed: Parsed = { command: undefined, positionals: [], flags: new Map() };
  const add = (name: string, value: string) => parsed.flags.set(name, [...(parsed.flags.get(name) ?? []), value]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      if (parsed.command === undefined) parsed.command = arg;
      else parsed.positionals.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const equals = body.indexOf("=");
    if (equals >= 0) {
      add(body.slice(0, equals), body.slice(equals + 1));
    } else if (body.startsWith("no-")) {
      add(body.slice(3), "false");
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      add(body, argv[++i]);
    } else {
      add(body, "true");
    }
  }
  return parsed;
}

/** The flag's last value, or undefined. */
export function flag(parsed: Parsed, name: string): string | undefined {
  const values = parsed.flags.get(name);
  return values?.[values.length - 1];
}

/** Every value the flag was given. */
export function flags(parsed: Parsed, name: string): string[] {
  return parsed.flags.get(name) ?? [];
}

export function boolFlag(parsed: Parsed, name: string, fallback: boolean): boolean {
  const value = flag(parsed, name);
  return value === undefined ? fallback : value !== "false";
}

export function numberFlag(parsed: Parsed, name: string): number | undefined {
  const value = flag(parsed, name);
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`--${name} takes a number, not "${value}".`);
  return n;
}

/** "nb=Rødt ullpledd" pairs, from repeated flags or lines, as an object. */
export function pairs(values: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const value of values.flatMap((v) => v.split("\n"))) {
    const line = value.trim();
    if (!line) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) throw new Error(`Expected name=value, got "${line}".`);
    result[line.slice(0, equals).trim()] = line.slice(equals + 1).trim();
  }
  return result;
}
