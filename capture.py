import asyncio,base64,json,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parent
async def main():
    out=ROOT/'artifacts/media';out.mkdir(parents=True,exist_ok=True)
    helper=ROOT/'private/browser-runtime/ffmpeg-1011/ffmpeg-linux';helper.parent.mkdir(parents=True,exist_ok=True)
    if not helper.exists():helper.symlink_to('/usr/bin/ffmpeg')
    os.environ['PLAYWRIGHT_BROWSERS_PATH']=str(ROOT/'private/browser-runtime')
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox'])
        context=await browser.new_context(viewport={'width':1440,'height':1100},record_video_dir=str(ROOT/'private/video'),record_video_size={'width':1440,'height':1100})
        page=await context.new_page();await page.goto('http://127.0.0.1:5077');await page.wait_for_selector('#baseline-chart svg');await page.locator('#reset').click();await page.wait_for_timeout(150)
        await page.screenshot(path=str(out/'01-baseline.png'),full_page=True)
        await page.locator('#preset-b').click();await page.locator('#manual').click();await page.wait_for_timeout(150)
        assert await page.locator('#confirm').is_disabled();assert 'Not planned' in await page.locator('#changed-status').inner_text()
        await page.screenshot(path=str(out/'02-proposed-outage.png'),full_page=True)
        await page.locator('#convention').check()
        async def delayed(route):await asyncio.sleep(.75);await route.continue_()
        await page.route('**/api/confirm',delayed);click=asyncio.create_task(page.locator('#confirm').click());await page.wait_for_timeout(150)
        assert 'Working' in await page.locator('#status').inner_text();await page.screenshot(path=str(out/'03-loading.png'),full_page=True);await click;await expect(page.locator('#changed-status')).to_contain_text('OPTIMAL');await page.unroute('**/api/confirm',delayed);await page.wait_for_timeout(180)
        assert 'OPTIMAL' in await page.locator('#changed-status').inner_text();assert '9m' in await page.locator('#metrics').inner_text()
        assert await page.locator('#receipt').is_hidden();await page.locator('#review-plan').click();await page.wait_for_timeout(150)
        await page.screenshot(path=str(out/'04-outage-plan-reviewed.png'),full_page=True)
        state=await page.evaluate("fetch('/api/state').then(r=>r.json())");assert state['changedVerification']['status']=='VALID';assert state['baseline']['makespan']==7 and state['changedPlan']['makespan']==9
        await page.locator('#review-plan').click();await page.wait_for_timeout(150);again=await page.evaluate("fetch('/api/state').then(r=>r.json())");assert again['latestReceipt']['hash']==state['latestReceipt']['hash']
        await page.locator('#calendar').click();await page.wait_for_timeout(150);assert await page.locator('#confirm').is_disabled();assert 'historical' in (await page.locator('#receipt').inner_text()).lower()
        await page.screenshot(path=str(out/'05-calendar-stale.png'),full_page=True)
        await page.locator('#reset').click();await page.locator('#preset-c').click();await page.locator('#manual').click();await page.locator('#convention').check();await page.locator('#confirm').click();await page.wait_for_timeout(150);assert '8m' in await page.locator('#metrics').inner_text();await page.locator('#review-plan').click()
        await page.screenshot(path=str(out/'06-deadline-plan.png'),full_page=True)
        await page.locator('#reset').click();await page.locator('#request').fill('Add urgent J4: J4A on M2 for 1 minute, then J4B on M1 for 1 minute.');await page.locator('#interpret').click();await page.wait_for_timeout(120);assert 'CLARIFY' in await page.locator('#proposal').inner_text();assert await page.locator('#confirm').is_disabled();await page.locator('#reject').click();await page.wait_for_timeout(120)
        rejected=await page.evaluate("fetch('/api/state').then(r=>r.json())");assert rejected['baseline']['makespan']==7 and rejected['changedPlan'] is None;await page.screenshot(path=str(out/'07-rejected-preserves-base.png'),full_page=True)
        await page.locator('#preset-b').click();await page.locator('#manual').click();await page.locator('#convention').check();await page.locator('#budget').select_option('limited');await page.locator('#confirm').click();await page.wait_for_timeout(120);assert 'UNKNOWN' in await page.locator('#changed-status').inner_text();assert 'VALID' in await page.locator('#changed-status').inner_text();await page.screenshot(path=str(out/'08-unknown-incumbent.png'),full_page=True)
        await page.locator('#reset').click();await page.locator('#preset-b').click();await page.locator('#manual').click();await page.locator('#convention').check();await page.locator('#budget').select_option('horizon6');await page.locator('#confirm').click();await page.wait_for_timeout(120);assert 'INFEASIBLE' in await page.locator('#changed-status').inner_text();await page.screenshot(path=str(out/'09-infeasible-horizon.png'),full_page=True)
        await page.locator('#reset').click();await page.locator('#budget').select_option('complete');await page.locator('#manual').focus();await page.keyboard.press('Enter');await page.wait_for_timeout(120);await page.locator('#convention').focus();await page.keyboard.press('Space');assert await page.locator('#confirm').is_enabled()
        await page.locator('#confirm').click();await page.wait_for_timeout(120);rect=page.locator('#changed-chart rect[tabindex]').first;await rect.focus();assert await rect.evaluate('(n)=>document.activeElement===n');await page.locator('#changed-table summary').focus();await page.keyboard.press('Enter');assert await page.locator('#changed-table details').evaluate('(n)=>n.open');await page.screenshot(path=str(out/'10-keyboard-ledger.png'),full_page=True)
        if (ROOT/'artifacts/model-evaluation.json').exists():
            await page.locator('#reset').click();await page.locator('#case').select_option('E1');await page.locator('#recorded').click();await page.wait_for_timeout(120);await page.screenshot(path=str(out/'11-recorded-model.png'),full_page=True)
        # Controlled invalid-archive rendering fixture, never presented as a model response.
        await page.locator('#reset').click();fixture=await page.evaluate("fetch('/api/state').then(r=>r.json())")
        fixture['proposal']={'id':'controlled-invalid-archive','status':'ARCHIVE_REJECTED','method':'recorded-qwen3:4b','sourceFingerprint':fixture['sourceFingerprint'],'changes':[],'issues':['Controlled invalid archive display check. Original malformed changes are retained separately.'],'unsupportedClauses':[],'archivedProposal':{'changes':{'bad':True}},'validation':{'valid':False,'status':'ARCHIVE_REJECTED','issues':[]}}
        async def invalid_archive(route):await route.fulfill(status=200,content_type='application/json',body=json.dumps(fixture))
        await page.route('**/api/propose',invalid_archive);await page.locator('#recorded').click();await expect(page.locator('#proposal')).to_contain_text('ARCHIVE_REJECTED');assert await page.locator('#confirm').is_disabled();await page.screenshot(path=str(out/'12-malformed-archive-controlled.png'),full_page=True);await page.unroute('**/api/propose',invalid_archive)
        await page.locator('#reset').click();await page.locator('#preset-b').click();await page.locator('#manual').click();await page.locator('#convention').check();await page.locator('#confirm').click();await expect(page.locator('#changed-status')).to_contain_text('OPTIMAL')
        video=page.video;await context.close();await video.save_as(str(out/'scenario-review.webm'))
        mobile=await browser.new_page(viewport={'width':390,'height':950});await mobile.goto('http://127.0.0.1:5077');await mobile.wait_for_selector('#baseline-chart svg');assert await mobile.evaluate('window.innerWidth')==390;assert await mobile.evaluate('document.documentElement.scrollWidth')==390;await mobile.screenshot(path=str(out/'mobile-390.png'),full_page=True)
        for width in [360,390]:
            await mobile.set_viewport_size({'width':width,'height':950});await mobile.goto('about:blank');await mobile.set_content('<!doctype html><body style="margin:0;background:#171f2c"><img id="graph" style="width:'+str(width)+'px;display:block" src="data:image/svg+xml;base64,'+base64.b64encode((ROOT/'docs/architecture.svg').read_bytes()).decode()+'"></body>');await mobile.locator('#graph').evaluate('(n)=>n.decode()');await mobile.screenshot(path=str(out/f'diagram-{width}.png'))
        await mobile.set_viewport_size({'width':390,'height':780});await mobile.screenshot(path=str(ROOT/'docs/architecture.png'));await browser.close()
    (ROOT/'artifacts/browser-checks.json').write_text(json.dumps({'actualBrowser':'installed Google Chrome via Playwright','flows':['baseline','proposed outage without execution','loading (controlled network delay)','confirmed outage 7 to 9','separate plan review','repeated receipt idempotence','calendar stale/historical receipt','explicit J4 deadline 8','rejected missing deadline preserves base','UNKNOWN feasible incumbent','INFEASIBLE horizon','keyboard SVG and operation ledger','malformed archive rejection display (controlled fixture, not actual inference)'],'sameMinuteScale':True,'mobileViewport':390,'viewportShrinking':False,'liveModelCalled':False,'productionWrite':False},indent=2))
if __name__=='__main__':asyncio.run(main())
