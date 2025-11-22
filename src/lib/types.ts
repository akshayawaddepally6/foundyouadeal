// Common types used across the application

export interface ScrapedDeal {
  title: string
  summary: string
  details: string
  features: string
  url: string
}

export interface SelectedDeal {
  product_description: string
  price: number
  url: string
}

export interface PricePrediction {
  llamaPrice: number
  gptPrice: number
  finalPrice: number
}

export interface DealWithScore {
  id: string
  title: string
  description: string
  url: string
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
