import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parent
async def main():
    out=ROOT/'artifacts/media';out.mkdir(exist_ok=True)
    os.environ['PLAYWRIGHT_BROWSERS_PATH']=str(ROOT/'private/browser-runtime')
    evaluation=json.loads((ROOT/'artifacts/model-evaluation.json').read_text())
    facts=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox','--disable-gpu'])
        context=await browser.new_context(viewport={'width':1440,'height':1100},record_video_dir=str(ROOT/'private/model-video'),record_video_size={'width':1440,'height':1100})
        page=await context.new_page();await page.goto('http://127.0.0.1:5077');await page.wait_for_selector('#baseline-chart svg');await page.locator('#reset').click()
        for case in ['E1','E3','E10','E6']:
            original=next(c for c in evaluation['cases'] if c['id']==case)
            await page.locator('#case').select_option(case);await page.locator('#recorded').click();await expect(page.locator('#proposal .quote').first).to_contain_text(original['proposal']['sourceText']);await expect(page.locator('#proposal')).to_contain_text('ARCHIVE_REJECTED')
            await page.locator('#convention').check();assert await page.locator('#confirm').is_disabled();await page.locator('#proposal summary').focus();await page.keyboard.press('Enter');await expect(page.locator('#proposal details')).to_have_attribute('open','')
            await page.locator('#proposal').scroll_into_view_if_needed();await page.wait_for_timeout(1100);await page.screenshot(path=str(out/f'model-{case}-rejected.png'),full_page=True)
            current=await page.evaluate("fetch('/api/state').then(r=>r.json())");original=next(c for c in evaluation['cases'] if c['id']==case)
            assert current['proposal']['archivedProposal']['sourceText']==original['proposal']['sourceText'];assert current['changedPlan'] is None and current['latestReceipt'] is None
            facts.append({'caseId':case,'archivedRawStatus':original['proposal']['status'],'displayStatus':current['proposal']['status'],'confirmationDisabled':True,'changedPlan':None,'receipt':None,'originalSourcePreserved':True})
        await page.locator('#calendar').click();await expect(page.locator('#proposal')).to_contain_text('STALE / ARCHIVE_REJECTED');assert await page.locator('#confirm').is_disabled();await page.wait_for_timeout(1100);await page.screenshot(path=str(out/'model-calendar-stale.png'),full_page=True)
        stale=await page.evaluate("fetch('/api/state').then(r=>r.json())");assert stale['proposal']['validation']['status']=='STALE';assert stale['proposal']['archivedProposal']['sourceFingerprint']!=stale['sourceFingerprint']
        await page.locator('#reset').click();await page.locator('#preset-b').click();await page.locator('#manual').click();await page.locator('#convention').check();await page.locator('#confirm').click();await expect(page.locator('#changed-status')).to_contain_text('OPTIMAL');await page.locator('#metrics').scroll_into_view_if_needed();await page.wait_for_timeout(2000);await page.screenshot(path=str(out/'model-manual-fallback.png'),full_page=True)
        current=await page.evaluate("fetch('/api/state').then(r=>r.json())");assert current['changedPlan']['makespan']==9 and current['changedVerification']['status']=='VALID' and current['latestReceipt'] is None
        video=page.video;await context.close();await video.save_as(str(out/'recorded-model-review.webm'))
        mobile=await browser.new_page(viewport={'width':390,'height':1000});await mobile.goto('http://127.0.0.1:5077');await mobile.locator('#reset').click();await mobile.locator('#case').select_option('E1');await mobile.locator('#recorded').click();await expect(mobile.locator('#proposal')).to_contain_text('ARCHIVE_REJECTED');await mobile.locator('#proposal summary').click();assert await mobile.evaluate('document.documentElement.scrollWidth')==390;assert await mobile.locator('#confirm').is_disabled();await mobile.screenshot(path=str(out/'model-mobile-390.png'),full_page=True);await browser.close()
    (ROOT/'artifacts/model-browser-checks.json').write_text(json.dumps({'browser':'actual installed Google Chrome via Playwright','mediaKind':'Replay of actual frozen Qwen outputs; no live inference in this capture','modelCallsInCapture':0,'humanAcceptedModelProposals':0,'browserAutomation':True,'replayCases':facts,'archivedSourceCalendarChange':{'validation':'STALE','display':'STALE / ARCHIVE_REJECTED','confirmationDisabled':True,'originalFingerprintPreserved':True},'explicitManualFallback':{'solver':'OPTIMAL','verifier':'VALID','makespan':9,'receiptCreated':False},'rejectionSourceKeyboardFocusable':True,'mobileWidth':390,'viewportShrinking':False},indent=2)+'\n')
if __name__=='__main__':asyncio.run(main())
