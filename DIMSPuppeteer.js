const puppeteer = require('puppeteer');
const fs = require('fs');
const BASE_URL = 'https://www.bilesuparadize.lv/lv/search?page=';
const MAX_PAGES = 1;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function processEventLite(page, url) {
    let layoutData = null;
    let ticketData = null;
    const listener = async (response) => {
        const contentType = response.headers()['content-type'];
        const link = response.url();
        if (!contentType || !contentType.includes('application/json')) return;
        try {
            if (link.includes('/tickets') && !ticketData)
                ticketData = await response.json();
            if (link.includes('/layouts/event-') && !layoutData)
                layoutData = await response.json();
        } catch {}
    };
    page.on('response', listener);
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await delay(1000);
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const btn = btns.find(b => b.textContent.includes('Pirkt biļetes'));
            if (btn) btn.click();
        });
        await delay(1000);
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const btn = btns.find(b => b.textContent.includes('Sēdvietas'));
            if (btn) btn.click();
        });
        let tries = 0;
        while ((!layoutData || !ticketData) && tries < 20) {
            await delay(300);
            tries++;
        }
        page.off('response', listener);
        if (layoutData && ticketData?.tickets) {
            const availableIds = new Set(ticketData.tickets);
            return layoutData.map(seat => ({
                ...seat,
                available: availableIds.has(seat.id)
            }));
        }
        return "ieejas biļetes";
    } catch (err) {
        page.off('response', listener);
        return "ieejas biļetes";
    }
}
(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'lv-LV,lv;q=0.9,en-US;q=0.8,en;q=0.7' });
    const results = [];
    for (let i = 1; i <= MAX_PAGES; i++) {
        const url = `${BASE_URL}${i}`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('table.performance-list tbody tr', { timeout: 20000 });
        const events = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('table.performance-list tbody tr'));
            return rows.map(row => {
                const title = row.querySelector('.performance-list__title a')?.innerText.trim() || '';
                const link = row.querySelector('.performance-list__title a')?.href || '';
                const dateText = row.querySelector('.performance-list__date')?.innerText.replace(/\s+/g, ' ').trim() || '';
                const location = row.querySelector('.performance-list__location p')?.innerText.replace(/\s+/g, ' ').trim() || '';
                const allPriceEls = row.querySelectorAll('ul.pricemap li');
                const allPrices = Array.from(allPriceEls)
                    .map(el => el.innerText.replace('€', '').trim())
                    .filter(Boolean)
                    .map(str => parseFloat(str.replace(',', '.')))
                    .filter(num => !isNaN(num));
                const availablePrices = Array.from(row.querySelectorAll('ul.pricemap li.available'))
                    .map(el => el.innerText.replace('€', '').trim())
                    .filter(Boolean)
                    .map(str => parseFloat(str.replace(',', '.')))
                    .filter(num => !isNaN(num));
                const cenaSpan = row.querySelector('.performance-list__pricemap span');
                const cenaTextRaw = cenaSpan?.innerText || '';
                const cenaMatch = cenaTextRaw.match(/Cena:\s*([\d.,]+)/);
                const cenaNumber = cenaMatch ? parseFloat(cenaMatch[1].replace(',', '.')) : null;
                const available = availablePrices.length > 0 || cenaNumber !== null;
                let priceMin = null;
                if (availablePrices.length > 0)
                    priceMin = Math.min(...availablePrices);
                else if (cenaNumber !== null)
                    priceMin = cenaNumber;
                else if (allPrices.length > 0)
                    priceMin = Math.max(...allPrices);
                return {
                    title,
                    date: dateText,
                    location,
                    link: link.startsWith('/') ? 'https://www.bilesuparadize.lv' + link : link,
                    available,
                    priceMin: priceMin !== null ? priceMin + '€' : null
                };
            });
        });
        for (const ev of events) {
            const seats = await processEventLite(page, ev.link);
            ev.seats = seats;
            results.push(ev);
        }
    }
    fs.writeFileSync('events.json', JSON.stringify(results, null, 2), 'utf-8');
    await browser.close();
})();