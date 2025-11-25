import OpenAI from 'openai'
import { prisma } from '../db/prisma'
import type { PricePrediction } from '../types'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

/**
 * Pricing Agent - AI-powered product price prediction
 *
 * Architecture:
 * - Uses a 2-model ensemble for accurate price predictions
 * - Llama (70%): Fine-tuned model hosted on Modal, optimized for pricing
 * - GPT-4o-mini (30%): OpenAI model with RAG (Retrieval-Augmented Generation)
 *
 * RAG Implementation:
 * - Vector database: PostgreSQL with pgvector extension
 * - 400K+ products with 384-dimensional embeddings
 * - Cosine similarity search for finding comparable products
 *
 * Fallback Strategy:
 * - If Llama fails → GPT-only prediction
 * - If GPT fails → Llama-only prediction
 * - If both fail → Return 0 (error state)
 */
export class PricingAgent {
  /**
   * Get price prediction from Llama model hosted on Modal
   *
   * Flow:
   * - Development: Calls local Python bridge server (localhost:3001)
   * - Production: Calls Vercel serverless Python function
   * - The Python bridge uses Modal SDK to invoke the deployed Llama model
   *
   * @param description - Product description text
   * @returns Predicted price in USD (0 if error)
   */
  async getLlamaPrice(description: string): Promise<number> {
    const startTime = Date.now()
    console.log('🦙 Llama pricing: Starting...')

    try {
      // In development, use local Python dev server on port 3001
      // In production, use main production URL to avoid preview deployment protection
      const isDevelopment = process.env.NODE_ENV === 'development'
      const endpoint = isDevelopment
        ? 'http://localhost:3001'  // Local Python server
        : `${process.env.NEXT_PUBLIC_BETTER_AUTH_URL}/api/modal-llama`  // Production URL

      console.log(`   🔗 Endpoint: ${endpoint}`)
      console.log(`   🌍 Environment: ${isDevelopment ? 'development' : 'production'}`)

      // Call Python bridge to Modal via Python SDK
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
        // Try to read response body for more details
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
   * Get price prediction from GPT-4o-mini with RAG (Retrieval-Augmented Generation)
   *
   * RAG Pipeline (4 steps):
   * 1. Generate embedding: Convert product description to 384D vector using OpenAI
   * 2. Vector search: Find 5 most similar products from 400K+ database using cosine similarity
   * 3. Build context: Create prompt with similar products and their prices
   * 4. GPT prediction: Use context-aware GPT to predict price
   *
   * Why RAG?
   * - Improves accuracy by grounding predictions in real product data
   * - Helps GPT understand market pricing for similar products
   * - Reduces hallucination by providing concrete examples
   *
   * Technical Details:
   * - Embedding model: text-embedding-3-small (384 dimensions)
   * - Vector DB: PostgreSQL with pgvector extension
   * - Similarity metric: Cosine distance (<-> operator)
   * - Context size: ~3000 chars (5 products)
   *
   * @param description - Product description text
   * @returns Predicted price in USD (0 if error)
   */
  async getGPTPrice(description: string): Promise<number> {
    const ragStartTime = Date.now()
    console.log('🤖 GPT+RAG pricing: Starting...')

    try {
      // 1. Generate embedding for description
      console.log('   Step 1/4: Generating embedding...')
      const embStartTime = Date.now()
      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: description,
        dimensions: 384, // Match database vector(384) size
      })
      const embedding = embeddingResponse.data[0].embedding
      const embTime = ((Date.now() - embStartTime) / 1000).toFixed(2)

      // Verify embedding size
      console.log(`   ✅ Embedding: ${embedding.length}D (${embTime}s)`)
      if (embedding.length !== 384) {
        console.warn(`   ⚠️  Size mismatch! Expected 384, got ${embedding.length}`)
      }

      // 2. Find similar products using pgvector (vector similarity search)
      console.log('   Step 2/4: Vector similarity search...')
      const vectorStartTime = Date.now()

      // Convert embedding array to pgvector format: '[0.123,-0.456,...]'
      const embeddingString = `[${embedding.join(',')}]`

      // Use raw SQL for pgvector similarity search (cosine distance: <->)
      // This finds the 5 most similar products based on embedding similarity
      const similarProducts = await prisma.$queryRaw<
        Array<{ title: string; description: string; price: number }>
      >`
        SELECT title, description, price
        FROM "Product"
        WHERE embedding IS NOT NULL
        ORDER BY embedding <-> ${embeddingString}::vector
        LIMIT 5
      `

      const vectorTime = ((Date.now() - vectorStartTime) / 1000).toFixed(2)

      if (similarProducts.length === 0) {
        console.warn(`   ⚠️  No products found (${vectorTime}s)`)
        // Fallback to simple GPT prediction without context
        return await this.getSimpleGPTPrice(description)
      }

      console.log(`   ✅ Found ${similarProducts.length} products (${vectorTime}s)`)
      similarProducts.forEach((p, i) => {
        console.log(`      ${i + 1}. ${p.title.slice(0, 50)} - $${p.price}`)
      })

      // 3. Build context from similar products
      console.log('   Step 3/4: Building RAG context...')
      const context = similarProducts
        .map((p) => `${p.description}\nPrice: $${p.price}`)
        .join('\n\n')

      console.log(`   ✅ Context: ${context.length} chars`)

      // 4. Call GPT-4o with context
      console.log('   Step 4/4: Calling GPT-4o-mini...')
      const gptStartTime = Date.now()
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You estimate product prices. Respond with ONLY a number (no currency symbol or text).',
          },
          {
            role: 'user',
            content: `Here are some reference products with their prices:\n\n${context}\n\nNow estimate the price for this product:\n${description}`,
          },
          { role: 'assistant', content: 'Price is $' },
        ],
        max_tokens: 10,
        temperature: 0.3,
      })

      const priceText = completion.choices[0].message.content || '0'
      const price = parseFloat(priceText.replace(/[^0-9.]/g, ''))

      const gptTime = ((Date.now() - gptStartTime) / 1000).toFixed(2)
      const totalTime = ((Date.now() - ragStartTime) / 1000).toFixed(2)

      console.log(`   ✅ GPT responded: $${price} (${gptTime}s)`)
      console.log(`   📊 Tokens: ${completion.usage?.total_tokens || 'N/A'} (prompt: ${completion.usage?.prompt_tokens || 'N/A'}, completion: ${completion.usage?.completion_tokens || 'N/A'})`)
      console.log(`🤖 GPT+RAG complete: $${price} (total ${totalTime}s)`)
      return price || 0
    } catch (error) {
      const totalTime = ((Date.now() - ragStartTime) / 1000).toFixed(2)
      console.error(`🤖 GPT+RAG failed (${totalTime}s):`, error)
      return 0
    }
  }

  private async getSimpleGPTPrice(description: string): Promise<number> {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You estimate product prices based on descriptions. Respond with ONLY a number.',
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

    const priceText = completion.choices[0].message.content || '0'
    return parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0
  }

  // Ensemble: combine Llama + GPT predictions
  async predictPrice(description: string): Promise<PricePrediction> {
    const totalStartTime = Date.now()
    console.log(`💰 PRICING: "${description.slice(0, 60)}..."`)
    console.log(`─────────────────────────────────────────────────────────`)

    const [llamaPrice, gptPrice] = await Promise.all([
      this.getLlamaPrice(description),
      this.getGPTPrice(description),
    ])

    console.log(`─────────────────────────────────────────────────────────`)
    console.log(`📊 ENSEMBLE CALCULATION:`)

    // Ensemble logic: weighted average
    // If Modal is not configured, use only GPT
    let finalPrice: number
    let method: string

    if (llamaPrice > 0 && gptPrice > 0) {
      // Both models available: weighted average (70% Llama, 30% GPT)
      const llamaContribution = llamaPrice * 0.7
      const gptContribution = gptPrice * 0.3
      finalPrice = llamaContribution + gptContribution
      method = '70% Llama + 30% GPT'

      console.log(`   Llama: $${llamaPrice.toFixed(2)} × 0.70 = $${llamaContribution.toFixed(2)}`)
      console.log(`   GPT:   $${gptPrice.toFixed(2)} × 0.30 = $${gptContribution.toFixed(2)}`)
      console.log(`   ─────────────────────────`)
      console.log(`   Final: $${finalPrice.toFixed(2)} (${method})`)
    } else if (llamaPrice > 0) {
      finalPrice = llamaPrice
      method = 'Llama only (GPT failed)'
      console.log(`   ⚠️  GPT failed, using Llama: $${finalPrice.toFixed(2)}`)
    } else if (gptPrice > 0) {
      finalPrice = gptPrice
      method = 'GPT only (Llama failed)'
      console.log(`   ⚠️  Llama failed, using GPT: $${finalPrice.toFixed(2)}`)
    } else {
      finalPrice = 0
      method = 'Both failed'
      console.error(`   ❌ Both models failed!`)
    }

    const totalTime = ((Date.now() - totalStartTime) / 1000).toFixed(2)
    console.log(`💰 PRICING COMPLETE: $${finalPrice.toFixed(2)} (${totalTime}s)`)
    console.log(`═════════════════════════════════════════════════════════\n`)

    return {
      llamaPrice,
      gptPrice,
      finalPrice: Math.round(finalPrice * 100) / 100, // Round to 2 decimals
    }
  }
}
