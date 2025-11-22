'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'

interface PriceResult {
  predictedPrice: number
  llamaPrice: number
  gptPrice: number
}

export default function PriceCheckerPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({
    url: '',
    description: '',
    currentPrice: '',
  })
  const [result, setResult] = useState<PriceResult | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.description) {
      toast.error('Please provide a product description')
      return
    }

    setIsLoading(true)
    setResult(null)

    try {
      const response = await fetch('/api/check-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: formData.url || undefined,
          description: formData.description,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        toast.error(data.error || 'Failed to check price')
        return
      }

      setResult(data)
      toast.success('Price prediction completed!')
    } catch (error) {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const calculateDeal = () => {
    if (!result || !formData.currentPrice) return null

    const current = parseFloat(formData.currentPrice)
    const predicted = result.predictedPrice
    const discount = predicted - current
    const discountPercent = (discount / predicted) * 100
    const score = Math.min(100, Math.max(0, Math.round(discountPercent)))

    return { discount, discountPercent, score }
  }

  const deal = calculateDeal()

  const getScoreColor = (score: number): string => {
    if (score >= 70) return 'text-green-600'
    if (score >= 50) return 'text-blue-600'
    if (score >= 30) return 'text-yellow-600'
    return 'text-gray-600'
  }

  const getVerdict = (score: number): string => {
    if (score >= 70) return 'Excellent Deal!'
    if (score >= 50) return 'Good Deal'
    if (score >= 30) return 'Fair Deal'
    return 'Not a Great Deal'
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Price Checker</h1>
          <p className="text-muted-foreground">Check if a product is a good deal using AI price prediction</p>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Input Form */}
          <Card>
            <CardHeader>
              <CardTitle>Product Information</CardTitle>
              <CardDescription>Enter product details to check the deal quality</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="url">Product URL (optional)</Label>
                  <Input
                    id="url"
                    type="url"
                    placeholder="https://example.com/product"
                    value={formData.url}
                    onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                    disabled={isLoading}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Product Description *</Label>
                  <textarea
                    id="description"
                    className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="Describe the product in detail (brand, model, specifications, features, etc.)"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    required
                    disabled={isLoading}
                  />
                  <p className="text-xs text-muted-foreground">
                    Include as much detail as possible for accurate price prediction
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="currentPrice">Current Price (optional)</Label>
                  <Input
                    id="currentPrice"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="99.99"
                    value={formData.currentPrice}
                    onChange={(e) => setFormData({ ...formData, currentPrice: e.target.value })}
                    disabled={isLoading}
                  />
                  <p className="text-xs text-muted-foreground">Enter the current price to see if it's a good deal</p>
                </div>

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Checking Price...' : 'Check Price'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Results */}
          <Card>
            <CardHeader>
              <CardTitle>Price Analysis</CardTitle>
              <CardDescription>AI-powered price prediction results</CardDescription>
            </CardHeader>
            <CardContent>
              {!result && (
                <div className="flex items-center justify-center h-64 text-muted-foreground">
                  <p>Enter product details to see price analysis</p>
                </div>
              )}

              {result && (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Predicted Fair Price</p>
                    <p className="text-3xl font-bold text-primary">${result.predictedPrice.toFixed(2)}</p>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Llama Model:</span>
                      <span className="font-medium">
                        {result.llamaPrice > 0 ? `$${result.llamaPrice.toFixed(2)}` : 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">GPT Model:</span>
                      <span className="font-medium">${result.gptPrice.toFixed(2)}</span>
                    </div>
                  </div>

                  {formData.currentPrice && deal && (
                    <>
                      <Separator />

                      <div>
                        <p className="text-sm text-muted-foreground mb-1">Your Price</p>
                        <p className="text-2xl font-semibold">${parseFloat(formData.currentPrice).toFixed(2)}</p>
                      </div>

                      <Separator />

                      <div>
                        <p className="text-sm text-muted-foreground mb-1">You Save</p>
                        <p className="text-2xl font-bold text-green-600">
                          {deal.discount > 0 ? `$${deal.discount.toFixed(2)}` : '$0.00'}
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          ({deal.discountPercent > 0 ? deal.discountPercent.toFixed(0) : 0}% off)
                        </p>
                      </div>

                      <Separator />

                      <div className="bg-muted rounded-lg p-4 text-center">
                        <p className="text-sm text-muted-foreground mb-1">Deal Score</p>
                        <p className={`text-4xl font-bold ${getScoreColor(deal.score)}`}>{deal.score}/100</p>
                        <p className="text-lg font-semibold mt-2">{getVerdict(deal.score)}</p>
                      </div>
                    </>
                  )}

                  {formData.currentPrice && !deal && (
                    <div className="text-center text-sm text-muted-foreground">
                      <p>Enter a current price to see deal analysis</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  )
}
