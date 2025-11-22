import { NextResponse } from 'next/server'
import { PricingAgent } from '@/lib/agents/pricing'
import { z } from 'zod'

export const maxDuration = 300

const CheckPriceSchema = z.object({
  description: z.string().min(10),
  currentPrice: z.number().optional(),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = CheckPriceSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json({ error: 'Invalid input', details: result.error.issues }, { status: 400 })
    }

    const { description, currentPrice } = result.data

    const pricing = new PricingAgent()
    const prediction = await pricing.predictPrice(description)

    if (prediction.finalPrice === 0) {
      return NextResponse.json({ error: 'Failed to predict price' }, { status: 500 })
    }

    const discount = currentPrice ? prediction.finalPrice - currentPrice : 0
    const discountPercent = currentPrice ? (discount / prediction.finalPrice) * 100 : 0
    const dealyticsScore = Math.min(100, Math.max(0, Math.round(discountPercent)))

    const verdict =
      dealyticsScore >= 70 ? 'Excellent Deal!' : dealyticsScore >= 50 ? 'Good Deal' : dealyticsScore >= 30 ? 'Fair Deal' : 'Not a Great Deal'

    return NextResponse.json({
      predictedPrice: prediction.finalPrice,
      llamaPrice: prediction.llamaPrice,
      gptPrice: prediction.gptPrice,
      currentPrice,
      discount,
      discountPercent,
      dealyticsScore,
      verdict,
    })
  } catch (error) {
    console.error('Price check error:', error)
    return NextResponse.json({ error: 'Failed to check price' }, { status: 500 })
  }
}
