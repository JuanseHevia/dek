"""PowerPoint export acceptance against a separately launched Dek with DEK_SUPPORT_DIR in a test folder.

Usage:
  python3 mac/test/export_acceptance.py /tmp/dek-export-qa/profile /tmp/dek-export-qa/decks/export-kitchen-sink.html
  DEK_GOLDEN_DECK=/abs/deck.html python3 mac/test/export_acceptance.py /tmp/dek-export-qa/profile

The kitchen-sink fixture (web/test/fixtures/export-kitchen-sink.html) is checked strictly. Any other
deck, such as a private golden deck kept outside git, gets a structural report: pictures per slide,
full-slide pictures, fonts, autofit, and image resolution.
"""
import json, os, sys, time, urllib.request, zipfile, re, struct
from pathlib import Path

profile = Path(sys.argv[1]).resolve()
assert str(profile).startswith('/private/tmp/') or str(profile).startswith('/tmp/'), 'Use an isolated temporary profile'
deck = Path(sys.argv[2] if len(sys.argv) > 2 else os.environ.get('DEK_GOLDEN_DECK', '')).resolve()
assert deck.is_file(), 'Pass a deck path or set DEK_GOLDEN_DECK'
state = json.loads((profile / 'agent.json').read_text())

def call(tool, args=None, ok=True):
    request = urllib.request.Request(f'http://127.0.0.1:{state["port"]}/rpc', data=json.dumps({'tool': tool, 'args': args or {}, 'author': 'Export acceptance'}).encode(), headers={'Authorization': 'Bearer ' + state['token'], 'Content-Type': 'application/json'})
    result = json.load(urllib.request.urlopen(request, timeout=60))
    if ok: assert result.get('ok'), (tool, result)
    return result.get('result') if ok else result

def check(label, condition):
    assert condition, label
    print('PASS', label, flush=True)

def export(path):
    job = call('export_deck', {'format': 'pptx', 'path': str(path), 'overwrite': True})['job_id']
    for _ in range(600):
        status = call('get_export_status', {'job_id': job})
        if status['status'] in ('completed', 'failed', 'cancelled'): return status
        time.sleep(.5)
    raise AssertionError('export did not finish')

def png_size(data):
    if data[:8] == b'\x89PNG\r\n\x1a\n': return struct.unpack('>II', data[16:24])
    if data[:2] == b'\xff\xd8':
        i = 2
        while i < len(data):
            marker, size = data[i + 1], struct.unpack('>H', data[i + 2:i + 4])[0]
            if 0xc0 <= marker <= 0xc3: return struct.unpack('>HH', data[i + 5:i + 9])[::-1]
            i += 2 + size
    return (0, 0)

EMU_PER_PX = None
def analyze(pptx):
    global EMU_PER_PX
    z = zipfile.ZipFile(pptx)
    pres = z.read('ppt/presentation.xml').decode()
    slide_cx, slide_cy = map(int, re.search(r'<p:sldSz cx="(\d+)" cy="(\d+)"', pres).groups())
    slides = sorted((n for n in z.namelist() if re.match(r'ppt/slides/slide\d+\.xml$', n)), key=lambda n: int(re.search(r'(\d+)', n.split('/')[-1]).group(1)))
    report = []
    for name in slides:
        xml = z.read(name).decode()
        rels = z.read(name.replace('slides/', 'slides/_rels/') + '.rels').decode()
        targets = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="\.\./media/([^"]+)"', rels))
        pics = []
        for pic in re.findall(r'<p:pic>.*?</p:pic>', xml, re.S):
            rid = re.search(r'r:embed="(rId\d+)"', pic).group(1)
            cx, cy = map(int, re.search(r'<a:ext cx="(\d+)" cy="(\d+)"', pic).groups())
            media = z.read('ppt/media/' + targets[rid])
            pics.append({'media': targets[rid], 'bytes': media, 'px': png_size(media), 'cx': cx, 'cy': cy, 'full': cx >= slide_cx * .95 and cy >= slide_cy * .95})
        report.append({'name': name, 'xml': xml, 'pics': pics, 'texts': re.findall(r'<a:t>([^<]*)</a:t>', xml), 'faces': set(re.findall(r'typeface="([^"]+)"', xml))})
    return slide_cx, report

out = profile.parent / 'out' / (deck.stem + '.pptx')
out.parent.mkdir(exist_ok=True)
call('open_deck', {'path': str(deck)})
time.sleep(1)
status = export(out)
check('export completes', status['status'] == 'completed' and Path(status['path']).is_file())
print('SUMMARY', ' · '.join(status.get('summary', {}).get('lines', [])))
slide_cx, report = analyze(out)
emu_per_px = slide_cx / 1920
for s in report:
    lows = [p for p in s['pics'] if p['px'][0] and p['px'][0] < p['cx'] / emu_per_px * 1.99]
    print(f"{s['name'].split('/')[-1]}: pictures={len(s['pics'])} full-slide={sum(p['full'] for p in s['pics'])} texts={len(s['texts'])} faces={sorted(s['faces'])} below-2x={len(lows)}")
check('no autofit anywhere', not any('normAutofit' in s['xml'] for s in report))
check('no full-slide pictures', not any(p['full'] for s in report for p in s['pics']))
GOOGLE = json.load(open(Path(__file__).resolve().parents[2] / 'web/src/google-fonts.json'))
base = lambda f: re.sub(r' (Thin|ExtraLight|Light|Medium|SemiBold|Bold|ExtraBold|Black)$', '', f)
check('Slides-safe faces only', all(base(f) in GOOGLE or f in ('Arial', 'Georgia', 'Courier New', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Impact') for s in report for f in s['faces']))

if deck.name == 'export-kitchen-sink.html':
    photo = (deck.parent / 'export-photo.png').read_bytes()
    all_pics = [p for s in report for p in s['pics']]
    check('only the SVG icon and the photo are pictures', len(all_pics) == 2)
    check('photo embedded byte-identical', any(p['bytes'] == photo for p in all_pics))
    icon = next(p for p in all_pics if p['bytes'] != photo)
    check('icon captured at 4x', icon['px'][0] >= 480)
    text = ' '.join(t for s in report for t in s['texts'])
    for phrase in ['Native slides that survive Google Slides', 'Medium 500', 'Heavy 800', 'Shadowed card', 'decorative dot', 'On track', 'for the quarter', 'Half-transparent container text', 'Gradient headline', 'Second point']:
        check(f'text editable: {phrase}', phrase in text)
    check('system-ui mapped to Inter', 'Inter' in report[0]['faces'] and 'Inter' in ' '.join(status['summary']['lines']))
    check('weights become named faces', {'Inter Medium', 'Inter SemiBold', 'Inter Bold', 'Inter ExtraBold'} <= report[0]['faces'])
    check('card shadow is native', '<a:outerShdw' in report[1]['xml'])
    check('gradient flattened is reported', any(w['kind'] == 'gradient-flattened' for w in status['warnings']))
print('DONE', out)
