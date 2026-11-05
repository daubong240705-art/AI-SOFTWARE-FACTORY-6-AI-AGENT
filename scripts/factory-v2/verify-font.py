"""Optional font asset verification. Requires fontTools; never installs packages."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.ttLib import woff2
from types import SimpleNamespace
import subprocess
import hashlib
import json
import unicodedata

ROOT = Path(__file__).resolve().parents[2]
DESIGN = ROOT / 'design/factory-v2'
font_path = DESIGN / 'assets/InterVariable.woff2'
decoder = 'Python Brotli'
if not woff2.haveBrotli:
    # Reuse Node's built-in decoder when Python's optional extension is absent.
    # The shim is local to this read-only process; no environment/package mutation.
    def decompress(data):
        return subprocess.run(
            ['node', '-e', "const fs=require('node:fs');const z=require('node:zlib');process.stdout.write(z.brotliDecompressSync(fs.readFileSync(0)));"],
            input=data, capture_output=True, check=True, timeout=30,
        ).stdout
    woff2.brotli = SimpleNamespace(decompress=decompress)
    woff2.haveBrotli = True
    decoder = 'Node built-in Brotli via stdin'
font = TTFont(font_path)
cmap = font.getBestCmap()
def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)
texts = []
for name in ['labels.vi.json', 'labels.en.json', 'seed.json']:
    texts.extend(strings(json.loads((DESIGN / name).read_text(encoding='utf-8'))))
sample = ''.join(texts)
# Vietnamese Latin Extended Additional plus combining marks used in decomposed text.
required = {ord(ch) for form in ['NFC', 'NFD'] for ch in unicodedata.normalize(form, sample) if not ch.isspace()}
required.update(code for code in range(0x1EA0, 0x1EFA))
missing = sorted(required - cmap.keys())
report = {
    'schemaVersion': 1,
    'asset': 'design/factory-v2/assets/InterVariable.woff2',
    'sha256': hashlib.sha256(font_path.read_bytes()).hexdigest(),
    'method': 'fontTools cmap for vi/en resources, original fixture content, NFC/NFD, and U+1EA0..U+1EF9',
    'requiredCodepoints': len(required),
    'missingCodepoints': [f'U+{code:04X}' for code in missing],
    'variableAxes': [{'tag': axis.axisTag, 'minimum': axis.minValue, 'maximum': axis.maxValue} for axis in font['fvar'].axes],
    'visualRenderingVerified': False,
    'decoder': decoder,
    'italicAssetBundled': False,
}
if missing:
    raise SystemExit(json.dumps(report, ensure_ascii=True))
destination = ROOT / '.cache/factory-v2/font-validation.json'
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'requiredCodepoints': len(required), 'missingCodepoints': missing, 'visualRenderingVerified': False}))
