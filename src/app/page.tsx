import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Navbar } from '@/components/navbar'

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="container mx-auto px-4 py-20 text-center">
          <h1 className="text-5xl font-bold mb-6">
            found you a deal
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Your shopping assistant developed with AI, RAG, and agentic AI framework. Never overpay again.
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/dashboard">
              <Button size="lg">Browse Deals</Button>
            </Link>
            <Link href="/signup">
              <Button size="lg" variant="outline">
                Sign Up Free
              </Button>
            </Link>
          </div>
        </section>

        {/* Features Section */}
        <section className="bg-muted/50 py-20">
          <div className="container mx-auto px-4">
            <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="text-4xl mb-4">🔍</div>
                <h3 className="text-xl font-semibold mb-2">We Scan the Web</h3>
                <p className="text-muted-foreground">Our AI continuously scans thousands of deals from across the internet.</p>
              </div>
              <div className="text-center">
                <div className="text-4xl mb-4">🤖</div>
                <h3 className="text-xl font-semibold mb-2">AI Predicts Fair Prices</h3>
                <p className="text-muted-foreground">Machine learning models predict what items should actually cost.</p>
              </div>
              <div className="text-center">
                <div className="text-4xl mb-4">💰</div>
                <h3 className="text-xl font-semibold mb-2">You Save Money</h3>
                <p className="text-muted-foreground">Get alerted only when deals are genuinely good value.</p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="container mx-auto px-4 py-20 text-center">
          <h2 className="text-3xl font-bold mb-6">Ready to Start Saving?</h2>
          <p className="text-lg text-muted-foreground mb-8">Join thousands of smart shoppers using foundyouadeal.</p>
          <Link href="/signup">
            <Button size="lg">Get Started Free</Button>
          </Link>
        </section>
      </main>

      <footer className="border-t py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>&copy; 2024 foundyouadeal. Built with AI.</p>
        </div>
      </footer>
    </div>
  )
}
