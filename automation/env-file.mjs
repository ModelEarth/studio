// Finds and reads local env files kept outside the repo, using the same rules
// as CloudRoot's automation/env-file.mjs: the location comes from a key in
// paths.yaml (relative to this folder), the last KEY= line wins, quotes and a
// trailing " # comment" are stripped, and template placeholders
// ("your-...", "CHANGE_ME...", "REPLACE_ME...") count as unset.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const AUTOMATION_DIR = dirname(fileURLToPath(import.meta.url));
export const PATHS_YAML = join(AUTOMATION_DIR, "paths.yaml");
const PATHS_EXAMPLE = join(AUTOMATION_DIR, "paths.example.yaml");

export function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

export function readPathSetting(key) {
  if (!existsSync(PATHS_YAML)) copyFileSync(PATHS_EXAMPLE, PATHS_YAML);
  const line = readFileSync(PATHS_YAML, "utf8").split("\n").filter((l) => l.startsWith(`${key}:`)).pop();
  return (line || "")
    .slice(key.length + 1)
    .replace(/\s#.*$/, "")
    .trim()
    .replace(/^"|"$/g, "");
}

// Replaces key: in place or appends it, so paths.yaml remembers the last path used.
export function savePathSetting(key, value) {
  if (!existsSync(PATHS_YAML)) copyFileSync(PATHS_EXAMPLE, PATHS_YAML);
  const lines = readFileSync(PATHS_YAML, "utf8").split("\n");
  const index = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (index >= 0) lines[index] = `${key}: ${value}`;
  else lines.splice(lines.at(-1) === "" ? lines.length - 1 : lines.length, 0, `${key}: ${value}`);
  writeFileSync(PATHS_YAML, lines.join("\n"));
}

// An explicit path wins and is remembered in paths.yaml; otherwise paths.yaml's
// key is used (created from paths.example.yaml on first use).
export function resolveEnvFile(key, explicitPath) {
  let file;
  if (explicitPath) {
    file = resolve(explicitPath);
    savePathSetting(key, relative(AUTOMATION_DIR, file));
  } else {
    const value = readPathSetting(key);
    if (!value) fail(`no ${key}: set in ${PATHS_YAML}.`);
    file = isAbsolute(value) ? value : resolve(AUTOMATION_DIR, value);
  }
  if (!existsSync(file)) {
    fail(`${file} doesn't exist. Create it (for crew, from crew/.env.example), or set ${key}: in ${PATHS_YAML}.`);
  }
  return file;
}

export function isPlaceholder(value) {
  return /^[Yy]our[-_]/.test(value) || /^(CHANGE_ME|changeme|REPLACE_ME)/.test(value) || /_REPLACE_ME$/.test(value);
}

export function readEnv(file, key) {
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.startsWith(`${key}=`));
  if (!lines.length) return "";
  const value = lines.pop().slice(key.length + 1).replace(/^"/, "").replace(/"$/, "").replace(/\s+#.*$/, "").trim();
  return isPlaceholder(value) ? "" : value;
}
