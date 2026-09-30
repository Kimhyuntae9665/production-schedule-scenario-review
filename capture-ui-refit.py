import asyncio,json,hashlib,subprocess,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'artifacts/ui-refit'
URL='http://127.0.0.1:5157'
async def state(page):return await page.evaluate("fetch('/api/state').then(r=>r.json())")
async def prepare(page,preset='b'):
    await page.locator('#preset-'+preset).click();await page.locator('#manual').click();await expect(page.locator('#proposal .diff')).to_be_visible()
async def confirm(page):
    await page.locator('#convention').check();await expect(page.locator('#confirm')).to_be_enabled();await page.locator('#confirm').click();await expect(page.locator('#changed-chart svg')).to_be_visible()
async def frame(page,name):
    target={'01-base.png':'.page-header','02-source-ledger.png':'.review','03-outage-7-to-9.png':'.charts','04-review-history.png':'.bottom','05-unconfirmed-previous-plan.png':'#changed-title','06-deadline-c-8.png':'.charts','07-archive-rejected.png':'#proposal','08-unknown-incumbent.png':'.charts','09-stale-source.png':'#proposal'}.get(name)
    if target:
        await page.locator(target).scroll_into_view_if_needed()
        await page.wait_for_timeout(1800)
    await page.screenshot(path=str(OUT/name),full_page=True)
async def main():
    OUT.mkdir(parents=True,exist_ok=True)
    os.environ['PLAYWRIGHT_BROWSERS_PATH']=str(ROOT/'private/browser-runtime')
    checks={'browser':'actual installed Google Chrome via Playwright','modelCalls':0,'gpuCalls':0,'cpuTests':{'node':35,'python':6},'features':[]}
    errors=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox','--disable-gpu'])
        context=await browser.new_context(viewport={'width':1440,'height':1100},record_video_dir=str(ROOT/'private/ui-refit-video'),record_video_size={'width':1440,'height':1100})
        page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        await page.goto(URL);await page.wait_for_selector('#baseline-chart svg');await page.locator('#reset').click();await expect(page.locator('#changed-status')).to_contain_text('미계산');await frame(page,'01-base.png')
        assert (await state(page))['baseline']['makespan']==7
        checks['features'].append({'frame':'01-base.png','baselineMakespan':7,'noChangedPlanBeforeConfirmation':True})
        await page.keyboard.press('Tab');focus=await page.evaluate('document.activeElement.id');assert focus
        await page.locator('#request').focus();await page.keyboard.press('Tab');assert await page.locator('#interpret').evaluate('(n)=>n===document.activeElement')
        assert await page.locator('#interpret').evaluate('(n)=>getComputedStyle(n).outlineColor')=='rgb(179, 65, 0)'
        await prepare(page);proposal=await state(page);assert proposal['changedPlan'] is None and await page.locator('#confirm').is_disabled()
        assert proposal['proposal']['sourceText'] in await page.locator('#proposal').inner_text()
        assert await page.locator('#baseline-table details').get_attribute('open') is not None
        await page.locator('#result-evidence').focus();assert await page.locator('#result-evidence').evaluate('(n)=>n===document.activeElement')
        await frame(page,'02-source-ledger.png');checks['features'].append({'frame':'02-source-ledger.png','exactSource':True,'ledgerVisible':True,'keyboardFocus':True})
        await confirm(page);await expect(page.locator('#metrics')).to_contain_text('9m');current=await state(page);assert current['changedPlan']['makespan']==9 and current['changedVerification']['status']=='VALID'
        axes=await page.locator('.gantt-scroll svg').evaluate_all('(nodes)=>nodes.map(n=>n.getAttribute("viewBox"))');assert axes[0]==axes[1]
        assert await page.locator('#changed-chart svg').text_content() and await page.locator('#changed-chart svg').locator('rect[stroke-dasharray]').count()==1
        proof=json.loads(await page.locator('#result-evidence').inner_text());assert proof['solver']['proof']==current['changedPlan']['proof'] and proof['independentVerifier']==current['changedVerification']
        await frame(page,'03-outage-7-to-9.png');checks['features'].append({'frame':'03-outage-7-to-9.png','baselineMakespan':7,'changedMakespan':9,'sharedAxes':axes,'nativeProofMatchesState':True})
        await page.locator('#review-plan').click();await expect(page.locator('#receipt')).to_be_visible();reviewed=await state(page);receiptHash=reviewed['latestReceipt']['hash'];await page.locator('#review-plan').click();assert (await state(page))['latestReceipt']['hash']==receiptHash
        assert len([h for h in (await state(page))['history'] if h['event']=='plan_reviewed'])==1
        await frame(page,'04-review-history.png');checks['features'].append({'frame':'04-review-history.png','separateHumanReviewAction':True,'repeatedReviewSingleReceipt':True})
        await prepare(page,'c');pending=await state(page);assert pending['changedPlan']['makespan']==9 and pending['planIsCurrent'] is False
        await expect(page.locator('#changed-title')).to_contain_text('이전 확인 계획');assert await page.locator('#review-plan').is_disabled();assert pending['plannedProposal']['sourceText'] in await page.locator('#displayed-plan-source').inner_text()
        assert pending['latestReceipt']['hash']==receiptHash and pending['receiptCompatibility']['current'] is False
        await frame(page,'05-unconfirmed-previous-plan.png');checks['features'].append({'frame':'05-unconfirmed-previous-plan.png','previousPlanSourceRetained':True,'currentProposalUnconfirmed':True,'receiptHistorical':True})
        await confirm(page);await expect(page.locator('#metrics')).to_contain_text('8m');deadline=await state(page);assert deadline['changedPlan']['makespan']==8
        await expect(page.locator('#changed-chart svg')).to_contain_text('J4 deadline 4');await frame(page,'06-deadline-c-8.png');checks['features'].append({'frame':'06-deadline-c-8.png','makespan':8,'hardDeadline':4})
        await page.locator('#case').select_option('E1');await page.locator('#recorded').click();await expect(page.locator('#proposal')).to_contain_text('ARCHIVE_REJECTED');assert await page.locator('#confirm').is_disabled()
        assert await page.locator('#proposal details').get_attribute('open') is not None
        await frame(page,'07-archive-rejected.png');checks['features'].append({'frame':'07-archive-rejected.png','frozenArchiveOnly':True,'confirmationDisabled':True,'rawOriginalProposalVisible':True})
        await page.locator('#reject').click();assert (await state(page))['proposal'] is None and (await state(page))['baseline']['makespan']==7
        await page.locator('#reset').click();await prepare(page);await page.locator('#budget').select_option('limited');await confirm(page);await expect(page.locator('#changed-status')).to_contain_text('UNKNOWN');unknown=await state(page);assert unknown['changedVerification']['status']=='VALID'
        await frame(page,'08-unknown-incumbent.png');checks['features'].append({'frame':'08-unknown-incumbent.png','solver':'UNKNOWN','independentVerifier':'VALID','optimumClaim':False})
        old=unknown['proposal'];await prepare(page,'c')
        stale=await page.evaluate('''async(p)=>{const r=await fetch('/api/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({proposalId:p.id,proposalHash:p.proposalHash,sourceFingerprint:p.sourceFingerprint,confirmConvention:true})});return {status:r.status,body:await r.json()}}''',old);assert stale['status']==409
        await page.locator('#calendar').click();await expect(page.locator('#proposal')).to_contain_text('STALE');assert await page.locator('#confirm').is_disabled();await frame(page,'09-stale-source.png');checks['features'].append({'frame':'09-stale-source.png','staleInspectionResponse':409,'calendarInvalidatesProposal':True})
        # Deadline beyond the viewport must remain within both identical native axes.
        await page.locator('#reset').click();await prepare(page,'c');await page.locator('#deadline').fill('30');await page.locator('#manual').click();await confirm(page)
        axis=await page.locator('.gantt-scroll svg').evaluate_all('(ns)=>ns.map(n=>({viewBox:n.getAttribute("viewBox"),width:n.getBoundingClientRect().width}))');assert axis[0]==axis[1] and axis[0]['width']>=1206
        await page.locator('#changed-chart').evaluate('(n)=>n.scrollLeft=n.scrollWidth');assert await page.locator('#changed-chart').evaluate('(n)=>n.scrollLeft>0')
        checks['deadline30NativeAxes']=axis
        await page.locator('#reset').click();await prepare(page);await confirm(page)
        mobile=await browser.new_page(viewport={'width':390,'height':1000});mobile.on('pageerror',lambda e:errors.append(str(e)));await mobile.goto(URL);await mobile.wait_for_selector('#baseline-chart svg')
        assert await mobile.evaluate('document.documentElement.scrollWidth')==390
        fonts=await mobile.evaluate('''()=>{const ns=[...document.querySelectorAll('body *')].filter(n=>n.getBoundingClientRect().width&&n.getBoundingClientRect().height&&(n.textContent?.trim()||['INPUT','SELECT','TEXTAREA'].includes(n.tagName)));return {minimum:Math.min(...ns.map(n=>parseFloat(getComputedStyle(n).fontSize))),title:getComputedStyle(document.querySelector('.page-title')).fontSize,titleWidth:document.querySelector('.page-title').getBoundingClientRect().width,titleScrollWidth:document.querySelector('.page-title').scrollWidth}}''');assert fonts['minimum']>=14 and fonts['title']=='28px' and fonts['titleScrollWidth']<=358
        await mobile.locator('#changed-chart').evaluate('(n)=>n.scrollLeft=n.scrollWidth');assert await mobile.locator('#changed-chart').evaluate('(n)=>n.scrollLeft>0')
        await frame(mobile,'10-mobile-390.png');checks['features'].append({'frame':'10-mobile-390.png','viewportWidth':390,'documentWidth':390,'fonts':fonts,'nativeChartScroll':True})
        # A delayed actual response exposes busy status and disables repeated mutations.
        async def delay(route):await asyncio.sleep(.5);await route.continue_()
        await mobile.route('**/api/propose',delay);await mobile.locator('#manual').click(no_wait_after=True);await expect(mobile.locator('#manual')).to_be_disabled();await expect(mobile.locator('#status')).to_contain_text('기다리는 중');await expect(mobile.locator('#manual')).to_be_enabled();await mobile.unroute('**/api/propose',delay)
        checks['delayedActualResponseBusyGuard']=True;checks['browserErrors']=errors;assert not errors
        video=page.video;await context.close();videoPath=await video.path();await mobile.close();await browser.close()
    subprocess.run(['ffmpeg','-y','-i',videoPath,'-c:v','libx264','-crf','25','-pix_fmt','yuv420p','-movflags','+faststart',str(OUT/'scenario-review-current.mp4')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    checks['video']={'path':'artifacts/ui-refit/scenario-review-current.mp4','description':'Actual automated browser flow: base, source ledger, outage, local review, previous plan, deadline, archive rejection, UNKNOWN, stale source and deadline-30 native scrolling. Mobile is a separate screenshot; no narration or new inference.'}
    (OUT/'browser-checks.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'features':len(checks['features']),'browserErrors':errors,'modelCalls':0,'gpuCalls':0,'checks':'artifacts/ui-refit/browser-checks.json'}))
if __name__=='__main__':asyncio.run(main())
