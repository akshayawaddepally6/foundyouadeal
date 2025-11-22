'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

export function ScanDealsButton() {
  const [isScanning, setIsScanning] = useState(false)
  const router = useRouter()

  const handleScan = async () => {
    setIsScanning(true)

    try {
      const response = await fetch('/api/deals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Failed to scan deals')
      }

      toast.success('Deal scan completed!', {
        description: `Found ${data.dealsScanned || 0} new deals`,
      })

      // Refresh the page data without full reload
      router.refresh()
    } catch (error) {
      toast.error('Scan failed', {
        description: error instanceof Error ? error.message : 'Something went wrong',
      })
    } finally {
      setIsScanning(false)
    }
  }

  return (
    <Button onClick={handleScan} disabled={isScanning}>
      {isScanning ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Scanning...
        </>
      ) : (
        'Scan for New Deals'
      )}
    </Button>
  )
}
