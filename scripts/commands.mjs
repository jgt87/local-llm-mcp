// Writes the /local_<name> Claude Code command files from the definitions in src/prompts.ts.
//   node scripts/commands.mjs            -> commands/ in this repo
//   node scripts/commands.mjs --install  -> also ~/.claude/commands/, available in every project
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { COMMANDS, renderCommandFile } from "../dist/prompts.js";

const dirs = [new URL("../commands/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")];
if (process.argv.includes("--install")) dirs.push(join(homedir(), ".claude", "commands"));

for (const dir of dirs) {
  mkdirSync(dir, { recursive: true });
  for (const cmd of COMMANDS) {
    const file = join(dir, `local_${cmd.name}.md`);
    writeFileSync(file, renderCommandFile(cmd));
    console.log(`wrote ${file}`);
  }
}
