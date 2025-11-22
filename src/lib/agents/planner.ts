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
      // 1. Scan deals from RSS feeds
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
        try {
          // Get price prediction
          const prediction = await this.pricing.predictPrice(deal.product_description)

          if (prediction.finalPrice === 0) {
            console.warn(`   ⚠️  Skipped (pricing failed)`)
            skippedCount++
            continue
          }

          // Calculate discount and score
          const discount = prediction.finalPrice - deal.price
          const discountPercent = (discount / prediction.finalPrice) * 100

          // Deal Score: 0-100 based on discount percentage
          // Score = min(100, max(0, discountPercent))
          const dealyticsScore = Math.min(100, Math.max(0, Math.round(discountPercent)))

          // Extract category from description (simple approach)
          const category = this.extractCategory(deal.product_description)

          console.log(`   💾 Saving to database...`)
          console.log(`      Current Price: $${deal.price}`)
          console.log(`      Fair Price: $${prediction.finalPrice.toFixed(2)}`)
          console.log(`      Discount: $${discount.toFixed(2)} (${discountPercent.toFixed(1)}%)`)
          console.log(`      Deal Score: ${dealyticsScore}/100`)
          console.log(`      Category: ${category}`)

          // 3. Save to database (upsert to avoid duplicates)
          await prisma.deal.upsert({
            where: { url: deal.url },
            update: {
              title: deal.product_description.slice(0, 200),
              description: deal.product_description,
              currentPrice: deal.price,
              predictedFairPrice: prediction.finalPrice,
              discount,
              dealyticsScore,
              category,
            },
            create: {
              title: deal.product_description.slice(0, 200),
              description: deal.product_description,
              url: deal.url,
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
      console.log(`   ⚡ Average: ${(parseFloat(pipelineTime) / selectedDeals.length).toFixed(2)}s per deal`)
      console.log('═════════════════════════════════════════════════════════\n')

      return savedCount
    } catch (error) {
      console.error('❌ PLANNER: Pipeline error:', error)
      throw error
    }
  }

  private extractCategory(description: string): string {
    const desc = description.toLowerCase()

    if (desc.includes('laptop') || desc.includes('computer') || desc.includes('pc')) {
      return 'Computers'
    }
    if (desc.includes('phone') || desc.includes('mobile') || desc.includes('iphone') || desc.includes('samsung')) {
      return 'Cell Phones'
    }
    if (desc.includes('tv') || desc.includes('monitor') || desc.includes('display')) {
      return 'Electronics'
    }
    if (desc.includes('headphone') || desc.includes('earbuds') || desc.includes('speaker')) {
      return 'Audio'
    }
    if (desc.includes('kitchen') || desc.includes('cookware') || desc.includes('appliance')) {
      return 'Home & Kitchen'
    }
    if (desc.includes('gaming') || desc.includes('playstation') || desc.includes('xbox') || desc.includes('nintendo')) {
      return 'Gaming'
    }

    return 'General'
  }
}
