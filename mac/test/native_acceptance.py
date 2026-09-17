"""Acceptance against a separately launched Dek with DEK_SUPPORT_DIR in a test folder.
Usage: python3 mac/test/native_acceptance.py /tmp/dek-workspace-qa/profile
Never connects to the normal Dek profile; mutations are limited to a fixture deck.
"""
import json, sys, time, urllib.request, re, hashlib
from pathlib import Path
profile=Path(sys.argv[1]).resolve()
assert str(profile).startswith('/private/tmp/') or str(profile).startswith('/tmp/'), 'Use an isolated temporary profile'
state=json.loads((profile/'agent.json').read_text())
def call(tool,args=None,ok=True):
    request=urllib.request.Request(f'http://127.0.0.1:{state["port"]}/rpc',data=json.dumps({'tool':tool,'args':args or {},'author':'Native acceptance'}).encode(),headers={'Authorization':'Bearer '+state['token'],'Content-Type':'application/json'})
    result=json.load(urllib.request.urlopen(request,timeout=35))
    if ok: assert result.get('ok'), (tool,result)
    return result.get('result') if ok else result

def check(label,condition):
    assert condition,label
    print('PASS',label,flush=True)

deck=call('get_deck');path=Path(deck['path']).resolve();root=profile.parent
assert path.parent==root/'decks' and path.name=='workspace.html','Open the isolated workspace fixture first'
original=path.read_text()
check('fixture with hidden slide',deck['count']==5 and deck['slides'][1]['skip'])
rev=deck['revision']
call('update_element',{'slide':1,'selector':'h1','style':{'color':'#aa2244'},'revision':rev})
check('acknowledged write reaches disk','#aa2244' in path.read_text() or '170, 34, 68' in path.read_text())
check('stale mutation is rejected',not call('set_title',{'title':'Stale','revision':rev},False)['ok'])
call('undo');check('undo restores content','aa2244' not in path.read_text())
call('redo');check('redo restores edit','aa2244' in path.read_text() or '170, 34, 68' in path.read_text())
call('arrange_elements',{'slide':3,'selectors':['[data-shape="rectangle"]','[data-shape="ellipse"]'],'action':'group'})
check('shapes group as HTML','dek-group' in call('get_slide',{'slide':3})['html'])
call('arrange_elements',{'slide':3,'selectors':['.dek-group'],'action':'resize','width':860,'height':320})
check('group resize scales child geometry','width: 400px' in call('get_slide',{'slide':3})['html'])
call('undo')
call('arrange_elements',{'slide':3,'selectors':['.dek-group'],'action':'ungroup'})
check('ungroup retains shapes','dek-group' not in call('get_slide',{'slide':3})['html'])
call('arrange_elements',{'slide':3,'selectors':['[data-shape="rectangle"]'],'action':'lock'})
check('locked content rejects legacy edits',not call('update_element',{'slide':3,'selector':'[data-shape="rectangle"]','style':{'opacity':'.2'}},False)['ok'])
call('arrange_elements',{'slide':3,'selectors':['[data-shape="rectangle"]'],'action':'unlock'})
call('set_slide_visibility',{'slides':[1,3],'hidden':True})
check('batch visibility',sum(s['skip'] for s in call('get_deck')['slides'])==3)
call('undo');check('one undo restores batch',sum(s['skip'] for s in call('get_deck')['slides'])==1)
call('batch_slides',{'slides':[1,3],'action':'move','to':3})
check('batch order',[s['id'] for s in call('get_deck')['slides']]==['hidden','fragments','intro','objects','complex'])
call('undo')
call('batch_slides',{'slides':[1,4],'action':'duplicate'})
d=call('get_deck');check('duplicate IDs',d['count']==7 and len({s['id'] for s in d['slides']})==7)
call('undo')
a=call('manage_section',{'action':'create','name':'Opening'})['id'];b=call('manage_section',{'action':'create','name':'Details'})['id']
call('batch_slides',{'slides':[1,2],'action':'section','section_id':a});call('batch_slides',{'slides':[3,4,5],'action':'section','section_id':b})
call('manage_section',{'action':'reorder','id':b,'to':1})
check('section reorder moves contents',[s['id'] for s in call('get_deck')['slides']]==['objects','fragments','complex','intro','hidden'])
call('undo');check('undo section reorder',call('get_deck')['slides'][0]['id']=='intro')
source_dir=root/'source';source_dir.mkdir(exist_ok=True)
(source_dir/'asset.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>')
source=source_dir/'source.html';source.write_text('<html><head></head><body><template data-dek-component="badge"><b>Different component</b></template><section id="copy"><div data-dek-use="badge"></div><img src="asset.svg"></section></body></html>')
before=hashlib.sha256(source.read_bytes()).hexdigest()
call('copy_slides',{'source':str(source),'slides':[1],'at':6})
html=call('get_slide',{'slide':6})['html'];ref=re.search(r'<img[^>]*src="([^"]+)"',html).group(1)
check('cross-deck asset copied',(path.parent/ref).exists())
check('component collision renamed','data-dek-use="badge-' in html)
check('source unchanged',hashlib.sha256(source.read_bytes()).hexdigest()==before)
call('undo');check('copy is one undo',call('get_deck')['count']==5)
call('write_deck',{'html':original})
call('goto',{'slide':2});call('present',{'action':'start'})
check('presentation starts after hidden slide',call('get_deck')['current']==3)
check('presentation rejects mutations',not call('set_title',{'title':'Interrupt'},False)['ok'])
call('goto',{'slide':2,'show_hidden':True});check('explicit hidden slide can be shown',call('get_deck')['current']==2)
call('navigate',{'action':'next'});check('navigation leaves hidden slide',call('get_deck')['current']==3)
call('goto',{'slide':4,'step':0});call('navigate',{'action':'next'});check('fragments advance within slide',call('get_state')['step']==1)
call('present',{'action':'black'});call('present',{'action':'clear'});call('present',{'action':'stop'})
call('set_slide_visibility',{'slides':[1,2,3,4,5],'hidden':True});call('present',{'action':'start'});check('all-hidden deck does not present',not call('get_deck')['presenting']);call('undo')
call('write_deck',{'html':original})
# External disk changes must become a new revision without being overwritten.
old=call('get_deck')['revision'];changed=path.read_text().replace('<title>Workspace acceptance</title>','<title>External change</title>');path.write_text(changed)
for _ in range(30):
    if call('get_deck')['title']=='External change':break
    time.sleep(.1)
check('external file change is loaded',call('get_deck')['title']=='External change')
check('old revision remains stale',not call('set_title',{'title':'Lost external change','revision':old},False)['ok'])
call('write_deck',{'html':original})
# A failed atomic write must retain both the old file and recoverable local content.
old=path.read_text()
try:
    path.parent.chmod(0o555)
    failed=call('set_title',{'title':'Recoverable local title'},False)
    check('save failure is explicit',not failed['ok'] and 'save_failed' in failed['error'])
    check('failed save preserves original disk file',path.read_text()==old)
    check('failed save retains local content',call('get_deck')['title']=='Recoverable local title')
    check('failed save creates recovery file',any('Recoverable local title' in f.read_text() for f in profile.rglob('*.html')))
finally:
    path.parent.chmod(0o755)
call('set_title',{'title':'Workspace acceptance'})
check('save can retry after permissions recover','Workspace acceptance' in path.read_text())
call('write_deck',{'html':old.replace('photo.svg','missing-image.png')})
job=call('export_deck',{'format':'pdf','path':str(root/'missing-asset.pdf'),'overwrite':True})['job_id']
for _ in range(150):
    status=call('get_export_status',{'job_id':job})
    if status['status'] in ['failed','completed']:break
    time.sleep(.1)
check('missing image rejects incomplete export',status['status']=='failed' and 'missing-image.png' in status['error'] and not (root/'missing-asset.pdf').exists())
call('write_deck',{'html':old})

# Export jobs run without changing editor selection or position.
call('goto',{'slide':3});selected=call('get_selection');before=call('get_state');jobs={}
for fmt,mode,name,include in [('pdf','editable','deck.pdf',False),('pptx','editable','editable.pptx',False),('pptx','image','appearance.pptx',False),('pdf','editable','all-slides.pdf',True)]:
    jobs[name]=call('export_deck',{'format':fmt,'mode':mode,'path':str(root/name),'includeHidden':include,'overwrite':True})['job_id']
for name,job in jobs.items():
    deadline=time.time()+90
    while True:
        status=call('get_export_status',{'job_id':job})
        if status['status'] in ['completed','failed','cancelled']:break
        assert time.time()<deadline,'Export timeout';time.sleep(.2)
    check(name+' complete',status['status']=='completed' and Path(status['path']).stat().st_size>100)
    check(name+' page count',status['completed']==(5 if name=='all-slides.pdf' else 4))
    (root/(name+'.result.json')).write_text(json.dumps(status,indent=2))
check('exports preserve current position',call('get_state')['current']==before['current'])
call('snapshot_slide',{'slide':1,'out':str(root/'snapshot.png')});call('snapshot_overview',{'out':str(root/'overview.png')})
check('snapshots preserve current position',call('get_state')['current']==before['current'])
job=call('export_deck',{'format':'pptx','path':str(root/'cancelled.pptx'),'overwrite':True})['job_id'];call('cancel_export',{'job_id':job});check('cancelled job is explicit',call('get_export_status',{'job_id':job})['status']=='cancelled')
call('batch_slides',{'slides':[1,2,3,4,5],'action':'delete'});check('empty deck is valid',call('get_deck')['count']==0)
call('add_slide',{'html':'<section><h1>New start</h1></section>'});check('empty deck can be edited',call('get_deck')['count']==1)
call('write_deck',{'html':original})
print('Native acceptance complete',flush=True)
