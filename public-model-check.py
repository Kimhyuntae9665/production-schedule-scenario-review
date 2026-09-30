import asyncio,json,subprocess
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent
URL='https://github.com/Kimhyuntae9665/production-schedule-scenario-review'
async def main():
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    published_url=URL+'/tree/'+commit
    result=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True,executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--disable-gpu'])
        for width in [360,390,1440]:
            page=await browser.new_page(viewport={'width':width,'height':1000});response=await page.goto(published_url,wait_until='domcontentloaded',timeout=60000)
            rows=[]
            for label,selector in [('architecture','article img[alt^="Form and optional Qwen"]'),('modelReplay','article img[alt^="Actual browser replay"]')]:
                image=page.locator(selector);await image.wait_for();await image.scroll_into_view_if_needed();await image.evaluate('(img)=>img.decode()')
                facts=await image.evaluate('(img)=>({loaded:img.complete&&img.naturalWidth>0,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,displayWidth:img.getBoundingClientRect().width})');assert response.status==200 and facts['loaded'] and facts['displayWidth']<=width;rows.append({'kind':label,**facts})
            await page.screenshot(path=str(ROOT/f'artifacts/media/published-model-{width}.png'));result.append({'width':width,'pageStatus':response.status,'images':rows});await page.close()
        await browser.close()
    (ROOT/'artifacts/published-model-checks.json').write_text(json.dumps({'repo':URL,'publishedCommit':commit,'checkedUrl':published_url,'browser':'actual installed Google Chrome via Playwright','modelCalls':0,'checks':result},indent=2)+'\n')
if __name__=='__main__':asyncio.run(main())
