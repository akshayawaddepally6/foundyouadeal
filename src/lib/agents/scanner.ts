import Parser from 'rss-parser'
import OpenAI from 'openai'
import { z } from 'zod'
import * as cheerio from 'cheerio'
import type { ScrapedDeal, SelectedDeal } from '../types'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

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
    'https://www.dealnews.com/?rss=1&sort=time', // Most Recent Deals
    'https://www.dealnews.com/?rss=1&sort=hotness', // Most Popular Deals
    'https://www.dealnews.com/f1682/Staff-Pick/?rss=1', // Editors' Choice
  ]

  private async fetchDealPage(url: string): Promise<{ details: string; features: string }> {
    /**
     * Fetch and parse full deal page to extract detailed content.
     * Matches Python BeautifulSoup behavior.
     */
    try {
      const response = await fetch(url)
      const html = await response.text()
      const $ = cheerio.load(html)

      // Extract main content section (matches Python: soup.find("div", class_="content-section"))
      const contentSection = $('.content-section').text()

      if (!contentSection) {
        return { details: '', features: '' }
      }

      // Clean up text
      let contentText = contentSection.replace(/\nmore/g, '').replace(/\n/g, ' ')

      // Split into details and features if "Features" section exists
      if (contentText.includes('Features')) {
        const [details, features] = contentText.split('Features', 2)
        return {
          details: details.trim(),
          features: features.trim(),
        }
      }

      return {
        details: contentText.trim(),
        features: '',
      }
    } catch (error) {
      console.error(`Failed to fetch deal page ${url}:`, error)
      return { details: '', features: '' }
    }
  }

  async fetchDeals(): Promise<ScrapedDeal[]> {
    const startTime = Date.now()
    console.log('📡 Scanner Agent: Starting RSS feed scan...')
    console.log(`   RSS Feeds to scan: ${this.RSS_FEEDS.length}`)

    const deals: ScrapedDeal[] = []
    let feedsSuccessful = 0
    let feedsFailed = 0

    for (const feedUrl of this.RSS_FEEDS) {
      const feedStartTime = Date.now()
      try {
        console.log(`   📥 Fetching: ${feedUrl}`)
        const feed = await this.parser.parseURL(feedUrl)
        console.log(`      ✅ Loaded feed: ${feed.items.length} items available`)

        // Take first 10 items per feed (matches Python)
        const itemsToProcess = feed.items.slice(0, 10)
        console.log(`      📋 Processing: ${itemsToProcess.length} items`)

        for (const item of itemsToProcess) {
          const url = item.link || ''
          if (!url) continue

          // Extract summary from RSS
          const $ = cheerio.load(item.summary || item.content || '')
          const snippetDiv = $('.snippet.summary')
          let summary = snippetDiv.length > 0 ? snippetDiv.text() : (item.contentSnippet || '')
          summary = summary.replace(/<[^>]+>/g, '').trim()

          // Fetch full page content (matches Python behavior)
          const { details, features } = await this.fetchDealPage(url)

          deals.push({
            title: item.title || '',
            summary: summary.replace(/\n/g, ' '),
            details,
            features,
            url,
          })

          // Be gentle with the remote site (matches Python: time.sleep(0.5))
          await new Promise((resolve) => setTimeout(resolve, 500))
        }

        feedsSuccessful++
        const feedTime = ((Date.now() - feedStartTime) / 1000).toFixed(2)
        console.log(`      ⏱️  Feed processed in ${feedTime}s`)
      } catch (error) {
        feedsFailed++
        console.error(`      ❌ Failed to fetch feed:`, error)
      }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log('📡 Scanner Agent: RSS scan complete')
    console.log(`   ✅ Successful: ${feedsSuccessful}/${this.RSS_FEEDS.length} feeds`)
    console.log(`   ❌ Failed: ${feedsFailed}/${this.RSS_FEEDS.length} feeds`)
    console.log(`   📊 Total deals: ${deals.length}`)
    console.log(`   ⏱️  Total time: ${totalTime}s`)
    return deals
  }

  async selectBestDeals(deals: ScrapedDeal[]): Promise<SelectedDeal[]> {
    const startTime = Date.now()
    console.log(`🤖 Scanner Agent: Starting GPT deal selection...`)
    console.log(`   📥 Input: ${deals.length} scraped deals`)

    const prompt = `
From the deals below, select the 5 with the most detailed descriptions and clear prices.

IMPORTANT RULES:
1. ONLY include deals where the ACTUAL PRODUCT PRICE is clearly stated
2. DO NOT include deals that only mention discounts like "$50 off" or "save $X"
3. The price must be the current selling price, not the savings amount
4. Each product description should be 3-4 sentences about the product itself

Return JSON only in this exact format:
{
  "deals": [
    {
      "product_description": "detailed description of the product",
      "price": 99.99,
      "url": "the deal url"
    }
  ]
}

Deals:
${deals.map((d, i) => `
--- Deal ${i + 1} ---
Title: ${d.title}
Details: ${d.details.trim()}
Features: ${d.features.trim()}
URL: ${d.url}
`).join('\n')}
    `.trim()

    try {
      console.log(`   🤖 Calling GPT-4o-mini (JSON mode)...`)
      const gptStartTime = Date.now()

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are a deal selector. Extract deals with clear prices and good descriptions. Respond ONLY with valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      })

      const gptTime = ((Date.now() - gptStartTime) / 1000).toFixed(2)
      console.log(`   ✅ GPT responded in ${gptTime}s`)
      console.log(`   📊 Tokens used: ${response.usage?.total_tokens || 'N/A'}`)
      console.log(`      - Prompt: ${response.usage?.prompt_tokens || 'N/A'}`)
      console.log(`      - Completion: ${response.usage?.completion_tokens || 'N/A'}`)

      const content = response.choices[0].message.content
      if (!content) {
        throw new Error('No response from OpenAI')
      }

      const parsed = DealSelectionSchema.parse(JSON.parse(content))
      console.log(`   📋 GPT selected: ${parsed.deals.length} deals`)

      // Filter out deals with invalid prices
      const validDeals = parsed.deals.filter((deal) => deal.price > 0)
      const invalidDeals = parsed.deals.length - validDeals.length

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(2)
      console.log(`🤖 Deal selection complete`)
      console.log(`   ✅ Valid deals: ${validDeals.length}`)
      console.log(`   ❌ Invalid (price ≤ 0): ${invalidDeals}`)
      console.log(`   ⏱️  Total time: ${totalTime}s`)

      return validDeals
    } catch (error) {
      console.error('❌ Deal selection error:', error)
      return []
    }
  }

  async scan(): Promise<SelectedDeal[]> {
    const scrapedDeals = await this.fetchDeals()
    const selectedDeals = await this.selectBestDeals(scrapedDeals)
    return selectedDeals
  }
}
