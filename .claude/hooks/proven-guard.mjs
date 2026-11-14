#!/usr/bin/env node
// Proven's guard for Claude Code, written into a project by proven init. Claude Code runs it before every Write,
// Edit, MultiEdit, NotebookEdit and Bash call (a PreToolUse hook) and sends the call as JSON on stdin. Exit code 2
// blocks the call and shows the reason on stderr to the agent. Exit code 0 lets it through.
//
// It blocks the agent from changing files under tickets/ (which holds Kane's recordings, tickets/output-T-N/),
// receipts/, .proven/ and .claude/, and from running proven new, proven freeze, proven red or proven loop, which are a person's
// steps. For shell commands it fails closed where it can: a command that writes files is blocked when any of its
// arguments points into those folders, whichever argument the command would write to. It is defence in depth, not a
// sandbox: an agent with a shell can still get around it. That is why Proven shows a ticket as done only for a
// receipt that verifies.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Tickets, receipts, Proven's state and these guard rails, and Proven's own code and files: the agent runs
// proven done as the judge, so it must not be able to change the judge. Names are lowercase (compared without case).
export const PROTECTED = [
  'tickets', 'receipts', '.proven', '.claude', '.git',
  'bin', 'src', 'package.json', 'package-lock.json', 'node_modules', 'test', 'docs', '.gitignore', 'readme.md',
  '.testmuai', '.mcp.json', 'claude.md', '.gitattributes', '.gitmodules',
];
export const PERSON_STEPS = ['new', 'freeze', 'red', 'loop'];
// Programs that run another program named later on the line.
const WRAPPERS = new Set([
  'node', 'npx', 'npm', 'pnpm', 'yarn', 'bun', 'bunx', 'env', 'sudo', 'doas', 'time', 'exec', 'command', 'builtin',
  'nice', 'nohup', 'timeout', 'xargs', 'stdbuf', 'ionice', 'caffeinate', 'watch',
]);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
// Programs that write, move, link, create or delete the files they are given.
const WRITERS = new Set([
  'cp', 'mv', 'ln', 'rsync', 'install', 'ditto', 'scp', 'mkdir', 'touch', 'rm', 'rmdir', 'unlink', 'truncate', 'shred',
  'chmod', 'chown', 'tar', 'unzip', 'dd', 'patch', 'tee',
]);
// Programs that edit files in place only with -i (bundled or not) or --in-place.
const EDITORS = new Set(['sed', 'gsed', 'perl']);
// Programs that run code given on the line.
const INTERPRETERS = new Set(['node', 'deno', 'bun', 'python', 'python3', 'perl', 'ruby', 'php', 'osascript']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
// A protected folder named as a path segment inside code or text.
const MENTION = new RegExp(`(^|[\\s'"\`(=,:/])(${PROTECTED.map((x) => x.replace(/[.]/g, '\\.')).join('|')})(\\/|\\\\|$|[\\s'"\`),;])`, 'i');

const WHY = {
  tickets: 'Tickets, their frozen tests and locks are a person\'s. Fix the app, not the test.',
  receipts: 'Receipts are written only by proven done, when Kane passes the frozen test.',
  '.proven': 'Proven writes its own state there.',
  '.claude': 'That folder holds these guard rails.',
  '.git': 'Git config, hooks and refs decide what Proven trusts.',
  '.testmuai': "Kane's own files. Proven starts Kane itself, and nothing the agent writes there counts.",
  '.mcp.json': 'It decides which tool servers the agent can call.',
  '.gitattributes': 'It changes how git reads files.',
  '.gitmodules': 'It names other repositories git would fetch.',
  'claude.md': 'It holds the rules the agent is given.',
};
const OWN = 'That is part of Proven itself, which judges the ticket, so the agent does not change it.';
for (const name of PROTECTED) WHY[name] ??= OWN;
const DONE_HINT = 'When you believe a ticket is done, run proven done T-N and wait for Kane.';

// A path with symlinks resolved in the part of it that exists.
function realish(p) {
  let head = p;
  const rest = [];
  while (!existsSync(head)) {
    const parent = dirname(head);
    if (parent === head) return p;
    rest.unshift(basename(head));
    head = parent;
  }
  try {
    return join(realpathSync.native(head), ...rest);
  } catch {
    return p;
  }
}

// Which protected folder of the project a path falls in, or null. Names are compared without case, because a
// file system that ignores case would write Tickets/ into tickets/.
export function protectedArea(path, { projectDir, cwd }) {
  if (typeof path !== 'string' || !path.trim()) return null;
  const root = realish(resolve(projectDir));
  const target = realish(resolve(cwd || projectDir, path.trim()));
  const rel = relative(root, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  const top = rel.split(sep)[0].toLowerCase();
  return PROTECTED.includes(top) ? top : null;
}

// Split a shell command into simple commands (lists of words) and the files it redirects output to. It reads quotes,
// escapes, ; && || | &, newlines, ( ), $( ) and backticks. It is rough on purpose: a guard rail, not a parser.
export function shellParts(command) {
  const commands = [];
  const targets = [];
  let words = [];
  let word = '';
  let inWord = false;
  let redirect = null;
  const endWord = () => {
    if (!inWord) return;
    if (redirect === '>') targets.push(word);
    else if (!redirect) words.push(word);
    redirect = null;
    word = '';
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  const s = String(command ?? '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      word += s.slice(i + 1, j < 0 ? s.length : j);
      inWord = true;
      i = j < 0 ? s.length : j;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < s.length && s[j] !== '"'; j++) word += s[j] === '\\' && j + 1 < s.length ? s[++j] : s[j];
      inWord = true;
      i = j;
    } else if (c === '\\' && i + 1 < s.length) {
      word += s[++i];
      inWord = true;
    } else if (c === ' ' || c === '\t') {
      endWord();
    } else if ('\n;|&()`'.includes(c)) {
      if (c === '&' && s[i + 1] === '>') continue;
      endCommand();
    } else if (c === '$' && s[i + 1] === '(') {
      endCommand();
      i++;
    } else if (c === '>' || c === '<') {
      if (inWord && /^\d+$/.test(word)) {
        word = '';
        inWord = false;
      } else endWord();
      if (s[i + 1] === '>') i++;
      if (c === '>' && s[i + 1] === '&') {
        i++;
        redirect = 'dup';
      } else redirect = c === '>' ? '>' : '<';
    } else {
      word += c;
      inWord = true;
    }
  }
  endCommand();
  // Command substitutions inside double quotes still run.
  for (const w of commands.flat()) {
    const at = w.search(/\$\(|`/);
    if (at >= 0) {
      const inner = shellParts(w.slice(at + (w[at] === '$' ? 2 : 1)));
      commands.push(...inner.commands);
      targets.push(...inner.targets);
    }
  }
  return { commands, targets };
}

const isProven = (w) => /^proven(\.m?js)?$/.test(basename(w));

// Where the program of a simple command is: the first word after any NAME=value. Behind a wrapper such as env, sudo,
// timeout or xargs, it is the first later word that `matches`. Returns -1 when there is none.
function programIndex(words, matches) {
  let i = 0;
  while (i < words.length && ASSIGNMENT.test(words[i])) i++;
  if (i >= words.length) return -1;
  if (matches(words[i])) return i;
  if (!WRAPPERS.has(basename(words[i]))) return -1;
  return words.findIndex((w, j) => j > i && matches(w));
}

// The person's step a simple command runs (new, freeze, red or loop), or null. Fail closed: a proven command with any
// word that is a person's step is blocked, wherever the word stands, because a value flag (--port 8090 red) would make
// "the first word after proven" the wrong one to read.
export function personStep(words) {
  const at = programIndex(words, isProven);
  if (at < 0) return null;
  return words.slice(at + 1).find((w) => PERSON_STEPS.includes(w)) ?? null;
}

// Every path an argument could name: the word itself, the value after an =, and for an option word every tail of it,
// so a value bundled into short options (cp -vtDIR, tar -xzCDIR) is seen too.
function pathsIn(word) {
  const out = [word];
  const eq = word.indexOf('=');
  if (eq >= 0) out.push(word.slice(eq + 1));
  if (word.startsWith('-')) for (let i = 1; i < word.length; i++) out.push(word.slice(i));
  return out;
}

// What a simple command may write to: for a writing program, every argument after it, whichever one the program
// would really write to. That leaves no parser to get around. An editor counts only when it edits in place.
export function writeTargets(words) {
  const at = programIndex(words, (w) => WRITERS.has(basename(w)) || EDITORS.has(basename(w)) || basename(w) === 'find');
  if (at < 0) return [];
  const name = basename(words[at]);
  const args = words.slice(at + 1);
  if (EDITORS.has(name) && !args.some((w) => (/^-[^-]/.test(w) && w.includes('i')) || w.startsWith('--in-place'))) return [];
  if (name === 'find' && !args.some((w) => /^-(delete|exec|execdir|ok|okdir|fprint|fprintf|fls)$/.test(w))) return [];
  return args.flatMap(pathsIn);
}

// Code given on the line (node -e, python -c, perl -e) that names a protected folder. The guard cannot tell whether
// the code reads or writes, so it blocks.
function inlineCodeArea(words) {
  const at = programIndex(words, (w) => INTERPRETERS.has(basename(w)));
  if (at < 0) return null;
  const args = words.slice(at + 1);
  const inline = args.some((w) => /^-[A-Za-z]*[ecpE]$/.test(w) || w === '--eval' || w === '--print' || w.startsWith('--eval='));
  if (!inline) return null;
  for (const w of args) {
    const m = MENTION.exec(w);
    if (m) return m[2].toLowerCase();
  }
  return null;
}

function denyVerdict(command, where, depth = 0) {
  const { commands, targets } = shellParts(command);
  for (const words of commands) {
    const step = personStep(words);
    if (step) return `Proven: proven ${step} is a person's step, not the agent's. Work on the app. ${DONE_HINT}`;
    const shell = programIndex(words, (w) => SHELLS.has(basename(w)));
    if (shell >= 0 && depth < 3) {
      const k = words.indexOf('-c', shell);
      if (k > 0 && words[k + 1]) {
        const inner = denyVerdict(words[k + 1], where, depth + 1);
        if (inner) return inner;
      }
    }
    const code = inlineCodeArea(words);
    if (code) return `Proven: this command runs code that names a path under ${code}/, which the agent does not change. ${WHY[code]} ${DONE_HINT}`;
    targets.push(...writeTargets(words));
  }
  for (const t of targets) {
    const area = protectedArea(t, where);
    if (area) return `Proven: this command writes to ${t}, under ${area}/, which the agent does not change. ${WHY[area]} ${DONE_HINT}`;
  }
  return null;
}


// ---- The allowlist -------------------------------------------------------------------------------------------------
// A Bash command is allowed only when every segment of it (split on | && || ; and newlines) is proven done for one
// ticket, a program that only reads, or a read-only git subcommand. Everything else is blocked: substitution,
// redirection to a file, cd, assignments, and every program that is not listed. The denylist above runs first only to
// give a precise reason; this is what decides. It is defence in depth, not a sandbox.
const READ_ONLY = new Set(['cat', 'head', 'tail', 'ls', 'wc', 'grep', 'rg', 'find', 'sed', 'sort', 'uniq', 'diff', 'jq', 'echo', 'pwd', 'file', 'stat', 'tree']);
const GIT_READ = new Set(['log', 'show', 'diff', 'status', 'rev-parse', 'ls-files', 'blame', 'grep', 'cat-file', 'branch']);
const ALLOWED_REDIRECTS = new Set(['2>&1', '2>/dev/null', '>/dev/null']);
const WORD_CHAR = /[A-Za-z0-9_./:=,@%+-]/;
const ALLOW_HINT = 'The agent may only read files, edit the app with its edit tools, and run proven done.';

// Splits a command into segments of words, or says why it cannot be read safely.
function segmentsOf(s) {
  const segments = [];
  let words = [];
  let word = '';
  let inWord = false;
  let start = 0;
  const endWord = () => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endSegment = (i) => {
    endWord();
    if (words.length) segments.push({ words, text: s.slice(start, i).trim() });
    words = [];
    start = i + 1;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) return { problem: 'an unterminated quote' };
      word += s.slice(i + 1, j);
      inWord = true;
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < s.length && s[j] !== '"'; j++) {
        if (s[j] === '\\' && (s[j + 1] === '"' || s[j + 1] === '\\')) word += s[++j];
        else if (s[j] === '`' || s[j] === '$') return { problem: 'a $ or backtick inside double quotes' };
        else word += s[j];
      }
      if (j >= s.length) return { problem: 'an unterminated quote' };
      inWord = true;
      i = j;
    } else if (c === ' ' || c === '\t') endWord();
    else if (c === '\n' || c === ';') endSegment(i);
    else if (c === '|') {
      if (s[i + 1] === '|') i++;
      endSegment(i);
    } else if (c === '&') {
      if (s[i + 1] !== '&') return { problem: 'a background or combined redirect (&)' };
      i++;
      endSegment(i);
    } else if (c === '>') {
      let fd = '';
      if (inWord && /^\d+$/.test(word)) {
        fd = word;
        word = '';
        inWord = false;
      } else endWord();
      let j = i + 1;
      const append = s[j] === '>';
      if (append) j++;
      let target = '';
      if (s[j] === '&') {
        target = '&';
        for (j++; /\d/.test(s[j] ?? ''); j++) target += s[j];
      } else {
        while (s[j] === ' ' || s[j] === '\t') j++;
        for (; j < s.length && !/[\s;|&<>()]/.test(s[j]); j++) target += s[j];
      }
      const text = `${fd}>${append ? '>' : ''}${target}`;
      if (!ALLOWED_REDIRECTS.has(text)) return { problem: `the redirection ${text}` };
      i = j - 1;
    } else if (WORD_CHAR.test(c)) {
      word += c;
      inWord = true;
    } else return { problem: `the character ${JSON.stringify(c)} outside quotes (an unquoted word may hold only letters, digits and _ . / : = , @ % + -)` };
  }
  endSegment(s.length);
  return { segments };
}

// The flags each read-only program may have, and nothing else: no abbreviations, no prefixes. `plain` take no value,
// `valued` take the next word, `attached` are patterns for flags with the value in the same word, `letters` are short
// flags that may be bundled (-la), `numeric` allows -N.
const FLAGS = {
  cat: { plain: ['-n'] },
  head: { valued: ['-n', '-c'], attached: [/^-[nc]\d+$/], numeric: true },
  tail: { valued: ['-n', '-c'], attached: [/^-[nc]\d+$/], numeric: true },
  ls: { letters: 'laARh1' },
  wc: { plain: ['-l', '-w', '-c'], letters: 'lwc' },
  grep: { plain: ['-n', '-i', '-r', '-R', '-l', '-L', '-c', '-E', '-F', '-w', '-v', '-H', '-h', '--color=never'], valued: ['-A', '-B', '-C', '-e'], attached: [/^-[ABC]\d+$/, /^--include=.+$/, /^--exclude=.+$/], letters: 'nirRlLcEFwvHh' },
  rg: { plain: ['-n', '-i', '-l', '-c', '-w', '-F', '--no-heading'], valued: ['-g', '-A', '-B', '-C'], attached: [/^-[ABC]\d+$/], letters: 'nilcwF' },
  find: { plain: ['-print', '-o', '-a'], valued: ['-type', '-name', '-iname', '-path', '-ipath', '-maxdepth', '-mindepth'] },
  sort: { plain: ['-n', '-r', '-u'], valued: ['-k', '-t'], attached: [/^-k\d+(,\d+)?$/, /^-t.$/], letters: 'nru' },
  uniq: { plain: ['-c', '-d', '-u'], letters: 'cdu' },
  diff: { plain: ['-u', '-r', '-q'], letters: 'urq' },
  jq: { plain: ['-r', '-c', '-S'], letters: 'rcS' },
  tree: { plain: ['-a', '-d'], valued: ['-L'], attached: [/^-L\d+$/], letters: 'ad' },
  echo: {},
  pwd: {},
  file: {},
  stat: {},
};
const FORMAT = [/^--format=.*$/, /^--pretty=.*$/];
const GIT_FLAGS = {
  log: { plain: ['--oneline', '--stat', '--name-only', '--name-status', '-p', '--graph', '--decorate', '--all'], valued: ['-n'], attached: [/^-n\d+$/, ...FORMAT], numeric: true },
  show: { plain: ['--stat', '--name-only', '--name-status', '-p'], attached: FORMAT },
  diff: { plain: ['--stat', '--name-only', '--name-status', '--cached', '--staged', '--no-color'], attached: [/^-U\d+$/] },
  status: { plain: ['-s', '--short', '--porcelain', '-b'] },
  'rev-parse': { plain: ['--short', '--abbrev-ref', '--show-toplevel'] },
  'ls-files': {},
  blame: { valued: ['-L'], attached: [/^-L\d+(,\d+)?$/] },
  grep: { plain: ['-n', '-i', '-w', '-l'], valued: ['-e'] },
  'cat-file': { plain: ['-p', '-t'] },
  branch: { plain: ['--list'] },
};

// Why a flag is not allowed for this program, or null. A bare `--` ends the flags (git paths follow).
function flagProblem(label, spec, args) {
  const listed = [...(spec.plain ?? []), ...(spec.valued ?? []), ...(spec.attached ?? []).map((r) => r.source)];
  const fail = () => `the guard allows only these flags for ${label}: ${listed.length ? listed.join(' ') : 'none'}`;
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (w === '--' && label.startsWith('git ')) return null;
    if (!w.startsWith('-') || w === '-') continue;
    if (spec.plain?.includes(w)) continue;
    if (spec.valued?.includes(w)) {
      // The value is the next word. It may not look like a flag, or a flag could hide behind a flag that takes a value.
      const value = args[i + 1];
      if (value === undefined || (value.startsWith('-') && !/^-\d+$/.test(value))) return fail();
      i++;
      continue;
    }
    if (spec.attached?.some((r) => r.test(w))) continue;
    if (spec.numeric && /^-\d+$/.test(w)) continue;
    if (spec.letters && new RegExp(`^-[${spec.letters}]+$`).test(w)) continue;
    return fail();
  }
  return null;
}

// Why a segment is not allowed, or null.
function segmentProblem(words) {
  const [name, ...args] = words;
  if (ASSIGNMENT.test(name)) return 'it sets an environment variable';
  if (name === 'node' || name === 'proven') {
    const form = name === 'node' ? ['bin/proven.js', './bin/proven.js'].includes(args[0]) && args[1] === 'done' && args.length === 3 : args[0] === 'done' && args.length === 2;
    return form && /^T-\d+$/.test(args.at(-1)) ? null : 'only proven done T-N is allowed';
  }
  if (name === 'git') {
    const sub = args[0];
    if (!GIT_READ.has(sub)) return 'only read-only git subcommands are allowed (log, show, diff, status, rev-parse, ls-files, blame, grep, cat-file, branch --list)';
    const rest = args.slice(1);
    if (sub === 'branch' && rest.some((w) => w !== '--list')) return 'git branch is allowed only with no arguments or --list';
    if (rest.some((w) => w === '--output' || w.startsWith('--output='))) return 'git may not write its output to a file';
    return flagProblem(`git ${sub}`, GIT_FLAGS[sub], rest);
  }
  if (!READ_ONLY.has(name)) return `${name} is not a read-only program on the list`;
  if (name !== 'sed') {
    const why = flagProblem(name, FLAGS[name], args);
    if (why) return why;
  }
  if (name === 'uniq' && args.filter((w) => !w.startsWith('-')).length > 1) return 'uniq with a second file writes it';
  if (name === 'sed') {
    let quiet = false;
    const scripts = [];
    const files = [];
    for (let i = 0; i < args.length; i++) {
      const w = args[i];
      if (w === '--quiet' || w === '--silent') quiet = true;
      else if (/^-[nEr]+$/.test(w)) quiet ||= w.includes('n');
      else if (w === '-e') scripts.push(args[++i] ?? '');
      else if (w.startsWith('--expression=')) scripts.push(w.slice(13));
      else if (w.startsWith('-')) return 'the guard allows only these flags for sed: -n -e -E -r --quiet --silent, with line-number print scripts';
      else files.push(w);
    }
    if (!scripts.length && files.length) scripts.push(files.shift());
    // Line numbers only: no regex address, which could hide a newline, a backslash or a second command (such as e or w).
    const PRINT = /^(\d+|\$)(,(\d+|\$))?p$/;
    if (!quiet || !scripts.length || !scripts.every((x) => !/[\\\n;]/.test(x) && PRINT.test(x.trim()))) return 'sed is allowed only with -n and line-number print scripts such as 1,20p or $p (use grep to search)';
  }
  return null;
}

// The reason to block a Bash command, or null when every segment is on the list.
export function allowVerdict(command) {
  const text = String(command ?? '');
  const { segments, problem } = segmentsOf(text);
  if (problem) return `Proven: this command is blocked because it has ${problem}: ${text.trim().slice(0, 200)}. ${ALLOW_HINT} ${DONE_HINT}`;
  for (const { words, text: seg } of segments) {
    const why = segmentProblem(words);
    if (why) return `Proven: this command is blocked at the segment "${seg.slice(0, 200)}": ${why}. ${ALLOW_HINT} ${DONE_HINT}`;
  }
  return null;
}

// The app folder named in .proven/config.json (default demo/app), as a clean relative path, or null when the config cannot
// be read or names something that is not a folder inside the project. The agent may write only there.
export function appFolder(projectDir) {
  let app = 'demo/app';
  const file = join(projectDir, '.proven', 'config.json');
  if (existsSync(file)) {
    try {
      const config = JSON.parse(readFileSync(file, 'utf8'));
      if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
      if (config.app !== undefined) app = config.app;
    } catch {
      return null;
    }
  }
  if (typeof app !== 'string' || !app.trim()) return null;
  const clean = normalize(app.trim()).replace(/\\/g, '/').replace(/\/+$/, '');
  if (isAbsolute(clean) || clean === '.' || clean === '..' || clean.startsWith('../')) return null;
  return clean;
}

const NO_APP = 'Proven: the app folder in .proven/config.json could not be read, so the guard blocked this call. The agent edits only the app folder.';

// Is this path inside the app folder (symlinks resolved where the file or its parent exists)?
function insideApp(path, { projectDir, cwd }, app) {
  const appDir = realish(resolve(projectDir, app));
  const target = realish(resolve(cwd || projectDir, path.trim()));
  const rel = relative(appDir, target);
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel);
}

// The reason a path is not allowed for an edit tool, or null: deny by default. It must name a file inside the app folder.
// An edit anywhere else, such as ~/.gitconfig, could make an allowed git command run code.
function outsideApp(path, where, app) {
  if (typeof path !== 'string' || !path.trim()) return 'has no file path';
  if (!insideApp(path, where, app)) return `is outside the app folder ${app}/`;
  return null;
}

// The reason to block a tool call, or null to let it through.
export function decide(input, { projectDir }) {
  if (!input || typeof input !== 'object') return null;
  const tool = input.tool_name;
  const args = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const where = { projectDir, cwd: typeof input.cwd === 'string' ? input.cwd : projectDir };
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const path = args.file_path ?? args.notebook_path;
    const area = protectedArea(path, where);
    if (area) return `Proven: ${path} is under ${area}/, which the agent does not change. ${WHY[area]} ${DONE_HINT}`;
    const app = appFolder(projectDir);
    if (!app) return `${NO_APP} ${DONE_HINT}`;
    const outside = outsideApp(path, where, app);
    if (outside) return `Proven: ${path || 'this edit'} ${outside}, and the agent edits only files inside it, with its edit tools. ${DONE_HINT}`;
    return null;
  }
  if (tool === 'Bash') return denyVerdict(args.command, where) ?? allowVerdict(args.command);
  if (typeof tool === 'string' && tool.startsWith('mcp__')) return mcpVerdict(tool, args, where, projectDir);
  return null;
}

const MAX_DEPTH = 10;
const MAX_STRING = 4096;
const MAX_VALUES = 2000;

// Every string anywhere in a tool call's arguments, object keys included. It throws when it cannot look at everything.
function stringsIn(value, out = [], depth = 0) {
  if (out.length > MAX_VALUES) throw new Error('too many values to check');
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value) || (value && typeof value === 'object')) {
    if (depth >= MAX_DEPTH) throw new Error('nested too deeply to check');
    if (Array.isArray(value)) value.forEach((v) => stringsIn(v, out, depth + 1));
    else {
      for (const [k, v] of Object.entries(value)) {
        out.push(k);
        stringsIn(v, out, depth + 1);
      }
    }
  }
  return out;
}

const PATH_LIKE = /^(\/|~|\.{1,2}(\/|\\|$)|[A-Za-z]:[\\/])/;
const SCHEME_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

// Every path a string could mean: the string itself, its percent-decoded form, and for a file: URL the path it names.
// Returns { paths, unreadable }.
function pathsOf(raw) {
  const paths = [];
  let unreadable = false;
  const add = (text) => {
    paths.push(text);
    if (/^file:/i.test(text)) {
      try {
        paths.push(fileURLToPath(new URL(text)));
      } catch {
        unreadable = true;
      }
    }
  };
  add(raw);
  // Percent-decode up to three rounds (%252e is %2e is a dot), checking every form.
  let text = raw;
  for (let round = 0; round < 3 && text.includes('%'); round++) {
    try {
      text = decodeURIComponent(text);
    } catch {
      unreadable = true;
      break;
    }
    add(text);
  }
  return { paths, unreadable };
}

// An MCP tool is written by someone else, so the guard cannot tell what it writes. So it checks the arguments and fails
// closed: it blocks a call it cannot check completely (a string over the limit, too deep or too many values, a file: URL
// or percent-encoding it cannot read), one with a string that points into a protected path, and one with a path-like
// string that points outside the app folder. Other text passes.
function mcpVerdict(tool, args, where, projectDir) {
  let strings;
  try {
    strings = stringsIn(args);
  } catch (err) {
    return `Proven: the call to ${tool} has an argument that is ${err.message}, so the guard blocked it. ${DONE_HINT}`;
  }
  const app = appFolder(projectDir);
  for (const raw of strings) {
    if (raw.length > MAX_STRING) return `Proven: the call to ${tool} has a string that is too long to check, so the guard blocked it. ${DONE_HINT}`;
    const { paths, unreadable } = pathsOf(raw);
    if (unreadable) return `Proven: the call to ${tool} has a path or URL that could not be read (${raw.slice(0, 80)}), so the guard blocked it. ${DONE_HINT}`;
    for (const candidate of paths) {
      const area = protectedArea(candidate, where);
      if (area) return `Proven: the call to ${tool} names ${raw.slice(0, 120)}, under the protected ${area}/, which the agent does not change. ${WHY[area]} ${DONE_HINT}`;
      const pathLike = PATH_LIKE.test(candidate) || (/[\\/]/.test(candidate) && !/\s/.test(candidate) && !SCHEME_URL.test(candidate));
      if (pathLike) {
        if (!app) return `${NO_APP} ${DONE_HINT}`;
        if (candidate.startsWith('~') || !insideApp(candidate, where, app)) {
          return `Proven: the call to ${tool} names ${raw.slice(0, 120)}, which is outside the app folder ${app}/. The agent works only inside it. ${DONE_HINT}`;
        }
      }
    }
  }
  return null;
}

// Decides one hook call from its raw JSON. Anything it cannot read or that goes wrong is a block, never a pass.
export async function guard(raw, { projectDir: fixedDir, decideFn = decide } = {}) {
  const unreadable = 'Proven: the guard could not read this tool call, so it blocked it. The agent edits the app with its edit tools and runs proven done.';
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return { code: 2, message: unreadable };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.tool_name !== 'string') return { code: 2, message: unreadable };
  try {
    const projectDir = fixedDir || (typeof input.cwd === 'string' ? input.cwd : process.cwd());
    const reason = decideFn(input, { projectDir });
    return reason ? { code: 2, message: reason } : { code: 0 };
  } catch (err) {
    return { code: 2, message: `Proven: the guard failed (${err?.message ?? err}), so it blocked this call.` };
  }
}

async function main() {
  let raw = '';
  try {
    for await (const chunk of process.stdin) raw += chunk;
  } catch {
    // an unreadable stdin is handled as unreadable input below
  }
  const { code, message } = await guard(raw, { projectDir: process.env.CLAUDE_PROJECT_DIR });
  if (message) process.stderr.write(message + '\n');
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realish(resolve(process.argv[1]))).href) {
  try {
    process.exitCode = await main();
  } catch (err) {
    process.stderr.write(`Proven: the guard failed (${err?.message ?? err}), so it blocked this call.\n`);
    process.exitCode = 2;
  }
}
