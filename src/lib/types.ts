// Common types used across the application

export interface ScrapedDeal {
  title: string
  summary: string
  details: string
  features: string
  url: string
  merchantUrl: string | null // direct store link
}

export interface SelectedDeal {
  product_description: string
  price: number
  url: string
  merchantUrl?: string | null // direct store link, goes into Prisma.merchantUrl
}

export interface PricePrediction {
  llamaPrice: number
  gptPrice: number
  perplexityPrice?: number
  finalPrice: number
}

export interface DealWithScore {
  id: string
  title: string
  description: string
  url: string
  merchantUrl: string | null // direct store link
  currentPrice: number
  predictedFairPrice: number
  discount: number
  dealyticsScore: number
  source: string
  category?: string | null
  imageUrl?: string | null
  scrapedAt: Date
  expiresAt?: Date | null
}
