import { Suspense } from 'react'
import { prisma } from '@/lib/db/prisma'
import { DealCard } from '@/components/deal-card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScanDealsButton } from '@/components/scan-deals-button'
import Link from 'next/link'

async function DealsFeed({ category }: { category?: string }) {
  const deals = await prisma.deal.findMany({
    where: category ? { category } : {},
    orderBy: [{ dealyticsScore: 'desc' }, { scrapedAt: 'desc' }],
    take: 20,
  })

  if (deals.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-4">No deals found yet.</p>
        <p className="text-sm text-muted-foreground">Deals will appear here once the scanner runs.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {deals.map((deal) => (
        <DealCard key={deal.id} deal={deal} />
      ))}
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="h-64 bg-muted animate-pulse rounded-lg" />
      ))}
    </div>
  )
}

export default function DashboardPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-bold mb-2">Today&apos;s Best Deals</h1>
          <p className="text-muted-foreground">AI-curated deals ranked by value</p>
        </div>
        <div className="flex gap-3">
          <Link href="/price-checker">
            <Button variant="outline">Check a Price</Button>
          </Link>
          <ScanDealsButton />
        </div>
      </div>

      <Tabs defaultValue="all" className="mb-8">
        <TabsList>
          <TabsTrigger value="all">All Deals</TabsTrigger>
          <TabsTrigger value="electronics">Electronics</TabsTrigger>
          <TabsTrigger value="computers">Computers</TabsTrigger>
          <TabsTrigger value="home">Home & Kitchen</TabsTrigger>
          <TabsTrigger value="gaming">Gaming</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-6">
          <Suspense fallback={<LoadingSkeleton />}>
            <DealsFeed />
          </Suspense>
        </TabsContent>

        <TabsContent value="electronics" className="mt-6">
          <Suspense fallback={<LoadingSkeleton />}>
            <DealsFeed category="Electronics" />
          </Suspense>
        </TabsContent>

        <TabsContent value="computers" className="mt-6">
          <Suspense fallback={<LoadingSkeleton />}>
            <DealsFeed category="Computers" />
          </Suspense>
        </TabsContent>

        <TabsContent value="home" className="mt-6">
          <Suspense fallback={<LoadingSkeleton />}>
            <DealsFeed category="Home & Kitchen" />
          </Suspense>
        </TabsContent>

        <TabsContent value="gaming" className="mt-6">
          <Suspense fallback={<LoadingSkeleton />}>
            <DealsFeed category="Gaming" />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  )
}
