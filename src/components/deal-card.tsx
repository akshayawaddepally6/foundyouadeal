import Link from 'next/link'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { DealWithScore } from '@/lib/types'

interface DealCardProps {
  deal: DealWithScore
}

export function DealCard({ deal }: DealCardProps) {
  const getScoreColor = (score: number): string => {
    if (score >= 70) return 'bg-green-500 hover:bg-green-600'
    if (score >= 50) return 'bg-blue-500 hover:bg-blue-600'
    if (score >= 30) return 'bg-yellow-500 hover:bg-yellow-600'
    return 'bg-gray-500 hover:bg-gray-600'
  }

  const getScoreLabel = (score: number): string => {
    if (score >= 70) return 'Excellent'
    if (score >= 50) return 'Good Deal'
    if (score >= 30) return 'Fair'
    return 'Meh'
  }

  // 👇 IMPORTANT FIX: Choose merchantUrl if available, else source DealNews URL
  const finalUrl = deal.merchantUrl || deal.url

  return (
    <Card className="h-full flex flex-col hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex justify-between items-start gap-2">
          <CardTitle className="text-lg line-clamp-2">{deal.title}</CardTitle>
          <Badge className={getScoreColor(deal.dealyticsScore)}>{deal.dealyticsScore}</Badge>
        </div>
        {deal.category && <CardDescription>{deal.category}</CardDescription>}
      </CardHeader>

      <CardContent className="flex-1">
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Current Price:</span>
            <span className="text-2xl font-bold text-green-600">${deal.currentPrice.toFixed(2)}</span>
          </div>

          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Fair Price:</span>
            <span className="line-through">${deal.predictedFairPrice.toFixed(2)}</span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">You Save:</span>
            <span className="text-lg font-bold text-green-600">${deal.discount.toFixed(2)}</span>
          </div>

          <div className="pt-2">
            <Badge variant="outline" className="w-full justify-center">
              {getScoreLabel(deal.dealyticsScore)}
            </Badge>
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex gap-2">
        <Button asChild className="flex-1">
          <Link href={finalUrl} target="_blank" rel="noopener noreferrer">
            View Deal
          </Link>
        </Button>
        <Button asChild variant="outline" className="flex-1">
          <Link href={`/deal/${deal.id}`}>Details</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
