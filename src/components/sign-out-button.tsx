'use client'

import { signOut } from '@/lib/auth-client'
import { useRouter } from 'next/navigation'

export function SignOutButton() {
  const router = useRouter()

  const handleSignOut = async () => {
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push('/login')
          router.refresh()
        },
      },
    })
  }

  return (
    <button onClick={handleSignOut} className="w-full text-left">
      Sign Out
    </button>
  )
}
