import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { load } from 'cheerio'

// Re-scrape a DealNews page and extract the merchant "Buy Now" link
async function fetchMerchantUrl(dealNewsUrl: string): Promise<string | null> {
  try {
    const res = await fetch(dealNewsUrl)
    const html = await res.text()
    const $ = load(html)

    // Try the same patterns as the scanner
    const merchantUrl =
      $('.snippet-more-link').attr('href') ||
      $('.snippet.external-links a').attr('href') ||
      $('a:contains("Buy Now")').attr('href') ||
      $('a:contains("Shop Now")').attr('href') ||
      null

    console.log('Scraped merchant URL:', dealNewsUrl, '→', merchantUrl)
    return merchantUrl
  } catch (err) {
    console.error('Failed to fetch merchant URL for', dealNewsUrl, err)
    return null
  }
}

export async function GET() {
  try {
    // Deals that still need a merchant link
    const dealsToFix = await prisma.deal.findMany({
      where: {
        OR: [
          { merchantUrl: null },
          { merchantUrl: '' },
          { merchantUrl: 'N/A' },
        ],
      },
      take: 100, // safety cap
    })

    if (dealsToFix.length === 0) {
      return NextResponse.json({
        updated: 0,
        message: 'No deals needed fixing',
      })
    }

    let updated = 0
    let skipped = 0

    for (const deal of dealsToFix) {
      const merchantUrl = await fetchMerchantUrl(deal.url)

      if (!merchantUrl) {
        console.log('❌ No merchant link found for', deal.url)
        skipped++
        continue // 🔴 IMPORTANT: don’t update if we didn’t find anything
      }

      await prisma.deal.update({
        where: { id: deal.id },
        data: {
          merchantUrl,
        },
      })

      updated++
      console.log(`✅ Updated ${deal.id} → ${merchantUrl}`)

      // Be gentle to DealNews
      await new Promise((r) => setTimeout(r, 300))
    }

    return NextResponse.json({
      updated,
      skipped,
      message: `Updated ${updated} deals, skipped ${skipped} (no merchant link found)`,
    })
  } catch (error) {
    console.error('fix-merchant-urls route error:', error)
    return NextResponse.json(
      { error: 'Failed to fix merchant URLs' },
      { status: 500 },
    )
  }
}
