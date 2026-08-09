# Self-Extracting Project Archive

| File | Purpose |
|---|---|
| `pack.cjs` | Walks a folder, embeds every file as base64 inside a new self-extracting `.cjs` file |
| `unpack.cjs` | Extracts a bundle **without executing it** (safer / for inspection) |

The bundle produced by `pack.cjs` is itself runnable — `unpack.cjs` is optional.

> **Why `.cjs`?** This project's `package.json` has `"type": "module"`, so a plain
> `.js` file can't use `require()`. The tools and the generated bundle use the
> `.cjs` extension so they run as CommonJS regardless of the host project's type.

---

## How it works

1. **Walk** the source directory recursively, skipping `node_modules`, `.git`, `dist`, etc.
2. **Read** each file as a `Buffer` and encode it to **base64** — works for text *and* binary (`alice.epub`, `.mp3`, images, fonts).
3. Build a map `{ "src/main.js": { d: "<base64>", h: "<sha256-16>", m: "644" }, ... }`.
4. **JSON.stringify → gzip → base64** the whole map into one payload string, split into 120-char chunks joined at runtime.
5. **Emit** a `.cjs` file containing that payload plus an extractor that gunzips, decodes, then `mkdirSync({recursive:true})` + `writeFileSync` each entry.

Safety: every destination path is checked to make sure it stays inside the target directory (blocks `../../etc/passwd` entries), and each file's SHA-256 prefix is verified before writing.

---

## Packing

```powershell
# pack the whole current project (source only - default)
node tools/pack.cjs . project-bundle.cjs

# pack only a subfolder
node tools/pack.cjs .\server server-bundle.cjs

# skip gzip (bigger file, payload is plain base64 JSON)
node tools/pack.cjs . project-bundle.cjs --no-gzip

# include the generated data/ folder (mp3 output, uploads, logs...)
node tools/pack.cjs . full-bundle.cjs --include-data

# include media/binary assets (.mp3 .epub .pdf .zip .sqlite ...)
node tools/pack.cjs . full-bundle.cjs --include-media

# include node_modules (usually a bad idea)
node tools/pack.cjs . full-bundle.cjs --include-node-modules
```

Output:

```
Packing: C:\Users\C962836\Pictures\audio
Packed  : 106 files (1366.3 KB source)
Skipped : 0
Gzip    : yes
Output  : project-bundle.cjs (1020.4 KB)
```

### What is excluded by default

| Excluded | Why | Override |
|---|---|---|
| `node_modules` | reinstallable | `--include-node-modules` |
| `data`, `uploads`, `tmp`, `temp`, `logs`, `cache`, `storage` | generated at runtime, not source | `--include-data` |
| `.mp3 .wav .m4a .mp4 .epub .pdf .zip .sqlite` etc. | large, already compressed — gzip can't shrink them | `--include-media` |
| `*bundle*`, `*archive*`, `*snapshot*` files | never pack an archive into an archive | edit `ARCHIVE_RE` |
| `.git`, `dist`, `build`, `coverage`, `.vscode`, `*.log` | build output / editor cruft | edit `IGNORE_DIRS` |

### Tuning what gets packed
Edit the top of `tools/pack.cjs`:

- `IGNORE_DIRS` — folder names to skip entirely
- `IGNORE_FILES` — exact filenames to skip
- `MEDIA_EXT` — binary extensions skipped unless `--include-media`
- `ARCHIVE_RE` — filename pattern for previously generated bundles
- `MAX_FILE_BYTES` — per-file size cap (default 25 MB)

---

## Unpacking

### Option A — run the bundle (self-extracting)

```powershell
node project-bundle.cjs                     # extract into ./<project-name>
node project-bundle.cjs .\restored          # extract into ./restored
node project-bundle.cjs .\restored --force  # overwrite existing files
node project-bundle.cjs --list              # show contents, write nothing
node project-bundle.cjs .\restored --dry-run
node project-bundle.cjs .\restored --install    # extract, then npm install
```

### Option B — use `unpack.cjs` (does not execute the bundle)

```powershell
node tools/unpack.cjs project-bundle.cjs --list
node tools/unpack.cjs project-bundle.cjs .\restored
node tools/unpack.cjs project-bundle.cjs .\restored --force
node tools/unpack.cjs project-bundle.cjs .\restored --dry-run
```

`unpack.cjs` pulls the `MANIFEST` and `PAYLOAD` literals out of the bundle with a regex instead of `require`-ing it — so you can safely extract a bundle you received from someone else.

---

## Flags reference

| Flag | pack | bundle | unpack | Meaning |
|---|:--:|:--:|:--:|---|
| `--no-gzip` | ✓ | | | store payload uncompressed |
| `--include-data` | ✓ | | | pack `data/`, `uploads/`, `logs/`, etc. |
| `--include-media` | ✓ | | | pack `.mp3`, `.epub`, `.zip`, `.sqlite`, etc. |
| `--include-node-modules` | ✓ | | | don't skip `node_modules` |
| `--list` | | ✓ | ✓ | print file list + sizes, extract nothing |
| `--force` | | ✓ | ✓ | overwrite files that already exist |
| `--dry-run` | | ✓ | ✓ | show what would be written |
| `--install` | | ✓ | | run `npm install` after extracting |

---

## Verify a round-trip

```powershell
node tools/pack.cjs . _test-bundle.cjs
node _test-bundle.cjs .\_roundtrip 2>&1 | Select-String -Pattern "!|Done"
# -> Done. written=121 skipped=0 failed=0
Remove-Item -Recurse -Force .\_roundtrip, .\_test-bundle.cjs
```

---

## Optional npm scripts

Add to `package.json`:

```json
"scripts": {
  "pack": "node tools/pack.cjs . project-bundle.cjs",
  "pack:list": "node tools/unpack.cjs project-bundle.cjs --list"
}
```

---

## Notes & limits

- **Size**: base64 inflates ~33%; gzip more than makes up for it on text, but already-compressed data (mp3, epub, png) will *not* shrink — the bundle ends up slightly larger than the source.
- **Binary is fine** — everything is stored as base64 Buffers.
- **Empty directories are not preserved** (only files). Add a `.gitkeep` if needed.
- **Symlinks are skipped**, not followed.
- **File permissions** are stored as an octal mode string and re-applied on extract (no-op on Windows).
- For very large trees, prefer a real `.tar.gz` — this format is for *portability in a single pasteable/emailable JS file*, not maximum efficiency.
