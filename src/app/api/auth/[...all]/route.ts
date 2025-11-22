import { auth } from '@/lib/auth'

export const maxDuration = 300
export const runtime = 'nodejs'

export async function GET(request: Request) {
  console.log('====== GET Request to Better Auth ======')
  console.log('URL:', request.url)
  console.log('Method:', request.method)
  console.log('Headers:', Object.fromEntries(request.headers.entries()))

  try {
    const response = await auth.handler(request)
    console.log('Response Status:', response.status)
    console.log('Response Headers:', Object.fromEntries(response.headers.entries()))
    return response
  } catch (error) {
    console.error('GET Error:', error)
    throw error
  }
}

export async function POST(request: Request) {
  console.log('====== POST Request to Better Auth ======')
  console.log('URL:', request.url)
  console.log('Method:', request.method)
  console.log('Headers:', Object.fromEntries(request.headers.entries()))

  try {
    // Clone request to read body for logging
    const clonedRequest = request.clone()
    const body = await clonedRequest.text()
    console.log('Body:', body ? body.substring(0, 200) : '(empty)')

    const response = await auth.handler(request)
    console.log('Response Status:', response.status)
    console.log('Response Headers:', Object.fromEntries(response.headers.entries()))

    // Clone response to read body for logging
    const clonedResponse = response.clone()
    const responseBody = await clonedResponse.text()
    console.log('Response Body:', responseBody ? responseBody.substring(0, 200) : '(empty)')

    return response
  } catch (error) {
    console.error('POST Error:', error)
    console.error('Error Stack:', error instanceof Error ? error.stack : 'No stack trace')
    throw error
  }
}
