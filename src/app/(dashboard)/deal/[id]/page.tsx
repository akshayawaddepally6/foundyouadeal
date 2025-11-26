// src/app/(dashboard)/deal/[id]/page.tsx
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db/prisma'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import Link from 'next/link'

type DealPageProps = {
  // ✅ In Next.js 16, params is a Promise
  params: Promise<{ id: string }>
}

export default async function DealPage({ params }: DealPageProps) {
  // ✅ Unwrap the Promise
  const { id } = await params

  // ✅ Load deal by its cuid id
  const deal = await prisma.deal.findUnique({
    where: { id },
  })

  if (!deal) {
    notFound()
  }

  // ✅ Prefer merchantUrl, fall back to DealNews url
  const finalUrl = deal.merchantUrl || deal.url

  const getScoreColor = (score: number): string => {
    if (score >= 70) return 'bg-green-500'
    if (score >= 50) return 'bg-blue-500'
    if (score >= 30) return 'bg-yellow-500'
    return 'bg-gray-500'
  }

  const getVerdict = (score: number): string => {
    if (score >= 70) return 'Excellent Deal! 🔥'
    if (score >= 50) return 'Good Deal 👍'
    if (score >= 30) return 'Fair Deal'
    return 'Not a Great Deal'
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <Link
        href="/dashboard"
        className="mb-4 inline-block text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back to Dashboard
      </Link>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="mb-2 text-2xl">{deal.title}</CardTitle>
                  {deal.category && (
                    <CardDescription className="text-base">
                      {deal.category}
                    </CardDescription>
                  )}
                </div>
                <Badge
                  className={`${getScoreColor(
                    deal.dealyticsScore,
                  )} px-4 py-2 text-lg`}
                >
                  {deal.dealyticsScore}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div>
                  <h3 className="mb-2 font-semibold">Description</h3>
                  <p className="leading-relaxed text-muted-foreground">
                    {deal.description}
                  </p>
                </div>

                <Separator />

                <div>
                  <h3 className="mb-3 font-semibold">Deal Information</h3>
                  <dl className="space-y-2">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Source:</dt>
                      <dd className="font-medium capitalize">{deal.source}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Posted:</dt>
                      <dd className="font-medium">
                        {new Date(deal.scrapedAt).toLocaleDateString()}
                      </dd>
                    </div>
                  </dl>
                </div>

                <Separator />

                <div className="flex gap-3">
                  <Button asChild className="flex-1" size="lg">
                    <Link
                      href={finalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View Deal
                    </Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Price Analysis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-1 text-sm text-muted-foreground">
                  Current Price
                </p>
                <p className="text-3xl font-bold text-green-600">
                  ${deal.currentPrice.toFixed(2)}
                </p>
              </div>

              <Separator />

              <div>
                <p className="mb-1 text-sm text-muted-foreground">
                  Fair Price (AI Predicted)
                </p>
                <p className="text-2xl font-semibold text-muted-foreground line-through">
                  ${deal.predictedFairPrice.toFixed(2)}
                </p>
              </div>

              <Separator />

              <div>
                <p className="mb-1 text-sm text-muted-foreground">You Save</p>
                <p className="text-3xl font-bold text-green-600">
                  ${deal.discount.toFixed(2)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  (
                  {(
                    (deal.discount / deal.predictedFairPrice) *
                    100
                  ).toFixed(0)}
                  % off)
                </p>
              </div>

              <Separator />

              <div className="py-3 text-center">
                <p className="text-lg font-semibold">
                  {getVerdict(deal.dealyticsScore)}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>About the Score</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Our AI analyzes thousands of products to predict fair prices.
                Scores above 70 indicate exceptional value. This deal scored{' '}
                <span className="font-bold text-foreground">
                  {deal.dealyticsScore}/100
                </span>
                .
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
