import { ScannerAgent } from './scanner'
import { PricingAgent } from './pricing'
import { prisma } from '../db/prisma'

export class PlanningAgent {
  private scanner = new ScannerAgent()
  private pricing = new PricingAgent()

  async scanAndSaveDeals() {
    const pipelineStartTime = Date.now()
    console.log('═════════════════════════════════════════════════════════')
    console.log('🚀 PLANNER: Starting deal scanning pipeline...')
    console.log('═════════════════════════════════════════════════════════\n')

    try {
      // 1. Scan deals from RSS feeds (ScannerAgent already picked the best ones)
      const selectedDeals = await this.scanner.scan()

      if (selectedDeals.length === 0) {
        console.log('⚠️  PLANNER: No deals found in this scan')
        return 0
      }

      console.log('\n═════════════════════════════════════════════════════════')
      console.log(`📊 PLANNER: Processing ${selectedDeals.length} selected deals...`)
      console.log('═════════════════════════════════════════════════════════\n')

      // 2. Price each deal and save to database
      let savedCount = 0
      let skippedCount = 0
      let errorCount = 0

      for (let i = 0; i < selectedDeals.length; i++) {
        const deal = selectedDeals[i]
        console.log(`\n[${i + 1}/${selectedDeals.length}] Processing deal...`)
        console.log(`   🔗 Source URL (DealNews): ${deal.url}`)
        console.log(`   🛒 Merchant URL (direct): ${deal.merchantUrl ?? 'N/A'}`)

        try {
          // Get price prediction from PricingAgent
          const prediction = await this.pricing.predictPrice(deal.product_description)

          if (prediction.finalPrice === 0) {
            console.warn(`   ⚠️  Skipped (pricing failed)`)
            skippedCount++
            continue
          }

          // Calculate discount + smart deal score
          const {
            discount,
            discountPercent,
            dealyticsScore,
          } = this.calculateDealScore({
            currentPrice: deal.price,
            fairPrice: prediction.finalPrice,
          })

          // If score is 0, it's not really a deal – skip
          if (dealyticsScore === 0) {
            console.warn(`   ⚠️  Skipped (not a real deal, score = 0)`)
            skippedCount++
            continue
          }

          // Extract category from description (simple keyword approach)
          const category = this.extractCategory(deal.product_description)

          console.log(`   💾 Saving to database...`)
          console.log(`      Current Price: $${deal.price}`)
          console.log(`      Fair Price: $${prediction.finalPrice.toFixed(2)}`)
          console.log(`      Discount: $${discount.toFixed(2)} (${discountPercent.toFixed(1)}%)`)
          console.log(`      Deal Score: ${dealyticsScore}/100`)
          console.log(`      Category: ${category}`)

          // 3. Save to database (upsert to avoid duplicates)
          // We keep DealNews URL as the unique key, and store merchantUrl separately.
          await prisma.deal.upsert({
            where: { url: deal.url }, // DealNews URL is the unique identifier
            update: {
              title: deal.product_description.slice(0, 200),
              description: deal.product_description,
              currentPrice: deal.price,
              predictedFairPrice: prediction.finalPrice,
              discount,
              dealyticsScore,
              category,
              merchantUrl: deal.merchantUrl ?? null, // 👈 NEW: update merchant URL too
            },
            create: {
              title: deal.product_description.slice(0, 200),
              description: deal.product_description,
              url: deal.url,                         // DealNews page
              merchantUrl: deal.merchantUrl ?? null, // 👈 NEW: direct store link
              currentPrice: deal.price,
              predictedFairPrice: prediction.finalPrice,
              discount,
              dealyticsScore,
              source: 'dealnews',
              category,
            },
          })

          savedCount++
          console.log(`   ✅ Saved successfully!`)
        } catch (error) {
          errorCount++
          console.error(`   ❌ Error:`, error)
        }
      }

      const pipelineTime = ((Date.now() - pipelineStartTime) / 1000).toFixed(2)

      console.log('\n═════════════════════════════════════════════════════════')
      console.log('🎉 PLANNER: Pipeline complete!')
      console.log('─────────────────────────────────────────────────────────')
      console.log(`   📊 Processed: ${selectedDeals.length} deals`)
      console.log(`   ✅ Saved: ${savedCount}`)
      console.log(`   ⚠️  Skipped: ${skippedCount}`)
      console.log(`   ❌ Errors: ${errorCount}`)
      console.log(`   ⏱️  Total time: ${pipelineTime}s`)
      console.log(
        `   ⚡ Average: ${(parseFloat(pipelineTime) / selectedDeals.length).toFixed(
          2
        )}s per deal`
      )
      console.log('═════════════════════════════════════════════════════════\n')

      return savedCount
    } catch (error) {
      console.error('❌ PLANNER: Pipeline error:', error)
      throw error
    }
  }

  // ⭐ Smarter scoring logic
  private calculateDealScore({
    currentPrice,
    fairPrice,
  }: {
    currentPrice: number
    fairPrice: number
  }): {
    discount: number
    discountPercent: number
    dealyticsScore: number
  } {
    // Basic sanity checks
    if (
      !Number.isFinite(currentPrice) ||
      !Number.isFinite(fairPrice) ||
      currentPrice <= 0 ||
      fairPrice <= 0
    ) {
      return { discount: 0, discountPercent: 0, dealyticsScore: 0 }
    }

    const discount = fairPrice - currentPrice
    const discountPercent = (discount / fairPrice) * 100

    // Not actually cheaper than "fair price" → not a deal
    if (discount <= 0) {
      return { discount, discountPercent, dealyticsScore: 0 }
    }

    // 1) Base score mainly from discount percent (0–90 range)
    let baseScore = Math.max(0, Math.min(90, discountPercent))

    // 2) Bonus / penalty from absolute savings ($)
    let bonus = 0
    if (discount < 5) {
      bonus = -10 // tiny savings
    } else if (discount >= 5 && discount < 20) {
      bonus = 0 // neutral
    } else if (discount >= 20 && discount < 100) {
      bonus = 5 // nice savings
    } else if (discount >= 100) {
      bonus = 10 // big savings
    }

    // 3) Adjust for overall price range
    let multiplier = 1
    if (fairPrice < 20) {
      multiplier = 0.7 // cheap item
    } else if (fairPrice > 500) {
      multiplier = 1.1 // big-ticket item
    }

    let score = (baseScore + bonus) * multiplier

    // Final clamp 0–100
    const dealyticsScore = Math.max(0, Math.min(100, Math.round(score)))

    return { discount, discountPercent, dealyticsScore }
  }

  private extractCategory(description: string): string {
    const desc = description.toLowerCase()

    if (desc.includes('laptop') || desc.includes('computer') || desc.includes('pc')) {
      return 'Computers'
    }
    if (
      desc.includes('phone') ||
      desc.includes('mobile') ||
      desc.includes('iphone') ||
      desc.includes('samsung')
    ) {
      return 'Cell Phones'
    }
    if (desc.includes('tv') || desc.includes('monitor') || desc.includes('display')) {
      return 'Electronics'
    }
    if (
      desc.includes('headphone') ||
      desc.includes('earbuds') ||
      desc.includes('speaker')
    ) {
      return 'Audio'
    }
    if (
      desc.includes('kitchen') ||
      desc.includes('cookware') ||
      desc.includes('appliance')
    ) {
      return 'Home & Kitchen'
    }
    if (
      desc.includes('gaming') ||
      desc.includes('playstation') ||
      desc.includes('xbox') ||
      desc.includes('nintendo')
    ) {
      return 'Gaming'
    }

    return 'General'
  }
}
