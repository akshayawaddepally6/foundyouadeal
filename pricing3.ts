import OpenAI from 'openai'
import { prisma } from '../db/prisma'
import type { PricePrediction } from '../types'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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

function parsePrice(text: string | null | undefined): number {
  if (!text) return 0
  const num = parseFloat(text.replace(/[^0-9.]/g, ''))
  return Number.isFinite(num) ? num : 0
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

/**
 * Pricing Agent - category-aware RAG + smarter ensemble
 */
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

      // Try to match raw output to one of the allowed categories
      const matched = ALLOWED_CATEGORIES.find((cat) =>
        raw.includes(cat),
      )

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
      console.log(`   📋 Response headers:`, Object.fromEntries(response.headers.entries()))

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

    return parsePrice(completion.choices[0].message.content)
  }

  /**
   * GPT-4o-mini with category-aware RAG over pgvector.
   * - Detects category
   * - Searches only inside that category (if detected)
   * - Ignores neighbor average if neighbors look bad
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

      console.log(`   ✅ Found ${similarProducts.length} products (${vectorTime}s)`)
      similarProducts.forEach((p, i) => {
        console.log(
          `      ${i + 1}. ${p.title.slice(0, 60)} - $${p.price} (d=${p.distance.toFixed(
            4,
          )})`,
        )
      })

      // 3. Neighbor stats
      const prices = similarProducts.map((p) => Number(p.price || 0)).filter((n) => n > 0)
      const neighborAveragePrice =
        prices.length > 0
          ? prices.reduce((sum, v) => sum + v, 0) / prices.length
          : 0
      const topDistance = typeof similarProducts[0].distance === 'number'
        ? similarProducts[0].distance
        : null

      console.log(
        `   💡 Neighbor avg price: $${neighborAveragePrice.toFixed(2)} (top distance: ${
          topDistance !== null ? topDistance.toFixed(4) : 'N/A'
        })`,
      )

      // --- ✨ NEIGHBOR QUALITY CHECK ✨ ---
      const RAG_DISTANCE_THRESHOLD = 0.6

      let useNeighbors = true

      if (
        topDistance !== null &&
        Number.isFinite(topDistance) &&
        topDistance > RAG_DISTANCE_THRESHOLD
      ) {
        console.warn(
          `   ⚠️  Neighbors are too far (distance ${topDistance.toFixed(
            4,
          )}) → will NOT use neighbor average in ensemble`,
        )
        useNeighbors = false
      }

      if (!prices.length) {
        console.warn('   ⚠️  Neighbors have no valid prices → ignoring neighbor average')
        useNeighbors = false
      }

      // 4. Build context and call GPT with RAG (even if we decide not to use neighbor avg in ensemble)
      console.log('   Step 3/4: Building RAG context...')
      const context = similarProducts
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
              useNeighbors
                ? `Here are some reference products with their prices (average: $${neighborAveragePrice.toFixed(
                    2,
                  )}):`
                : 'Here are some potentially related products (neighbors), but they may not be very reliable:',
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

      const price = parsePrice(completion.choices[0].message.content)

      const gptTime = ((Date.now() - gptStartTime) / 1000).toFixed(2)
      const totalTime = ((Date.now() - ragStartTime) / 1000).toFixed(2)

      console.log(`   ✅ GPT responded: $${price} (${gptTime}s)`)
      console.log(
        `🤖 GPT+RAG complete: $${price} (total ${totalTime}s, will${
          useNeighbors ? '' : ' NOT'
        } use neighbor avg in ensemble)`,
      )

      return {
        price: price || 0,
        neighborAveragePrice:
          useNeighbors && prices.length
            ? neighborAveragePrice
            : null, // 👈 neighbors ignored here if bad
        neighborCount: similarProducts.length,
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
   * Main entry: combine Llama + GPT + (good) neighbor average
   */
  async predictPrice(description: string): Promise<PricePrediction> {
    const totalStartTime = Date.now()
    console.log(`💰 PRICING: "${description.slice(0, 60)}..."`)
    console.log(`─────────────────────────────────────────────────────────`)

    const [llamaPrice, gptResult] = await Promise.all([
      this.getLlamaPrice(description),
      this.getGPTPrice(description),
    ])

    const gptPrice = gptResult.price
    const neighborAvg = gptResult.neighborAveragePrice

    console.log(`─────────────────────────────────────────────────────────`)
    console.log(`📊 ENSEMBLE CALCULATION:`)
    console.log(`   Llama:   $${llamaPrice.toFixed(2)}`)
    console.log(`   GPT:     $${gptPrice.toFixed(2)}`)
    if (neighborAvg && neighborAvg > 0) {
      console.log(`   Neighbor avg (good): $${neighborAvg.toFixed(2)}`)
    } else {
      console.log('   Neighbor avg: (not used)')
    }

    const signals: number[] = []
    if (llamaPrice > 0) signals.push(llamaPrice)
    if (gptPrice > 0) signals.push(gptPrice)
    if (neighborAvg && neighborAvg > 0) signals.push(neighborAvg)

    let finalPrice = 0
    let method = 'Unknown'

    if (signals.length >= 2) {
      finalPrice = median(signals)
      method =
        signals.length === 3
          ? 'Median of Llama + GPT + neighbor avg'
          : 'Median of available signals'
      console.log(`   ─────────────────────────`)
      console.log(`   Final (ensemble): $${finalPrice.toFixed(2)} (${method})`)
    } else if (llamaPrice > 0) {
      finalPrice = llamaPrice
      method = 'Llama only'
      console.log(`   ⚠️  Using Llama only: $${finalPrice.toFixed(2)}`)
    } else if (gptPrice > 0) {
      finalPrice = gptPrice
      method = 'GPT only'
      console.log(`   ⚠️  Using GPT only: $${finalPrice.toFixed(2)}`)
    } else {
      finalPrice = 0
      method = 'Both failed'
      console.error(`   ❌ Both models failed!`)
    }

    const totalTime = ((Date.now() - totalStartTime) / 1000).toFixed(2)
    console.log(`💰 PRICING COMPLETE: $${finalPrice.toFixed(2)} (${totalTime}s) [${method}]`)
    console.log(`═════════════════════════════════════════════════════════\n`)

    return {
      llamaPrice,
      gptPrice,
      finalPrice: Math.round(finalPrice * 100) / 100,
    }
  }
}
