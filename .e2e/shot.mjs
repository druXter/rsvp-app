import { chromium } from '@playwright/test'
const [file, out, width] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: Number(width), height: 800 } })
await page.goto('file://' + file)
await page.screenshot({ path: out, fullPage: true })
await browser.close()
