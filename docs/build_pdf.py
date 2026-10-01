"""Renders project_documentation.html to Project_Documentation.pdf (A4) with headless Chrome.
Usage: python docs/build_pdf.py [youtube_url]"""
import asyncio
import pathlib
import sys

from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).parent


async def main(video):
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome')
        page = await b.new_page()
        await page.goto((HERE / 'project_documentation.html').as_uri(), wait_until='load')
        await page.evaluate('document.fonts.ready')
        if video:
            await page.evaluate(r"u => { const a = document.createElement('a'); a.href = u; a.textContent = u.replace(/^https?:\/\//, '');"
                                " document.getElementById('video-link').replaceChildren(a); }", video)
        await page.pdf(path=str(HERE / 'Project_Documentation.pdf'), format='A4', print_background=True,
                       display_header_footer=True, header_template='<span></span>',
                       footer_template='<div style="font: 7pt Segoe UI, sans-serif; color: #9a8f8c; width: 100%; text-align: center;">'
                                       'Coronary Risk Explorer · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
                       margin={'top': '13mm', 'bottom': '14mm', 'left': '14mm', 'right': '14mm'}, prefer_css_page_size=False)
        await b.close()


asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else None))
print('wrote', HERE / 'Project_Documentation.pdf')
