import Parser from 'rss-parser'
import OpenAI from 'openai'
import { z } from 'zod'
import * as cheerio from 'cheerio'
import type { ScrapedDeal, SelectedDeal } from '../types'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

/**
 * GPT MUST NOT create merchant_url.
 * We ONLY use the one scraped from DealNews.
 *
 * So the schema is now ONLY:
 * - product_description
 * - price
 * - url   (DealNews page)
 */
const DealSelectionSchema = z.object({
  deals: z.array(
    z.object({
      product_description: z.string(),
      price: z.number(),
      url: z.string(),
    })
  ),
})

export class ScannerAgent {
  private parser = new Parser()

  private RSS_FEEDS = [
    'https://www.dealnews.com/?rss=1&sort=time',
    'https://www.dealnews.com/?rss=1&sort=hotness',
    'https://www.dealnews.com/f1682/Staff-Pick/?rss=1',
  ]

  /**
   * Scrapes the DealNews page fully,
   * extracting:
   * - details
   * - features
   * - merchantUrl (the Buy Now link)
   */
  private async fetchDealPage(
    url: string
  ): Promise<{ details: string; features: string; merchantUrl: string | null }> {
    try {
      const response = await fetch(url)
      const html = await response.text()
      const $ = cheerio.load(html)

      const contentSection = $('.content-section').text()

      // Try all known selectors for the Buy Now link
      const rawMerchantUrl =
        $('.snippet-more-link').attr('href') || // common
        $('.snippet.external-links a').attr('href') ||
        $('a:contains("Buy Now")').attr('href') ||
        $('a:contains("Shop Now")').attr('href') ||
        null

      const merchantUrl = rawMerchantUrl || null

      if (!contentSection) {
        return { details: '', features: '', merchantUrl }
      }

      let text = contentSection.replace(/\nmore/g, '').replace(/\n/g, ' ')

      if (text.includes('Features')) {
        const [details, features] = text.split('Features', 2)
        return {
          details: details.trim(),
          features: features.trim(),
          merchantUrl,
        }
      }

      return {
        details: text.trim(),
        features: '',
        merchantUrl,
      }
    } catch (err) {
      console.error(`Failed to fetch deal page ${url}:`, err)
      return { details: '', features: '', merchantUrl: null }
    }
  }

  /**
   * Fetches RSS → loads DealNews pages → returns ScrapedDeal[]
   */
  async fetchDeals(): Promise<ScrapedDeal[]> {
    const start = Date.now()
    console.log('📡 Scanner Agent: Starting RSS feed scan...')
    console.log(`   RSS Feeds to scan: ${this.RSS_FEEDS.length}`)

    const deals: ScrapedDeal[] = []
    let feedsSuccessful = 0
    let feedsFailed = 0

    for (const feedUrl of this.RSS_FEEDS) {
      const feedStart = Date.now()

      try {
        console.log(`   📥 Fetching: ${feedUrl}`)
        const feed = await this.parser.parseURL(feedUrl)

        console.log(`      ✅ Loaded feed: ${feed.items.length} items`)
        const items = feed.items.slice(0, 10)
        console.log(`      📋 Processing: ${items.length} items`)

        for (const item of items) {
          const url = item.link || ''
          if (!url) continue

          const $ = cheerio.load(item.summary || item.content || '')
          let summary = $('.snippet.summary').text() || item.contentSnippet || ''
          summary = summary.replace(/<[^>]+>/g, '').trim()

          const { details, features, merchantUrl } = await this.fetchDealPage(url)

          deals.push({
            title: item.title || '',
            summary: summary.replace(/\n/g, ' '),
            details,
            features,
            url, // DealNews URL
            merchantUrl, // direct merchant link or null
          })

          await new Promise((res) => setTimeout(res, 500))
        }

        feedsSuccessful++
        console.log(
          `      ⏱️  Feed processed in ${(
            (Date.now() - feedStart) /
            1000
          ).toFixed(2)}s`
        )
      } catch (err) {
        feedsFailed++
        console.error(`      ❌ Failed to fetch feed:`, err)
      }
    }

    const total = ((Date.now() - start) / 1000).toFixed(2)
    console.log(`📡 Scanner Agent: RSS scan complete`)
    console.log(`   ✅ Successful: ${feedsSuccessful}/${this.RSS_FEEDS.length}`)
    console.log(`   ❌ Failed: ${feedsFailed}/${this.RSS_FEEDS.length}`)
    console.log(`   📊 Total deals scraped: ${deals.length}`)
    console.log(`   ⏱️  Total time: ${total}s`)

    return deals
  }

  /**
   * GPT chooses the best deals.
   *
   * IMPORTANT:
   * GPT does NOT create merchant_url.
   * We map back using the scraped deals.
   */
  async selectBestDeals(deals: ScrapedDeal[]): Promise<SelectedDeal[]> {
    console.log('🤖 Scanner Agent: Starting GPT deal selection...')
    console.log(`   📥 Input: ${deals.length} scraped deals`)

    // Map for recovering the scraped merchantUrl
    const dealByUrl = new Map<string, ScrapedDeal>()
    for (const d of deals) dealByUrl.set(d.url, d)

    const prompt = `
From the deals below, select the 5 best with the most detailed descriptions and clear prices.

RULES:
1. Only include deals with a clear numeric price (e.g., "$49" or "$79.99")
2. Ignore deals that mention only savings ("save $50", "$50 off", "50% off")
3. The product description must be 3–4 sentences long
4. The JSON MUST NOT include any fields except:
   - product_description
   - price
   - url

Return ONLY valid JSON like:
{
  "deals": [
    {
      "product_description": "...",
      "price": 123.45,
      "url": "https://..."
    }
  ]
}

Deals:
${deals
  .map(
    (d, i) => `
--- Deal ${i + 1} ---
Title: ${d.title}
Details: ${d.details}
Features: ${d.features}
URL: ${d.url}
Direct Merchant URL: ${d.merchantUrl || 'null'}
`
  )
  .join('\n')}
`.trim()

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You select deals with clear prices. You return ONLY JSON with no extra text.',
          },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      })

      const raw = response.choices[0].message.content
      if (!raw) throw new Error('GPT returned no content')

      const parsed = DealSelectionSchema.parse(JSON.parse(raw))

      const validDeals = parsed.deals.filter((d) => d.price > 0)

      // Attach BACK the real merchantUrl from scraping
      return validDeals.map((d) => {
        const original = dealByUrl.get(d.url)
        return {
          product_description: d.product_description,
          price: d.price,
          url: d.url, // DealNews URL
          merchantUrl: original?.merchantUrl ?? null, // REAL store link
        }
      })
    } catch (err) {
      console.error('❌ Deal selection error:', err)
      return []
    }
  }

  async scan(): Promise<SelectedDeal[]> {
    const scraped = await this.fetchDeals()
    const selected = await this.selectBestDeals(scraped)
    return selected
  }
}
