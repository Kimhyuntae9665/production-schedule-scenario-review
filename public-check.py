import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent
URL='https://github.com/Kimhyuntae9665/production-schedule-scenario-review'
async def main():
    result=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True,executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        for width in [360,390,1440]:
            page=await browser.new_page(viewport={'width':width,'height':1000})
            response=await page.goto(URL,wait_until='domcontentloaded',timeout=60000)
            image=page.locator('article img[alt^="Form and optional Qwen"]');await image.wait_for();await image.scroll_into_view_if_needed();await image.evaluate('(img)=>img.decode()')
            facts=await image.evaluate('(img)=>({loaded:img.complete&&img.naturalWidth>0,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,displayWidth:img.getBoundingClientRect().width})')
            assert response.status==200 and facts['loaded'];assert facts['displayWidth']<=width
            await page.screenshot(path=str(ROOT/f'artifacts/media/published-{width}.png'))
            result.append({'width':width,'pageStatus':response.status,**facts})
            await page.close()
        await browser.close()
    (ROOT/'artifacts/published-checks.json').write_text(json.dumps({'repo':URL,'browser':'actual Google Chrome via Playwright','diagram':result},indent=2))
if __name__=='__main__':asyncio.run(main())

