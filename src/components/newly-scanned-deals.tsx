import { prisma } from '@/lib/db/prisma'
import { DealCard } from '@/components/deal-card'

function formatTimeAgo(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
}

export async function NewlyScannedDeals() {
  const deals = await prisma.deal.findMany({
    orderBy: { scrapedAt: 'desc' },
    take: 4,
  })

  if (deals.length === 0) {
    return null
  }

  const mostRecentTime = deals[0].scrapedAt

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold">Just Scanned</h2>
          <span className="bg-primary text-primary-foreground text-xs font-medium px-2 py-1 rounded-full">
            NEW
          </span>
        </div>
        <span className="text-sm text-muted-foreground">
          {formatTimeAgo(mostRecentTime)}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} />
        ))}
      </div>
    </section>
  )
}

export function NewlyScannedDealsSkeleton() {
  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-40 bg-muted animate-pulse rounded" />
          <div className="h-6 w-12 bg-muted animate-pulse rounded-full" />
        </div>
        <div className="h-5 w-24 bg-muted animate-pulse rounded" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-64 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    </section>
  )
}
