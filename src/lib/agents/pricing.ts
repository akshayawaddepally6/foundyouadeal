import OpenAI from 'openai'
import { prisma } from '../db/prisma'
import type { PricePrediction } from '../types'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Separate client for Perplexity Sonar
const sonarClient = new OpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY!,
  baseURL: 'https://api.perplexity.ai',
})

const ALLOWED_CATEGORIES = [
  'Automotive',
  'Electronics',
  'Office_Products',
  'Tools_and_Home_Improvement',
  'Cell_Phones_and_Accessories',
  'Toys_and_Games',
  'Appliances',
  'Musical_Instruments',
] as const

type ProductCategory = (typeof ALLOWED_CATEGORIES)[number]

type GPTPriceResult = {
  price: number
  neighborAveragePrice: number | null
  neighborCount: number
  topDistance: number | null
}

/* -------------------------
   Helpers
   ------------------------- */

// Simple numeric parser: pull the first reasonable number out of a string
// Returns NaN on failure so we can distinguish "no value" from 0.
function parsePrice(text: string | null | undefined): number {
  if (!text) {
    console.warn('parsePrice got empty text from model')
    return NaN
  }

  const str = String(text)
  // Match first integer or decimal like 530 or 530.99
  const match = str.match(/[0-9]+(\.[0-9]+)?/)
  if (!match) {
    console.warn('parsePrice failed to find any number:', { text: str })
    return NaN
  }

  const num = parseFloat(match[0])
  if (!Number.isFinite(num)) {
    console.warn('parsePrice failed to parse:', { text: str, token: match[0] })
    return NaN
  }
  return num
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

// Reject candidate if it's an extreme outlier vs baseline signals
function isReasonableSignal(candidate: number, baseline: number[]): boolean {
  if (!candidate || !Number.isFinite(candidate) || candidate <= 0) return false
  if (baseline.length === 0) return true // no baseline to compare against, accept
  const med = median(baseline)
  if (med === 0) return true
  // threshold: lower than 20% of median or larger than 5x median → reject
  if (candidate < med * 0.2 || candidate > med * 5) return false
  return true
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : 'NaN'
}

/* -------------------------
   PricingAgent class
   ------------------------- */

export class PricingAgent {
  /**
   * Use GPT to map a free-text description to one of your 8 categories.
   */
  private async detectCategory(
    description: string,
  ): Promise<ProductCategory | null> {
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: [
              'You are a classifier that assigns a product description to exactly one category.',
              'Valid categories are:',
              ALLOWED_CATEGORIES.join(', '),
              'Respond with ONLY the category string exactly as given, or "Unknown" if unsure.',
            ].join(' '),
          },
          {
            role: 'user',
            content: `Product description:\n${description}\n\nWhat category is this?`,
          },
        ],
        max_tokens: 20,
        temperature: 0,
      })

      const raw = (completion.choices[0].message.content || '').trim()
      const matched = ALLOWED_CATEGORIES.find((cat) => raw.includes(cat))

      if (!matched) {
        console.warn(`   ⚠️  Category detection: got "${raw}", treating as Unknown`)
        return null
      }

      console.log(`   🏷️  Detected category: ${matched}`)
      return matched
    } catch (err) {
      console.warn('   ⚠️  Category detection failed:', err)
      return null
    }
  }

  /**
   * Get price prediction from Llama model hosted on Modal
   */
  async getLlamaPrice(description: string): Promise<number> {
    const startTime = Date.now()
    console.log('🦙 Llama pricing: Starting...')

    try {
      const isDevelopment = process.env.NODE_ENV === 'development'
      const endpoint = isDevelopment
        ? 'http://localhost:3001'
        : `${process.env.NEXT_PUBLIC_BETTER_AUTH_URL}/api/modal-llama`

      console.log(`   🔗 Endpoint: ${endpoint}`)
      console.log(`   🌍 Environment: ${isDevelopment ? 'development' : 'production'}`)

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ description }),
      })

      console.log(`   📡 Response status: ${response.status} ${response.statusText}`)
      console.log(
        `   📋 Response headers:`,
        Object.fromEntries(response.headers.entries()),
      )

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`   ❌ Response body: ${errorText}`)
        throw new Error(`Python bridge error: ${response.statusText} - ${errorText}`)
      }

      const data = await response.json()

      if (data.error) {
        throw new Error(data.error)
      }

      const time = ((Date.now() - startTime) / 1000).toFixed(2)
      console.log(`🦙 Llama complete: $${data.price} (${time}s)`)
      return data.price || 0
    } catch (error) {
      const time = ((Date.now() - startTime) / 1000).toFixed(2)
      console.error(`🦙 Llama failed (${time}s):`, error)
      return 0
    }
  }

  /**
   * Simple GPT-only pricing (no RAG)
   */
  private async getSimpleGPTPrice(description: string): Promise<number> {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You estimate product prices based on descriptions. Respond with ONLY a number (no currency symbol or extra text).',
        },
        {
          role: 'user',
          content: `Estimate the price for this product:\n${description}`,
        },
        { role: 'assistant', content: 'Price is $' },
      ],
      max_tokens: 10,
      temperature: 0.3,
    })

    const parsed = parsePrice(completion.choices[0].message.content)
    return Number.isFinite(parsed) ? parsed : 0
  }

  /**
   * Perplexity Sonar pricing.
   * Uses chat/completions and asks for ONLY a number.
   * Returns NaN on failure.
   */
  async getPerplexityPrice(description: string): Promise<number> {
    const start = Date.now()
    console.log('🔎 Perplexity (Sonar) pricing: Starting...')

    try {
      // feature flag
      if (process.env.PERPLEXITY_ENABLED === 'false') {
        console.log('   ℹ️ Perplexity disabled via env')
        return NaN
      }

      if (!process.env.PERPLEXITY_API_KEY) {
        console.warn('   ⚠️  Perplexity API key not set')
        return NaN
      }

      const model = process.env.PERPLEXITY_MODEL || 'sonar'

      // ---------- First attempt ----------
      const completion = await sonarClient.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are a strict price estimator. Always start your answer with a single positive integer or decimal number (the price in USD), then you may optionally add an explanation after that. Do NOT start with words.',
          },
          {
            role: 'user',
            content: `Estimate the fair market price (in USD) for this product:\n\n${description}`,
          },
        ],
        max_tokens: 32,
        temperature: 0.2,
      })

      // Normalize Perplexity content (string or array) into a plain string
      const msg = completion.choices[0]?.message as any
      let rawContent = ''

      const content = (msg?.content ?? '') as any

      if (typeof content === 'string') {
        rawContent = content
      } else if (Array.isArray(content)) {
        rawContent = content
          .map((part: any) => {
            if (!part) return ''
            if (typeof part === 'string') return part
            if (typeof part.text === 'string') return part.text
            if (part.type === 'text' && part.text?.value) return String(part.text.value)
            return ''
          })
          .join(' ')
          .trim()
      }

      console.log('   🔎 Perplexity content (first attempt):', rawContent)

      let parsed = parsePrice(rawContent)

      // ---------- Retry if first attempt had no digits or non-positive ----------
      if (!Number.isFinite(parsed) || parsed <= 0) {
        console.warn(
          '   ⚠️  Perplexity first attempt non-numeric or non-positive, retrying with stricter prompt',
        )

        const retry = await sonarClient.chat.completions.create({
          model,
          messages: [
            {
              role: 'system',
              content:
                'Respond ONLY with a single positive number (the price in USD). Do not include any words, currency symbols, or explanation.',
            },
            {
              role: 'user',
              content: `Just output the fair price (USD) for this product as a bare number:\n${description}`,
            },
          ],
          max_tokens: 8,
          temperature: 0,
        })

        const retryMsg = retry.choices[0]?.message as any
        let retryContent = ''

        const retryContentRaw = (retryMsg?.content ?? '') as any

        if (typeof retryContentRaw === 'string') {
          retryContent = retryContentRaw
        } else if (Array.isArray(retryContentRaw)) {
          retryContent = retryContentRaw
            .map((part: any) => {
              if (!part) return ''
              if (typeof part === 'string') return part
              if (typeof part.text === 'string') return part.text
              if (part.type === 'text' && part.text?.value)
                return String(part.text.value)
              return ''
            })
            .join(' ')
            .trim()
        }

        console.log('   🔎 Perplexity content (retry):', retryContent)
        parsed = parsePrice(retryContent)
      }

      const elapsed = ((Date.now() - start) / 1000).toFixed(2)
      console.log(`   🔎 Perplexity parsed: ${parsed} (${elapsed}s)`)

      return parsed // may be NaN
    } catch (err) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(2)
      console.error(`   🔎 Perplexity failed (${elapsed}s):`, err)
      return NaN
    }
  }

  /**
   * GPT-4o-mini with category-aware RAG over pgvector.
   */
  async getGPTPrice(description: string): Promise<GPTPriceResult> {
    const ragStartTime = Date.now()
    console.log('🤖 GPT+RAG pricing: Starting...')

    try {
      // 0. Detect category first (optional but very helpful)
      console.log('   Step 0/4: Detecting category...')
      const detectedCategory = await this.detectCategory(description)

      // 1. Generate embedding
      console.log('   Step 1/4: Generating embedding...')
      const embStartTime = Date.now()
      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: description,
        dimensions: 384,
      })
      const embedding = embeddingResponse.data[0].embedding
      const embTime = ((Date.now() - embStartTime) / 1000).toFixed(2)
      console.log(`   ✅ Embedding: ${embedding.length}D (${embTime}s)`)

      if (embedding.length !== 384) {
        console.warn(`   ⚠️  Size mismatch! Expected 384, got ${embedding.length}`)
      }

      // 2. Vector similarity search, filtered by category if available
      console.log('   Step 2/4: Vector similarity search...')
      const vectorStartTime = Date.now()
      const embeddingString = `[${embedding.join(',')}]`

      let similarProducts: Array<{
        title: string
        description: string
        price: number
        distance: number
      }> = []

      if (detectedCategory) {
        console.log(
          `   🔍 Using category filter: category = "${detectedCategory}"`,
        )
        similarProducts = await prisma.$queryRaw<
          Array<{
            title: string
            description: string
            price: number
            distance: number
          }>
        >`
          SELECT
            title,
            description,
            price,
            (embedding <-> ${embeddingString}::vector) AS distance
          FROM "Product"
          WHERE embedding IS NOT NULL
            AND category = ${detectedCategory}
          ORDER BY embedding <-> ${embeddingString}::vector
          LIMIT 5
        `
      } else {
        console.log('   🔍 No category detected, searching across all products')
        similarProducts = await prisma.$queryRaw<
          Array<{
            title: string
            description: string
            price: number
            distance: number
          }>
        >`
          SELECT
            title,
            description,
            price,
            (embedding <-> ${embeddingString}::vector) AS distance
          FROM "Product"
          WHERE embedding IS NOT NULL
          ORDER BY embedding <-> ${embeddingString}::vector
          LIMIT 5
        `
      }

      const vectorTime = ((Date.now() - vectorStartTime) / 1000).toFixed(2)

      if (similarProducts.length === 0) {
        console.warn(`   ⚠️  No products found (${vectorTime}s), using simple GPT`)
        const fallbackPrice = await this.getSimpleGPTPrice(description)
        return {
          price: fallbackPrice,
          neighborAveragePrice: null,
          neighborCount: 0,
          topDistance: null,
        }
      }

      console.log(
        `   ✅ Found ${similarProducts.length} raw neighbors (${vectorTime}s)`,
      )
      similarProducts.forEach((p, i) => {
        console.log(
          `      RAW ${i + 1}. ${p.title.slice(0, 60)} - $${p.price} (d=${p.distance.toFixed(
            4,
          )})`,
        )
      })

      // 3. Keep only neighbors with distance <= 0.5 (strict)
      const GOOD_NEIGHBOR_MAX_DISTANCE = 0.5

      const goodNeighbors = similarProducts.filter(
        (p) =>
          typeof p.distance === 'number' &&
          Number.isFinite(p.distance) &&
          p.distance <= GOOD_NEIGHBOR_MAX_DISTANCE,
      )

      const topDistance =
        typeof similarProducts[0].distance === 'number'
          ? similarProducts[0].distance
          : null

      console.log(
        `   🎯 Good neighbors (distance <= ${GOOD_NEIGHBOR_MAX_DISTANCE}): ${goodNeighbors.length}/${similarProducts.length}`,
      )

      // If no good neighbors, skip RAG completely and use simple GPT
      if (goodNeighbors.length === 0) {
        console.warn(
          `   ⚠️  No neighbors with distance <= ${GOOD_NEIGHBOR_MAX_DISTANCE}. Skipping RAG and using SIMPLE GPT.`,
        )
        const fallbackPrice = await this.getSimpleGPTPrice(description)
        const totalTime = ((Date.now() - ragStartTime) / 1000).toFixed(2)
        console.log(
          `🤖 GPT (simple, no RAG) complete: $${fallbackPrice} (total ${totalTime}s)`,
        )
        return {
          price: fallbackPrice,
          neighborAveragePrice: null,
          neighborCount: 0,
          topDistance,
        }
      }

      console.log('   ✅ Good neighbors (used for RAG):')
      goodNeighbors.forEach((p, i) => {
        console.log(
          `      GOOD ${i + 1}. ${p.title.slice(0, 60)} - $${p.price} (d=${p.distance.toFixed(
            4,
          )})`,
        )
      })

      // Neighbor stats based ONLY on good neighbors
      const prices = goodNeighbors
        .map((p) => Number(p.price || 0))
        .filter((n) => n > 0)

      const neighborAveragePrice =
        prices.length > 0
          ? prices.reduce((sum, v) => sum + v, 0) / prices.length
          : 0

      console.log(
        `   💡 Neighbor avg price (good-only): $${neighborAveragePrice.toFixed(
          2,
        )}`,
      )

      // 4. Build context from good neighbors and call GPT
      console.log('   Step 3/4: Building RAG context from GOOD neighbors only...')
      const context = goodNeighbors
        .map((p) => `${p.description}\nPrice: $${p.price}`)
        .join('\n\n')
      console.log(`   ✅ Context length: ${context.length} chars`)

      console.log('   Step 4/4: Calling GPT-4o-mini with RAG context...')
      const gptStartTime = Date.now()

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You estimate realistic product prices in USD. Respond with ONLY a number, no currency symbol or extra text.',
          },
          {
            role: 'user',
            content: [
              `Here are some similar reference products with their prices (average: $${neighborAveragePrice.toFixed(
                2,
              )}):`,
              '',
              context,
              '',
              'Now estimate the price for this product:',
              description,
            ].join('\n'),
          },
          { role: 'assistant', content: 'Price is $' },
        ],
        max_tokens: 10,
        temperature: 0.3,
      })

      const rawPrice = parsePrice(completion.choices[0].message.content)
      const price = Number.isFinite(rawPrice) ? rawPrice : 0

      const gptTime = ((Date.now() - gptStartTime) / 1000).toFixed(2)
      const totalTime = ((Date.now() - ragStartTime) / 1000).toFixed(2)

      console.log(`   ✅ GPT responded: $${fmt(price)} (${gptTime}s)`)
      console.log(
        `🤖 GPT+RAG complete: $${fmt(
          price,
        )} (total ${totalTime}s, using ${goodNeighbors.length} good neighbors)`,
      )

      return {
        price,
        neighborAveragePrice:
          prices.length && Number.isFinite(neighborAveragePrice)
            ? neighborAveragePrice
            : null,
        neighborCount: goodNeighbors.length,
        topDistance,
      }
    } catch (error) {
      const totalTime = ((Date.now() - ragStartTime) / 1000).toFixed(2)
      console.error(`🤖 GPT+RAG failed (${totalTime}s):`, error)
      const fallbackPrice = await this.getSimpleGPTPrice(description)
      return {
        price: fallbackPrice,
        neighborAveragePrice: null,
        neighborCount: 0,
        topDistance: null,
      }
    }
  }

  /**
   * Main entry: combine Llama + GPT + (good) neighbor avg + Perplexity Sonar
   */
  async predictPrice(description: string): Promise<PricePrediction> {
    const totalStartTime = Date.now()
    console.log(`💰 PRICING: "${description.slice(0, 60)}..."`)
    console.log(`─────────────────────────────────────────────────────────`)

    const [llamaPrice, gptResult, rawPerplexityPrice] = await Promise.all([
      this.getLlamaPrice(description),
      this.getGPTPrice(description),
      this.getPerplexityPrice(description),
    ])

    const gptPrice = gptResult.price
    const neighborAvg = gptResult.neighborAveragePrice

    // baseline signals (without Perplexity) to evaluate outlier-ness
    const baselineSignals: number[] = []
    if (llamaPrice > 0) baselineSignals.push(llamaPrice)
    if (gptPrice > 0) baselineSignals.push(gptPrice)
    if (neighborAvg && neighborAvg > 0) baselineSignals.push(neighborAvg)

    // sanity-check Perplexity against baseline
    let perplexityPrice = rawPerplexityPrice
    if (!Number.isFinite(rawPerplexityPrice)) {
      console.warn('   ⚠️  Perplexity returned NaN / invalid, ignoring')
      perplexityPrice = 0
    } else if (!isReasonableSignal(rawPerplexityPrice, baselineSignals)) {
      console.warn(
        `   ⚠️  Perplexity price ${rawPerplexityPrice} rejected as outlier vs baseline ${JSON.stringify(
          baselineSignals,
        )}`,
      )
      perplexityPrice = 0
    }

    console.log(`─────────────────────────────────────────────────────────`)
    console.log(`📊 ENSEMBLE CALCULATION:`)
    console.log(`   Llama:      $${fmt(llamaPrice)}`)
    console.log(`   GPT:        $${fmt(gptPrice)}`)
    console.log(`   Perplexity: $${fmt(perplexityPrice)}`)
    if (neighborAvg && neighborAvg > 0) {
      console.log(`   Neighbor avg (good-only): $${neighborAvg.toFixed(2)}`)
    } else {
      console.log('   Neighbor avg: (not used)')
    }

    const signals: number[] = []
    if (llamaPrice > 0) signals.push(llamaPrice)
    if (gptPrice > 0) signals.push(gptPrice)
    if (neighborAvg && neighborAvg > 0) signals.push(neighborAvg)
    if (perplexityPrice > 0) signals.push(perplexityPrice)

    let finalPrice = 0
    let method = 'Unknown'

    if (signals.length >= 2) {
      finalPrice = median(signals)
      method =
        signals.length === 4
          ? 'Median of Llama + GPT + neighbor avg + Perplexity'
          : signals.length === 3
          ? 'Median of three signals'
          : 'Median of available signals'
      console.log(`   ─────────────────────────`)
      console.log(
        `   Final (ensemble): $${finalPrice.toFixed(2)} (${method})`,
      )
    } else if (llamaPrice > 0) {
      finalPrice = llamaPrice
      method = 'Llama only'
      console.log(`   ⚠️  Using Llama only: $${finalPrice.toFixed(2)}`)
    } else if (gptPrice > 0) {
      finalPrice = gptPrice
      method = 'GPT only'
      console.log(`   ⚠️  Using GPT only: $${finalPrice.toFixed(2)}`)
    } else if (perplexityPrice > 0) {
      finalPrice = perplexityPrice
      method = 'Perplexity only'
      console.log(`   ⚠️  Using Perplexity only: $${finalPrice.toFixed(2)}`)
    } else {
      finalPrice = 0
      method = 'All failed'
      console.error(`   ❌ All models failed!`)
    }

    const totalTime = ((Date.now() - totalStartTime) / 1000).toFixed(2)
    console.log(
      `💰 PRICING COMPLETE: $${finalPrice.toFixed(
        2,
      )} (${totalTime}s) [${method}]`,
    )
    console.log(`═════════════════════════════════════════════════════════\n`)

    return {
      llamaPrice,
      gptPrice,
      // @ts-ignore add perplexityPrice in your PricePrediction type when you're ready
      perplexityPrice,
      finalPrice: Math.round(finalPrice * 100) / 100,
    }
  }
}
