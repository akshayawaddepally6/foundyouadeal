import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { prisma } from '@/lib/db/prisma'
import { PlanningAgent } from '@/lib/agents/planner'
import { auth } from '@/lib/auth'

// Configure serverless function timeout (5 minutes for deal scanning)
export const maxDuration = 300

// GET /api/deals - Fetch deals
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')
    const limit = parseInt(searchParams.get('limit') || '20')
    const minScore = parseInt(searchParams.get('minScore') || '0')

    const deals = await prisma.deal.findMany({
      where: {
        AND: [
          category ? { category } : {},
          { dealyticsScore: { gte: minScore } },
        ],
      },
      orderBy: [{ dealyticsScore: 'desc' }, { scrapedAt: 'desc' }],
      take: Math.min(limit, 100), // Max 100 deals per request
    })

    return NextResponse.json({ deals, count: deals.length })
  } catch (error) {
    console.error('Error fetching deals:', error)
    return NextResponse.json({ error: 'Failed to fetch deals' }, { status: 500 })
  }
}

// POST /api/deals - Trigger new deal scan (requires auth)
export async function POST() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('🚀 Manual deal scan triggered by user:', session.user.email)

    const planner = new PlanningAgent()
    const count = await planner.scanAndSaveDeals()

    return NextResponse.json({
      success: true,
      message: `Successfully scanned and saved ${count} deals`,
      dealsScanned: count,
    })
  } catch (error) {
    console.error('Error scanning deals:', error)
    return NextResponse.json({ error: 'Failed to scan deals' }, { status: 500 })
  }
}
